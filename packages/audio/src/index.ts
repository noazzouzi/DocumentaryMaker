// @docmaker/audio — public API (packages/audio/src/index.ts). WAV I/O and loudness come from @docmaker/core/node.
import type { LicenseInfo, LoudnessDoc, MusicMood, ProgramLayout, SfxEntry, SfxManifest, Timeline } from "@docmaker/core";
import { notImplemented } from "./notImplemented";
import { SFX_RECIPES as RECIPES } from "./sfx/recipes";
import type { SfxRecipe as Recipe } from "./sfx/recipes";
import { ensureSfxPackImpl, loadSfxEntriesImpl } from "./sfx/packs";
import type { AudioCtx as Ctx } from "./util";
import { assembleVoProgramImpl } from "./vo/assemble";

export type AudioCtx = Ctx;
export type SfxRecipe = Recipe;
export const SFX_RECIPES: readonly SfxRecipe[] = RECIPES;

/** Generates <home>/sfx/<pack>/<version>/ once (machine lock), analyses peaks, writes manifest.json. */
export function ensureSfxPack(pack: "procedural" | "remotion-sfx-cc0" | "hyperframes-pixabay" | "user", ctx: AudioCtx): Promise<SfxManifest> {
  return ensureSfxPackImpl(pack, ctx);
}
export function loadSfxEntries(packs: readonly string[], ctx: AudioCtx): Promise<SfxEntry[]> {
  return loadSfxEntriesImpl(packs, ctx);
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
  return assembleVoProgramImpl(i, ctx);
}
/** Node mixer driven by core computeGainTables (preview parity) → mix.wav (s24 stereo 48 kHz) + 4 stems + loudness. */
export function mixTimeline(t: Timeline, i: { projectDir: string; outMixRel: string; stemRels: Record<"vo" | "music" | "sfx" | "clip", string>; targetLufs: number; truePeakTarget: number }, ctx: AudioCtx): Promise<Omit<LoudnessDoc, "schemaVersion" | "lang">> {
  throw notImplemented("audio.mixTimeline");
}
export function densityReport(t: Timeline): { sfxPerMin: number[]; impactsPerMin: number[]; silentCutShare: number; chapterRmsDb: Record<string, number> } {
  throw notImplemented("audio.densityReport");
}

// ---- additive exports
export { CATEGORY_PEAK_DBFS, M1_CATEGORIES, NON_PROCEDURAL_CATEGORIES, renderedDurationSec } from "./sfx/recipes";
export { PROCEDURAL_LICENSE, PROCEDURAL_PACK, PROCEDURAL_VERSION, proceduralDir, recipesStamp } from "./sfx/generate";
export { OPTIONAL_PACKS, installedEntriesById, readInstalledManifest } from "./sfx/packs";
export type { SfxPackId } from "./sfx/packs";
export { syncPointMs } from "./sfx/analyze";
export { VO_PEAK_GUARD_DBFS, VO_TARGET_LUFS, planVoParts } from "./vo/assemble";
export type { VoPart } from "./vo/assemble";
