// faster-whisper ASR through the Python sidecar (§8.5, §8.8) + script-guided NW alignment.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Aligner, ErrorCode, Lang, RuntimeConfig, WordTiming } from "@docmaker/core";
import { DocmakerError, isDocmakerError } from "@docmaker/core";
import { runSidecar } from "@docmaker/core/node";
import { alignScriptToTranscript } from "./nw";

export interface AsrOutput { words: { text: string; startMs: number; endMs: number; p: number | null }[]; durationSec: number; rtf: number }
export interface AsrBatchOutput { results: AsrOutput[] }
export type SidecarRunner = <T>(cmd: "asr", input: unknown, opts: { config: RuntimeConfig; signal: AbortSignal; timeoutMs?: number }) => Promise<T>;

export const FW_MODEL = "large-v3-turbo";

const CODES = new Set<ErrorCode>(["VALIDATION", "TOOL_MISSING", "MODEL_MISSING", "CANCELED", "INTERNAL"]);
/** runSidecar reports failures as INTERNAL with the stderr tail; recover the dispatcher's "ERROR <CODE>: msg" line. */
export function sidecarError(e: unknown): unknown {
  if (!isDocmakerError(e) || e.code !== "INTERNAL") return e;
  const m = /ERROR ([A-Z_]+): (.+)/.exec(e.message);
  if (!m || !CODES.has(m[1] as ErrorCode)) return e;
  const code = m[1] as ErrorCode;
  return new DocmakerError(code, m[2]!.trim(), { cause: e, hint: code === "TOOL_MISSING" || code === "MODEL_MISSING" ? "run `docmaker setup --python`" : undefined });
}

/**
 * faster-whisper word pieces → words. A piece without a leading space continues the previous word (FR elisions
 * come back as " l" + "'acteur"); punctuation-only pieces are dropped.
 */
