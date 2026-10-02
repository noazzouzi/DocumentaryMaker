// Kokoro and Piper through sherpa-onnx-node (§8.3; port of $SP/tts/node/sherpa_kokoro.js). The native module is
// loaded lazily with createRequire so nothing breaks when the optional dependency or the models are absent.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Lang, Logger, RuntimeConfig, TtsCapabilities, TtsProvider, TtsRequest, TtsResult, VoiceInfo } from "@docmaker/core";
import { DocmakerError } from "@docmaker/core";
import { writeWav } from "@docmaker/core/node";
import { estimateTimings, type SpanRegion } from "../align/estimated";
import { trimSilenceRms } from "../audio/silence";
import { KOKORO_VOICES, PIPER_DENYLIST, PIPER_FLAGGED, PIPER_VOICES, type CatalogVoice } from "../license";
import { sentenceRanges } from "../text/sentences";

export interface SherpaAudio { samples: Float32Array; sampleRate: number }
export interface SherpaTts {
  sampleRate: number;
  generateAsync?(o: { text: string; sid: number; speed: number }): Promise<SherpaAudio>;
  generate(o: { text: string; sid: number; speed: number }): SherpaAudio;
}
export interface SherpaModule {
  OfflineTts: { new (config: unknown): SherpaTts; createAsync?(config: unknown): Promise<SherpaTts> };
}

export type SherpaKind = "kokoro" | "piper";
export const KOKORO_DIRNAME = "kokoro-multi-lang-v1_0";
const SENTENCE_GAP_MS = 380;
const TRIM_DB = -45;
const KEEP_MS = 30;

export function loadSherpa(): SherpaModule | null {
  try {
    return createRequire(import.meta.url)("sherpa-onnx-node") as SherpaModule;
  } catch {
    return null;
  }
}

export function kokoroDir(config: RuntimeConfig): string {
  return path.join(config.paths.models, "kokoro", KOKORO_DIRNAME);
}
/** <models>/piper/<voice>/ (ensureModel layout) or the raw tarball name vits-piper-<voice>/. */
export function piperDir(config: RuntimeConfig, voice: string): string {
  const a = path.join(config.paths.models, "piper", voice);
  const b = path.join(config.paths.models, "piper", `vits-piper-${voice}`);
  return existsSync(a) || !existsSync(b) ? a : b;
}

interface Resolved { voice: CatalogVoice | null; id: string; sid: number; lang: Lang }

export class SherpaProvider implements TtsProvider {
  private engines = new Map<string, Promise<SherpaTts>>();
  private mod: SherpaModule | null | undefined;

  constructor(readonly id: SherpaKind, private readonly o: { config: RuntimeConfig; logger: Logger; loader?: () => SherpaModule | null }) {}

  private module(): SherpaModule | null {
    if (this.mod === undefined) this.mod = (this.o.loader ?? loadSherpa)();
    return this.mod;
  }

  private catalog(): readonly CatalogVoice[] {
    return this.id === "kokoro" ? KOKORO_VOICES : PIPER_VOICES;
  }

  private modelDir(voiceId: string): string {
    return this.id === "kokoro" ? kokoroDir(this.o.config) : piperDir(this.o.config, voiceId);
  }

  async isAvailable() {
    if (!this.module()) return { ok: false, hint: "the optional sherpa-onnx-node package is not installed for this platform" };
    const any = this.id === "kokoro" ? existsSync(path.join(kokoroDir(this.o.config), "model.onnx")) : PIPER_VOICES.some((v) => existsSync(this.modelDir(v.id)));
    return any ? { ok: true, hint: null } : { ok: false, hint: `run \`docmaker setup --voices ${this.id}\` to download the ${this.id} model` };
  }

  async capabilities(): Promise<TtsCapabilities> {
    return {
      languages: ["en", "fr"], nativeWordTimestamps: false, stitching: false, maxCharsPerRequest: 100_000, voiceCloning: false,
      normalizesNumbers: true, costPer1kCharsUsd: 0, tier: null,
    };
  }

  async listVoices(lang?: Lang): Promise<VoiceInfo[]> {
    return this.catalog().filter((v) => !lang || v.lang === lang).map((v) => ({
      id: v.id, name: v.name, lang: v.lang, gender: v.gender, provider: this.id, license: v.license, cloned: false,
    }));
  }

  /** Default voice for "auto"; Kokoro FR has only ff_siwis (30); never a denylisted Piper voice. */
  resolve(voiceId: string, lang: Lang): Resolved {
    const cat = this.catalog();
    if (voiceId === "auto" || voiceId === "") {
      const v = cat.find((x) => x.lang === lang && x.isDefault)!;
      return { voice: v, id: v.id, sid: v.sid, lang };
    }
    if (this.id === "kokoro") {
      const v = cat.find((x) => x.id === voiceId || x.name === voiceId);
      if (lang === "fr" && (!v || v.lang !== "fr")) {
        throw new DocmakerError("VALIDATION", `Kokoro has a single French voice (30 ff_siwis); "${voiceId}" cannot speak French`, { hint: "use voiceId \"30\" or \"auto\"" });
      }
      if (v) return { voice: v, id: v.id, sid: v.sid, lang };
      const sid = Number(voiceId);
      if (!Number.isInteger(sid) || sid < 0 || sid > 53) throw new DocmakerError("VALIDATION", `unknown Kokoro voice "${voiceId}"`);
      return { voice: null, id: voiceId, sid, lang };
    }
    if (PIPER_DENYLIST.test(voiceId)) {
      throw new DocmakerError("POLICY_DENIED", `Piper voice "${voiceId}" is trained on a non-commercial/research dataset and is never used`, { hint: "use fr_FR-gilles-low or en_US-john-medium" });
    }
    const v = cat.find((x) => x.id === voiceId) ?? null;
    if (!v && PIPER_FLAGGED.test(voiceId)) this.o.logger.warn(`piper voice ${voiceId}: dataset licence (AGPL) — check before publishing`);
    return { voice: v, id: voiceId, sid: v?.sid ?? 0, lang };
  }

