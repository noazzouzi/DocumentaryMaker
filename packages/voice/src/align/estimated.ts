// Estimated aligner (§8.5): word times ∝ chars+1 (+0.5 for a trailing comma) inside each sentence span. Sentence
// spans come from the provider (sherpa boundaries) or are snapped to the longest pauses found in the audio.
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Aligner, Lang, RuntimeConfig, WordTiming } from "@docmaker/core";
import { DocmakerError, normWord } from "@docmaker/core";
import { readWav } from "@docmaker/core/node";
import { detectRmsSilences, soundBounds } from "../audio/silence";
import { decodeTo48kMono } from "../post/chain";
import { sentenceRanges, trailingPause } from "../text/sentences";

export interface SpanRegion { startMs: number; endMs: number; words: [number, number] }

const weightOf = (w: string) => {
  const chars = [...normWord(w)].length;
  if (chars === 0) return 0;
  return chars + 1 + (trailingPause(w) === "comma" ? 0.5 : 0);
};

/** Distributes each region's time over its words by weight. Returns one timing per tts word. */
export function estimateTimings(ttsWords: readonly string[], regions: readonly SpanRegion[]): WordTiming[] {
  const out: WordTiming[] = ttsWords.map((text) => ({ text, startMs: 0, endMs: 0, confidence: null }));
  for (const r of regions) {
    const [a, b] = r.words;
    const weights = ttsWords.slice(a, b).map(weightOf);
    const total = weights.reduce((x, y) => x + y, 0);
    let acc = 0;
    for (let k = a; k < b; k++) {
      const s = total > 0 ? r.startMs + ((r.endMs - r.startMs) * acc) / total : r.startMs;
      acc += weights[k - a]!;
      const e = total > 0 ? r.startMs + ((r.endMs - r.startMs) * acc) / total : r.startMs;
      out[k] = { text: ttsWords[k]!, startMs: Math.round(s), endMs: Math.round(e), confidence: null };
    }
  }
  return out;
}

/**
 * Regions for a whole file: speech bounds (−45 dB) split at sentence ends; when the audio has at least as many
 * long pauses (≥ 200 ms) as sentence breaks, the longest ones become the sentence boundaries.
 */
export function regionsFromAudio(samples: Float32Array, sampleRate: number, ttsWords: readonly string[]): SpanRegion[] {
  const sentences = sentenceRanges(ttsWords);
  const durMs = (samples.length * 1000) / sampleRate;
  const b = soundBounds(samples, -45);
  const speechStart = b ? (b.first * 1000) / sampleRate : 0;
  const speechEnd = b ? ((b.last + 1) * 1000) / sampleRate : durMs;
  if (sentences.length <= 1) return sentences.map((s) => ({ startMs: speechStart, endMs: speechEnd, words: s }));
  const pauses = detectRmsSilences(samples, sampleRate, { thresholdDb: -45, minMs: 200 })
    .filter((p) => p.startMs > speechStart && p.endMs < speechEnd);
  const breaks = sentences.length - 1;
  if (pauses.length >= breaks) {
    const chosen = [...pauses].sort((x, y) => y.endMs - y.startMs - (x.endMs - x.startMs)).slice(0, breaks).sort((x, y) => x.startMs - y.startMs);
    return sentences.map((s, i) => ({
      startMs: i === 0 ? speechStart : chosen[i - 1]!.endMs,
      endMs: i === sentences.length - 1 ? speechEnd : chosen[i]!.startMs,
      words: s,
    }));
  }
  return [{ startMs: speechStart, endMs: speechEnd, words: [0, ttsWords.length] }];
}

async function readMono(audioPath: string, config: RuntimeConfig, signal: AbortSignal): Promise<{ samples: Float32Array; sampleRate: number }> {
  try {
    const w = await readWav(audioPath);
    if (w.channels >= 1) return { samples: w.data[0]!, sampleRate: w.sampleRate };
  } catch {
    /* not a WAV: decode below */
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "docmaker-est-"));
  try {
    const tmp = path.join(dir, "a.wav");
    await decodeTo48kMono(audioPath, tmp, null, { config, signal });
    const w = await readWav(tmp);
    return { samples: w.data[0]!, sampleRate: w.sampleRate };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export class EstimatedAligner implements Aligner {
  readonly id = "estimated" as const;
  constructor(private readonly config: RuntimeConfig) {}
  async isAvailable() { return { ok: true, hint: null }; }
  async transcribe(): Promise<WordTiming[]> {
    throw new DocmakerError("TOOL_MISSING", "the estimated aligner cannot transcribe audio", { hint: "run `docmaker setup --python` (faster-whisper)" });
  }
  async align(audioPath: string, ttsWords: string[], _lang: Lang, signal: AbortSignal): Promise<WordTiming[]> {
    const { samples, sampleRate } = await readMono(audioPath, this.config, signal);
    return estimateTimings(ttsWords, regionsFromAudio(samples, sampleRate, ttsWords));
  }
}
