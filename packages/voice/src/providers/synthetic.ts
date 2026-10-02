// The deterministic synthetic voice (§8.3): offline, free, exact word timings. The scratch-take provider.
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import type { Lang, LicenseInfo, TtsCapabilities, TtsProvider, TtsRequest, TtsResult, VoiceInfo, WordTiming } from "@docmaker/core";
import { DocmakerError, normWord, rngFor } from "@docmaker/core";
import { writeWav } from "@docmaker/core/node";
import { sentenceRanges, trailingPause } from "../text/sentences";
import { renderSynth, type SynthPlan, type SynthWord } from "./synth-dsp";

export const SYNTH_SAMPLE_RATE = 48000;
export const SYNTH_LEAD_MS = 120;
export const SYNTH_TAIL_MS = 250;
const VOWELS: readonly [number, number][] = [[730, 1090], [270, 2290], [300, 870], [530, 1840], [570, 840], [440, 1020]];
const VOWEL_GROUPS = /[aeiouyàâäéèêëîïôöùûüœ]+/giu;
export const DEFAULT_CPS: Record<Lang, number> = { en: 16.5, fr: 16.0 };
/** Plans longer than this render in a worker thread (keeps the job worker's event loop responsive). */
export const WORKER_THRESHOLD_MS = 20_000;

export const SYNTHETIC_LICENSE: LicenseInfo = {
  code: "PROCEDURAL", version: null, url: null, commercialOk: true, derivativesOk: true, attributionRequired: false,
  attributionText: null, restrictions: ["synthetic"],
};

export const SYNTHETIC_VOICES: readonly { id: string; name: string; f0: number; gender: "male" | "female" }[] = [
  { id: "synthetic-m1", name: "Synthetic (low)", f0: 110, gender: "male" },
  { id: "synthetic-f1", name: "Synthetic (high)", f0: 190, gender: "female" },
];

export interface PlannedWord extends WordTiming { sentence: number }

/** §8.3 timing algorithm: exact word times for a list of tts words. Pure punctuation tokens get zero length. */
export function planSyntheticWords(ttsWords: readonly string[], cps: number): { words: PlannedWord[]; totalMs: number } {
  const sentenceOf = new Array<number>(ttsWords.length).fill(0);
  sentenceRanges(ttsWords).forEach(([a, b], s) => { for (let k = a; k < b; k++) sentenceOf[k] = s; });
  let t = SYNTH_LEAD_MS;
  const words: PlannedWord[] = [];
  ttsWords.forEach((w, i) => {
    const chars = [...normWord(w)].length;
    const pause = trailingPause(w);
    const extra = pause === "stop" ? 380 : pause === "comma" ? 180 : 0;
    if (chars === 0) {
      words.push({ text: w, startMs: t, endMs: t, confidence: null, sentence: sentenceOf[i]! });
      t += extra;
      return;
    }
    const dur = Math.round(Math.min(900, Math.max(140, (1000 * (chars + 1)) / cps)));
    words.push({ text: w, startMs: t, endMs: t + dur, confidence: null, sentence: sentenceOf[i]! });
    t += dur + 60 + extra;
  });
  const lastEnd = words.length ? words[words.length - 1]!.endMs : SYNTH_LEAD_MS;
  return { words, totalMs: lastEnd + SYNTH_TAIL_MS };
}

export function buildSynthPlan(ttsWords: readonly string[], o: { cps: number; f0: number; seed: number }): { plan: SynthPlan; words: WordTiming[] } {
  const { words, totalMs } = planSyntheticWords(ttsWords, o.cps);
  const sentBounds = new Map<number, [number, number]>();
  for (const w of words) {
    if (w.endMs === w.startMs) continue;
    const b = sentBounds.get(w.sentence);
    sentBounds.set(w.sentence, b ? [Math.min(b[0], w.startMs), Math.max(b[1], w.endMs)] : [w.startMs, w.endMs]);
  }
  const synthWords: SynthWord[] = words.map((w, i) => {
    const sb = sentBounds.get(w.sentence) ?? [w.startMs, w.endMs];
    if (w.endMs === w.startMs) return { startMs: w.startMs, endMs: w.endMs, sentenceStartMs: sb[0], sentenceEndMs: sb[1], syllables: [] };
    const nSyl = Math.max(1, w.text.toLowerCase().match(VOWEL_GROUPS)?.length ?? 0);
    const syllables = Array.from({ length: nSyl }, (_, j) => {
      const r = rngFor(o.seed, `${w.text}${i}${j}`);
      const [f1, f2] = VOWELS[Math.floor(r() * VOWELS.length) % VOWELS.length]!;
      return { f1, f2 };
    });
    return { startMs: w.startMs, endMs: w.endMs, sentenceStartMs: sb[0], sentenceEndMs: sb[1], syllables };
  });
  return {
    plan: { sampleRate: SYNTH_SAMPLE_RATE, f0: o.f0, noiseSeed: rngFor(o.seed, "noise")() * 4294967296 >>> 0, totalMs, words: synthWords },
    words: words.map(({ sentence: _s, ...w }) => w),
  };
}

