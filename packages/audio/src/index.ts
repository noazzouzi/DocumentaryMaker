// @docmaker/audio — public API (packages/audio/src/index.ts). WAV I/O and loudness come from @docmaker/core/node.
// P0 API stub (SPEC §4.19): every function throws DocmakerError("INTERNAL", "not implemented: …") until its owner lands it.
import { notImplemented } from "./notImplemented";
import type { LicenseInfo, LoudnessDoc, Logger, MusicMood, Progress, ProgramLayout, RuntimeConfig, SfxCategory, SfxEntry, SfxManifest, Timeline } from "@docmaker/core";

export interface AudioCtx { config: RuntimeConfig; logger: Logger; signal: AbortSignal; progress: Progress }

export interface SfxRecipe {
  category: SfxCategory; variants: { variant: number; durationSec: number; seed: number }[];
  syncPoint: "peak" | "onset" | "end"; loopable: boolean;
  args(o: { durationSec: number; seed: number; sampleRate: 48000 }): string[]; // ffmpeg lavfi argument builder (port of make_sfx.sh)
}
export const SFX_RECIPES: readonly SfxRecipe[] = [];
/** Generates <home>/sfx/<pack>/<version>/ once (machine lock), analyses peaks, writes manifest.json. */
export function ensureSfxPack(pack: "procedural" | "remotion-sfx-cc0" | "hyperframes-pixabay" | "user", ctx: AudioCtx): Promise<SfxManifest> {
  throw notImplemented("audio.ensureSfxPack");
}
export function loadSfxEntries(packs: readonly string[], ctx: AudioCtx): Promise<SfxEntry[]> {
  throw notImplemented("audio.loadSfxEntries");
} // merged, sorted by id

export interface MusicGenOptions { mood: MusicMood; bpm: number; bars: number; seed: number; key: "A minor" | "D minor" | "E minor" | "C major"; energy: "low" | "mid" | "high" }
/** Deterministic Node synth → <home>/music/procedural/<hash>.wav at -18 LUFS with an exact beat grid. */
export function generateMusic(o: MusicGenOptions, ctx: AudioCtx): Promise<{ wavPath: string; beatsMs: number[]; downbeatsMs: number[]; durationMs: number; bpm: number }> {
  throw notImplemented("audio.generateMusic");
}
export function scanMusicLibrary(dir: string, ctx: AudioCtx): Promise<{ file: string; title: string; moods: MusicMood[]; license: LicenseInfo; bpm: number | null; beatsMs: number[]; downbeatsMs: number[]; durationMs: number }[]> {
  throw notImplemented("audio.scanMusicLibrary");
}

/** Places segment WAVs at frameToSample48k(segment.from) (+ REVEAL insertions), digital silence elsewhere, then bakes −16 LUFS. */
export function assembleVoProgram(i: { layout: Omit<ProgramLayout, "voProgram">; projectDir: string; outRel: string }, ctx: AudioCtx): Promise<{ sha256: string; bakedGainDb: number; durationMs: number }> {
  throw notImplemented("audio.assembleVoProgram");
}
/** Node mixer driven by core computeGainTables (preview parity) → mix.wav (s24 stereo 48 kHz) + 4 stems + loudness. */
export function mixTimeline(t: Timeline, i: { projectDir: string; outMixRel: string; stemRels: Record<"vo" | "music" | "sfx" | "clip", string>; targetLufs: number; truePeakTarget: number }, ctx: AudioCtx): Promise<Omit<LoudnessDoc, "schemaVersion" | "lang">> {
  throw notImplemented("audio.mixTimeline");
}
export function densityReport(t: Timeline): { sfxPerMin: number[]; impactsPerMin: number[]; silentCutShare: number; chapterRmsDb: Record<string, number> } {
  throw notImplemented("audio.densityReport");
}
