// Small shared helpers of @docmaker/audio (no WAV/loudness code here: that lives in @docmaker/core/node).
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DocmakerError } from "@docmaker/core";
import type { Logger, Progress, RuntimeConfig } from "@docmaker/core";
import { ffmpeg, readWav, readWavHeader } from "@docmaker/core/node";
import type { WavData } from "@docmaker/core/node";

export const SR = 48000;

export interface AudioCtx { config: RuntimeConfig; logger: Logger; signal: AbortSignal; progress: Progress }

export function checkAbort(signal: AbortSignal, what: string): void {
  if (signal.aborted) throw new DocmakerError("CANCELED", `${what} canceled`);
}

/** Yields to the event loop (keeps the job runner responsive between mixer blocks). */
export const yieldToLoop = (): Promise<void> => new Promise((r) => setImmediate(r));

export async function withTempDir<T>(prefix: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Writes through a sibling temp path then renames (readers never see a half-written file). */
export async function writeAtomically(target: string, write: (tmp: string) => Promise<void>): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Math.floor(performance.now() * 1000) % 1e9}${path.extname(target)}`;
  try {
    await write(tmp);
    await rename(tmp, target);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/**
 * Decodes any audio file to planar float32 at 48 kHz with `channels` channels. WAVs already at 48 kHz are read
 * directly (readWav); everything else (mp3/flac/m4a/mp4, other rates) goes through ffmpeg into a temp f32 WAV.
 */
export async function loadAudio48k(file: string, channels: 1 | 2, ctx: { config: RuntimeConfig; signal: AbortSignal }): Promise<WavData> {
  if (/\.wav$/i.test(file)) {
    const h = await readWavHeader(file);
    if (h.sampleRate === SR) {
      const w = await readWav(file);
      return matchChannels(w, channels);
    }
  }
  return withTempDir("docmaker-audio-dec-", async (dir) => {
    const tmp = path.join(dir, "dec.wav");
    await ffmpeg(["-i", file, "-map", "0:a:0", "-vn", "-ar", String(SR), "-ac", String(channels), "-c:a", "pcm_f32le", tmp], { config: ctx.config, signal: ctx.signal });
    return matchChannels(await readWav(tmp), channels);
  });
}

/** Downmix (average) or duplicate channels to reach `channels`. */
export function matchChannels(w: WavData, channels: 1 | 2): WavData {
  if (w.channels === channels) return w;
  const frames = w.data[0]?.length ?? 0;
  if (channels === 1) {
    const m = new Float32Array(frames);
    const k = 1 / w.channels;
    for (const c of w.data) for (let i = 0; i < frames; i++) m[i]! += c[i]! * k;
    return { sampleRate: w.sampleRate, channels: 1, data: [m] };
  }
  const src = w.data[0] ?? new Float32Array(0);
  return { sampleRate: w.sampleRate, channels: 2, data: [src, w.channels >= 2 ? w.data[1]! : src] };
}

export function samplePeak(data: readonly Float32Array[]): number {
  let pk = 0;
  for (const c of data) for (let i = 0; i < c.length; i++) {
    const a = Math.abs(c[i]!);
    if (a > pk) pk = a;
  }
  return pk;
}

export const toDb = (g: number): number => (g > 0 ? 20 * Math.log10(g) : -144);
export const fromDb = (db: number): number => Math.pow(10, db / 20);