export function mergeAsrWords(pieces: readonly { text: string; startMs: number; endMs: number; p: number | null }[]): WordTiming[] {
  const out: WordTiming[] = [];
  for (const w of pieces) {
    const t = w.text;
    if (!t.trim()) continue;
    const startMs = Math.max(0, Math.round(w.startMs)), endMs = Math.max(startMs, Math.round(w.endMs));
    const conf = w.p === null ? null : Math.max(0, Math.min(1, w.p));
    const last = out[out.length - 1];
    if (last && (!/^\s/u.test(t) || /^\s*[.,!?;:…»"”]+\s*$/u.test(t))) {
      last.text += t.trim();
      last.endMs = Math.max(last.endMs, endMs);
      if (conf !== null) last.confidence = last.confidence === null ? conf : Math.min(last.confidence, conf);
      continue;
    }
    out.push({ text: t.trim(), startMs, endMs, confidence: conf });
  }
  return out;
}

/** Hugging Face repo names faster-whisper resolves short model names to (the cache dir is models--<org>--<name>). */
const FW_REPO_HINT: Record<string, string> = { "large-v3-turbo": "faster-whisper-large-v3-turbo", turbo: "faster-whisper-large-v3-turbo" };

/**
 * True when `model` is usable from `<models>/whisper/fw` without a download: either a converted local directory
 * (<fw>/<model>/model.bin) or a complete Hugging Face cache snapshot (models--*<name>*\/snapshots/<rev>/model.bin).
 */
export function fasterWhisperModelPresent(fwDir: string, model: string): boolean {
  if (existsSync(path.join(fwDir, model, "model.bin"))) return true;
  const needle = (FW_REPO_HINT[model] ?? `faster-whisper-${model}`).toLowerCase();
  let entries: string[];
  try {
    entries = readdirSync(fwDir);
  } catch {
    return false;
  }
  for (const e of entries) {
    if (!e.startsWith("models--") || !e.toLowerCase().endsWith(needle)) continue;
    const snaps = path.join(fwDir, e, "snapshots");
    try {
      for (const rev of readdirSync(snaps)) if (existsSync(path.join(snaps, rev, "model.bin"))) return true;
    } catch { /* no snapshot */ }
  }
  return false;
}

export interface FasterWhisperOptions {
  /** Never download the model (the sidecar runs with HF_HUB_OFFLINE / local_files_only); isAvailable() requires it on disk. */
  localFilesOnly?: boolean;
}

export class FasterWhisperAligner implements Aligner {
  readonly id = "faster-whisper" as const;
  constructor(
    private readonly config: RuntimeConfig,
    private readonly run: SidecarRunner = runSidecar as SidecarRunner,
    private readonly model = FW_MODEL,
    private readonly opts: FasterWhisperOptions = {},
  ) {}

  get modelsDir(): string { return path.join(this.config.paths.models, "whisper", "fw"); }
  private get localOnly(): boolean { return this.opts.localFilesOnly === true || this.config.offline; }

  async isAvailable() {
    const py = path.join(this.config.paths.pyVenv, "bin", "python");
    if (!existsSync(py)) return { ok: false, hint: "run `docmaker setup --python` to install faster-whisper" };
    // the venv alone (it may only serve yt-dlp) does not mean the ~1.6 GB model is there
    if (this.localOnly && !fasterWhisperModelPresent(this.modelsDir, this.model)) {
      return { ok: false, hint: `the faster-whisper ${this.model} model is not downloaded: run \`docmaker setup --python\` while online` };
    }
    return { ok: true, hint: null };
  }

  private input(audio: string | string[], lang: Lang, namesPrompt: string): Record<string, unknown> {
    return {
      ...(Array.isArray(audio) ? { audios: audio.map((a) => path.resolve(a)) } : { audio: path.resolve(audio) }),
      lang, model: this.model, initialPrompt: namesPrompt || null, vad: true, beamSize: 5,
      computeType: "int8", threads: 4, modelsDir: this.modelsDir, localFilesOnly: this.localOnly,
    };
  }

  async transcribe(audioPath: string, lang: Lang, namesPrompt: string, signal: AbortSignal): Promise<WordTiming[]> {
    const out = await this.run<AsrOutput>("asr", this.input(audioPath, lang, namesPrompt), { config: this.config, signal, timeoutMs: 6 * 3600_000 })
      .catch((e: unknown) => { throw sidecarError(e); });
    return mergeAsrWords(out.words);
  }

  /** Several files in one sidecar run: the model is loaded once (per-segment QA of a whole chapter). */
  async transcribeBatch(audioPaths: string[], lang: Lang, namesPrompt: string, signal: AbortSignal): Promise<WordTiming[][]> {
    if (audioPaths.length === 0) return [];
    if (audioPaths.length === 1) return [await this.transcribe(audioPaths[0]!, lang, namesPrompt, signal)];
    const out = await this.run<AsrBatchOutput>("asr", this.input(audioPaths, lang, namesPrompt), { config: this.config, signal, timeoutMs: 6 * 3600_000 })
      .catch((e: unknown) => { throw sidecarError(e); });
    if (!Array.isArray(out.results) || out.results.length !== audioPaths.length) {
      throw new DocmakerError("INTERNAL", `sidecar asr returned ${out.results?.length ?? 0} results for ${audioPaths.length} files`);
    }
    return out.results.map((r) => mergeAsrWords(r.words));
  }

  async align(audioPath: string, ttsWords: string[], lang: Lang, signal: AbortSignal): Promise<WordTiming[]> {
    const asr = await this.transcribe(audioPath, lang, "", signal);
    return alignScriptToTranscript(ttsWords, asr).map(({ matched: _m, ...w }) => w);
  }
}

/** Batch transcription through any aligner: one sidecar run when it supports batches, else file by file. */
export async function transcribeMany(asr: Aligner, audioPaths: string[], lang: Lang, namesPrompt: string, signal: AbortSignal): Promise<WordTiming[][]> {
  const b = (asr as Partial<Pick<FasterWhisperAligner, "transcribeBatch">>).transcribeBatch;
  if (typeof b === "function") return b.call(asr, audioPaths, lang, namesPrompt, signal);
  const out: WordTiming[][] = [];
  for (const p of audioPaths) out.push(await asr.transcribe(p, lang, namesPrompt, signal));
  return out;
}
