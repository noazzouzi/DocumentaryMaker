// generateMusic (§11.3): deterministic score → <home>/music/procedural/<hash>.wav normalised to −18 LUFS, exact beat grid.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { DocmakerError, sha16, stableStringify } from "@docmaker/core";
import { measureEbur128, readWavHeader, withFileLock, writeWav } from "@docmaker/core/node";
import { SR, toDb, withTempDir, writeAtomically } from "../util";
import type { AudioCtx } from "../util";
import { SYNTH_VERSION, beatSample, renderScore } from "./instruments";

export const MUSIC_TARGET_LUFS = -18;
const PEAK_CEILING_DBFS = -1;

export interface MusicGenOpts { mood: import("@docmaker/core").MusicMood; bpm: number; bars: number; seed: number; key: "A minor" | "D minor" | "E minor" | "C major"; energy: "low" | "mid" | "high" }
export interface MusicGenResult { wavPath: string; beatsMs: number[]; downbeatsMs: number[]; durationMs: number; bpm: number }

/** Content hash of a request (also the cache file name). */
export function musicHash(o: MusicGenOpts): string {
  return sha16(stableStringify({ v: SYNTH_VERSION, mood: o.mood, bpm: o.bpm, bars: o.bars, seed: o.seed, key: o.key, energy: o.energy, sr: SR }, 0));
}

/** The exact grid: beat i at round(i·60/bpm·sr) samples, reported in ms; downbeats every 4 beats. */
export function beatGrid(bpm: number, bars: number): { beatsMs: number[]; downbeatsMs: number[]; durationMs: number } {
  const beatsMs: number[] = [];
  for (let i = 0; i < bars * 4; i++) beatsMs.push(Math.round((beatSample(i, bpm, SR) * 1000) / SR));
  return { beatsMs, downbeatsMs: beatsMs.filter((_, i) => i % 4 === 0), durationMs: Math.round((beatSample(bars * 4, bpm, SR) * 1000) / SR) };
}

function validate(o: MusicGenOpts): void {
  if (!(Number.isFinite(o.bpm) && o.bpm >= 40 && o.bpm <= 220)) throw new DocmakerError("VALIDATION", `generateMusic: bpm ${o.bpm} outside 40–220`);
  if (!(Number.isInteger(o.bars) && o.bars >= 1 && o.bars <= 512)) throw new DocmakerError("VALIDATION", `generateMusic: bars ${o.bars} must be an integer in 1–512`);
  if (!Number.isInteger(o.seed)) throw new DocmakerError("VALIDATION", "generateMusic: seed must be an integer");
}

export async function generateMusicImpl(o: MusicGenOpts, ctx: AudioCtx): Promise<MusicGenResult> {
  validate(o);
  const hash = musicHash(o);
  const dir = ctx.config.paths.music;
  const wavPath = path.join(dir, `${hash}.wav`);
  const metaPath = path.join(dir, `${hash}.json`);
  const grid = beatGrid(o.bpm, o.bars);
  const result: MusicGenResult = { wavPath, ...grid, bpm: o.bpm };
  const loopSamples = beatSample(o.bars * 4, o.bpm, SR);
  const cached = async () => {
    if (!existsSync(wavPath) || !existsSync(metaPath)) return false;
    try {
      const h = await readWavHeader(wavPath);
      const meta = JSON.parse(await readFile(metaPath, "utf8")) as { hash?: string };
      return h.frames === loopSamples && h.sampleRate === SR && meta.hash === hash;
    } catch {
      return false;
    }
  };
  if (await cached()) return result;
  await mkdir(dir, { recursive: true });
  return withFileLock(path.join(ctx.config.paths.locks, `music-${hash}.lock`), "audio.generateMusic", async () => {
    if (await cached()) return result;
    ctx.progress(0, `synthesising ${o.mood}/${o.energy} music (${o.bars} bars at ${o.bpm} BPM)`);
    const score = renderScore({ ...o, sampleRate: SR });
    ctx.progress(0.7, "normalising the music bed");
    const data = [score.L, score.R];
    await withTempDir("docmaker-music-", async (tmp) => {
      const raw = path.join(tmp, "raw.wav");
      await writeWav(raw, { sampleRate: SR, channels: 2, data }, "f32");
      const m = await measureEbur128(raw, { config: ctx.config, signal: ctx.signal });
      let peak = 0;
      for (const c of data) for (let i = 0; i < c.length; i++) peak = Math.max(peak, Math.abs(c[i]!));
      const gainDb = Math.min(MUSIC_TARGET_LUFS - m.integratedLufs, PEAK_CEILING_DBFS - toDb(peak));
      const g = Math.pow(10, gainDb / 20);
      for (const c of data) for (let i = 0; i < c.length; i++) c[i] = c[i]! * g;
    });
    await writeAtomically(wavPath, (tmp) => writeWav(tmp, { sampleRate: SR, channels: 2, data }, "s24"));
    await writeFile(metaPath, stableStringify({ hash, synth: SYNTH_VERSION, options: o, instruments: score.instruments, ...grid }));
    ctx.progress(1, "music ready");
    ctx.logger.info("procedural music generated", { hash, mood: o.mood, energy: o.energy, bpm: o.bpm, bars: o.bars });
    return result;
  }, { signal: ctx.signal });
}