const WORKER_SRC = `
const { parentPort, workerData } = require("node:worker_threads");
import(workerData.dspUrl).then((m) => {
  const out = m.renderSynth(workerData.plan);
  parentPort.postMessage(out, [out.buffer]);
}).catch((e) => { parentPort.postMessage({ error: String(e && e.stack || e) }); });
`;

/** Renders in a worker thread (Node type stripping loads synth-dsp.ts); resolves null when that is impossible. */
export function renderSynthInWorker(plan: SynthPlan, dspPath: string, signal: AbortSignal): Promise<Float32Array | null> {
  if (!existsSync(dspPath) || !(process.features as { typescript?: unknown }).typescript) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SRC, { eval: true, workerData: { plan, dspUrl: pathToFileURL(dspPath).href }, execArgv: [] });
    const onAbort = () => { void worker.terminate(); reject(new DocmakerError("CANCELED", "synthetic voice canceled")); };
    signal.addEventListener("abort", onAbort, { once: true });
    worker.once("message", (m: unknown) => {
      signal.removeEventListener("abort", onAbort);
      void worker.terminate();
      resolve(m instanceof Float32Array ? m : null);
    });
    worker.once("error", () => { signal.removeEventListener("abort", onAbort); resolve(null); });
  });
}

export class SyntheticProvider implements TtsProvider {
  readonly id = "synthetic" as const;
  constructor(private readonly o: { repoRoot: string | null; useWorker?: "auto" | "always" | "never" }) {}

  async isAvailable() { return { ok: true, hint: null }; }

  async capabilities(): Promise<TtsCapabilities> {
    return {
      languages: ["en", "fr"], nativeWordTimestamps: true, stitching: false, maxCharsPerRequest: 1_000_000, voiceCloning: false,
      normalizesNumbers: false, costPer1kCharsUsd: 0, tier: null,
    };
  }

  async listVoices(lang?: Lang): Promise<VoiceInfo[]> {
    const langs: Lang[] = lang ? [lang] : ["en", "fr"];
    return langs.flatMap((l) => SYNTHETIC_VOICES.map((v) => ({
      id: v.id, name: v.name, lang: l, gender: v.gender, provider: "synthetic" as const, license: SYNTHETIC_LICENSE, cloned: false,
    })));
  }

  async synthesize(req: TtsRequest, outPath: string, signal: AbortSignal): Promise<TtsResult> {
    if (signal.aborted) throw new DocmakerError("CANCELED", "synthetic voice canceled");
    const voice = SYNTHETIC_VOICES.find((v) => v.id === req.voice.voiceId) ?? SYNTHETIC_VOICES[0]!;
    const cps = (req.voice.charsPerSec ?? DEFAULT_CPS[req.lang]) * (req.voice.speed ?? 1);
    const { plan, words } = buildSynthPlan(req.ttsWords, { cps, f0: voice.f0, seed: req.seed ?? 0 });
    const mode = this.o.useWorker ?? "auto";
    let samples: Float32Array | null = null;
    if (mode === "always" || (mode === "auto" && plan.totalMs > WORKER_THRESHOLD_MS)) {
      const dsp = this.o.repoRoot ? path.join(this.o.repoRoot, "packages/voice/src/providers/synth-dsp.ts") : "";
      samples = await renderSynthInWorker(plan, dsp, signal);
    }
    if (!samples) {
      await new Promise((r) => setImmediate(r)); // yield between segments on the main thread
      samples = renderSynth(plan);
    }
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeWav(outPath, { sampleRate: SYNTH_SAMPLE_RATE, channels: 1, data: [samples] }, "s16");
    return {
      segmentId: req.segmentId, audioPath: outPath, durationMs: plan.totalMs, words, timingSource: "synthetic",
      providerRequestId: null, charsBilled: 0,
    };
  }
}
