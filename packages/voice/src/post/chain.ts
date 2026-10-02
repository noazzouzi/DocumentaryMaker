// VO post chain (§8.4; validated in $SP/tts/audiopost.sh): decode → 48 kHz mono, lead/tail trim (−50 dB, ≥ 50 ms,
// 30 ms pad), cleanup filters. Internal pauses are never touched; no loudness normalisation here (§11.4).
import { rename, rm } from "node:fs/promises";
import path from "node:path";
import type { RuntimeConfig } from "@docmaker/core";
import { DocmakerError } from "@docmaker/core";
import { ffmpeg, readWav, readWavHeader } from "@docmaker/core/node";
import { soundBounds } from "../audio/silence";

export const POST_CHAIN_VERSION = 1;
export const VO_SAMPLE_RATE = 48000;
export const TRIM_THRESHOLD_DB = -50;
export const TRIM_MIN_SILENCE_MS = 50;
export const TRIM_PAD_MS = 30;

const BASE = [
  "deesser",
  "acompressor=threshold=-18dB:ratio=3:attack=5:release=60",
  "equalizer=f=250:t=q:w=1:g=-3",
  "equalizer=f=3000:t=q:w=1:g=2.5",
];
export const POST_FILTERS = {
  tts: ["highpass=f=80", ...BASE].join(","),
  recording: ["highpass=f=80", "afftdn", ...BASE].join(","),
} as const;

export interface RawFormat { sampleRate: number; pcm: boolean }
interface Ctx { config: RuntimeConfig; signal: AbortSignal }

/** Any audio (or raw s16le mono PCM) → 48 kHz mono float WAV, no filtering. */
export async function decodeTo48kMono(input: string, output: string, rawFormat: RawFormat | null, ctx: Ctx): Promise<void> {
  const inArgs = rawFormat?.pcm ? ["-f", "s16le", "-ar", String(rawFormat.sampleRate), "-ac", "1", "-i", input] : ["-i", input];
  await ffmpeg([...inArgs, "-map", "0:a:0", "-ac", "1", "-ar", String(VO_SAMPLE_RATE), "-c:a", "pcm_f32le", output], ctx);
}

async function isWav48kMono(file: string): Promise<boolean> {
  try {
    const h = await readWavHeader(file);
    return h.sampleRate === VO_SAMPLE_RATE && h.channels === 1;
  } catch {
    return false;
  }
}

/** Sample ranges to keep after lead/tail trimming (exact millisecond multiples). */
export function computeTrim(samples: Float32Array, sampleRate: number): { startSample: number; endSample: number; leadTrimMs: number } {
  const n = samples.length;
  const b = soundBounds(samples, TRIM_THRESHOLD_DB);
  if (!b) return { startSample: 0, endSample: n, leadTrimMs: 0 };
  const perMs = sampleRate / 1000;
  let leadTrimMs = 0;
  if (b.first / perMs >= TRIM_MIN_SILENCE_MS) leadTrimMs = Math.max(0, Math.floor(b.first / perMs - TRIM_PAD_MS));
  let endSample = n;
  if ((n - 1 - b.last) / perMs >= TRIM_MIN_SILENCE_MS) endSample = Math.min(n, Math.ceil(b.last + 1 + TRIM_PAD_MS * perMs));
  return { startSample: Math.round(leadTrimMs * perMs), endSample, leadTrimMs };
}

/**
 * Runs the post chain: output is 48 kHz mono s16. Returns the lead trim (callers shift word times by −leadTrimMs,
 * clamped ≥ 0) and the output duration.
 */
export async function runPostChain(input: string, output: string, o: { kind: "tts" | "recording"; rawFormat: RawFormat | null }, ctx: Ctx): Promise<{ leadTrimMs: number; durationMs: number }> {
  const tmpDecoded = `${output}.dec.wav`;
  const tmpOut = `${output}.tmp.wav`;
  try {
    let src = input;
    if (o.rawFormat || !(await isWav48kMono(input))) {
      await decodeTo48kMono(input, tmpDecoded, o.rawFormat, ctx);
      src = tmpDecoded;
    }
    const wav = await readWav(src);
    const samples = wav.data[0] ?? new Float32Array(0);
    if (samples.length === 0) throw new DocmakerError("VALIDATION", `${path.basename(input)}: no audio`);
    const t = computeTrim(samples, wav.sampleRate);
    const chain = `atrim=start_sample=${t.startSample}:end_sample=${t.endSample},asetpts=PTS-STARTPTS,${POST_FILTERS[o.kind]}`;
    await ffmpeg(["-i", src, "-af", chain, "-ar", String(VO_SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", "-f", "wav", tmpOut], ctx);
    await rename(tmpOut, output);
    const h = await readWavHeader(output);
    return { leadTrimMs: t.leadTrimMs, durationMs: h.durationMs };
  } finally {
    await rm(tmpDecoded, { force: true });
    await rm(tmpOut, { force: true });
  }
}
