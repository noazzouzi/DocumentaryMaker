// faster-whisper ASR through the Python sidecar (§8.5, §8.8) + script-guided NW alignment.
import { existsSync } from "node:fs";
import path from "node:path";
import type { Aligner, Lang, RuntimeConfig, WordTiming } from "@docmaker/core";
import { runSidecar } from "@docmaker/core/node";
import { alignScriptToTranscript } from "./nw";

export interface AsrOutput { words: { text: string; startMs: number; endMs: number; p: number | null }[]; durationSec: number; rtf: number }
export type SidecarRunner = <T>(cmd: "asr", input: unknown, opts: { config: RuntimeConfig; signal: AbortSignal; timeoutMs?: number }) => Promise<T>;

export const FW_MODEL = "large-v3-turbo";

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

export class FasterWhisperAligner implements Aligner {
  readonly id = "faster-whisper" as const;
  constructor(private readonly config: RuntimeConfig, private readonly run: SidecarRunner = runSidecar as SidecarRunner, private readonly model = FW_MODEL) {}

  async isAvailable() {
    const py = path.join(this.config.paths.pyVenv, "bin", "python");
    return existsSync(py) ? { ok: true, hint: null } : { ok: false, hint: "run `docmaker setup --python` to install faster-whisper" };
  }

  async transcribe(audioPath: string, lang: Lang, namesPrompt: string, signal: AbortSignal): Promise<WordTiming[]> {
    const out = await this.run<AsrOutput>("asr", {
      audio: path.resolve(audioPath), lang, model: this.model, initialPrompt: namesPrompt || null, vad: true, beamSize: 5,
      computeType: "int8", threads: 4, modelsDir: path.join(this.config.paths.models, "whisper", "fw"),
    }, { config: this.config, signal, timeoutMs: 6 * 3600_000 });
    return mergeAsrWords(out.words);
  }

  async align(audioPath: string, ttsWords: string[], lang: Lang, signal: AbortSignal): Promise<WordTiming[]> {
    const asr = await this.transcribe(audioPath, lang, "", signal);
    return alignScriptToTranscript(ttsWords, asr).map(({ matched: _m, ...w }) => w);
  }
}