  private engine(r: Resolved): Promise<SherpaTts> {
    const key = this.id === "kokoro" ? `kokoro|${r.lang}|${r.voice?.name.startsWith("b") ? "gb" : "us"}` : `piper|${r.id}`;
    let p = this.engines.get(key);
    if (!p) {
      p = this.createEngine(r);
      this.engines.set(key, p);
      p.catch(() => this.engines.delete(key));
    }
    return p;
  }

  private async createEngine(r: Resolved): Promise<SherpaTts> {
    const mod = this.module();
    if (!mod) throw new DocmakerError("TOOL_MISSING", "sherpa-onnx-node is not available", { hint: "reinstall dependencies on a supported platform (linux/macOS/windows x64/arm64)" });
    const dir = this.modelDir(r.id);
    let model: Record<string, unknown>;
    if (this.id === "kokoro") {
      if (!existsSync(path.join(dir, "model.onnx"))) throw new DocmakerError("MODEL_MISSING", "the Kokoro model is not installed", { hint: "docmaker setup --voices kokoro" });
      const gb = r.voice?.name.startsWith("b") ?? false;
      model = {
        kokoro: {
          model: path.join(dir, "model.onnx"), voices: path.join(dir, "voices.bin"), tokens: path.join(dir, "tokens.txt"),
          dataDir: path.join(dir, "espeak-ng-data"),
          lexicon: r.lang === "en" ? path.join(dir, gb ? "lexicon-gb-en.txt" : "lexicon-us-en.txt") : "",
          lang: r.lang === "en" ? "" : r.lang,
        },
      };
    } else {
      const onnx = path.join(dir, `${r.id}.onnx`);
      if (!existsSync(onnx)) throw new DocmakerError("MODEL_MISSING", `the Piper voice ${r.id} is not installed`, { hint: `docmaker setup --voices piper:${r.id}` });
      model = { vits: { model: onnx, tokens: path.join(dir, "tokens.txt"), dataDir: path.join(dir, "espeak-ng-data") } };
    }
    const config = { model: { ...model, numThreads: 4, provider: "cpu", debug: 0 }, maxNumSentences: 1 };
    return mod.OfflineTts.createAsync ? mod.OfflineTts.createAsync(config) : new mod.OfflineTts(config);
  }

  async synthesize(req: TtsRequest, outPath: string, signal: AbortSignal): Promise<TtsResult> {
    const r = this.resolve(req.voice.voiceId, req.lang);
    const tts = await this.engine(r);
    const speed = Math.min(1.5, Math.max(0.5, req.voice.speed ?? 1));
    // one sentence at a time (Kokoro truncates long inputs); trim each sentence's silence, record boundaries
    const parts: Float32Array[] = [];
    const regions: SpanRegion[] = [];
    let sampleRate = tts.sampleRate;
    let cursor = 0;
    for (const [a, b] of sentenceRanges(req.ttsWords)) {
      if (signal.aborted) throw new DocmakerError("CANCELED", `${this.id} synthesis canceled`);
      // (sherpa logs "Skip unknown phonemes U+002d" for espeak's word-boundary marks: harmless)
      const text = req.ttsWords.slice(a, b).join(" ");
      const audio = tts.generateAsync ? await tts.generateAsync({ text, sid: r.sid, speed }) : tts.generate({ text, sid: r.sid, speed });
      sampleRate = audio.sampleRate;
      const trimmed = trimSilenceRms(audio.samples, sampleRate, { thresholdDb: TRIM_DB, keepMs: KEEP_MS });
      if (parts.length) {
        const gap = new Float32Array(Math.round((SENTENCE_GAP_MS * sampleRate) / 1000));
        parts.push(gap);
        cursor += gap.length;
      }
      const startMs = (cursor * 1000) / sampleRate;
      parts.push(trimmed);
      cursor += trimmed.length;
      const endMs = (cursor * 1000) / sampleRate;
      regions.push({ startMs: Math.min(endMs, startMs + KEEP_MS), endMs: Math.max(startMs, endMs - KEEP_MS), words: [a, b] });
    }
    const all = new Float32Array(cursor);
    let off = 0;
    for (const p of parts) { all.set(p, off); off += p.length; }
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeWav(outPath, { sampleRate, channels: 1, data: [all] }, "f32");
    return {
      segmentId: req.segmentId, audioPath: outPath, durationMs: Math.round((cursor * 1000) / sampleRate),
      words: estimateTimings(req.ttsWords, regions), timingSource: "estimated", providerRequestId: null, charsBilled: 0,
    };
  }
}
