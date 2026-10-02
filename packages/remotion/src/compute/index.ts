// @docmaker/remotion/compute — PURE, no React, no node:* (used by calculateMetadata, the Player, render chunk planning, tests).
// P0 API stub (SPEC §4.19): every function throws DocmakerError("INTERNAL", "not implemented: …") until its owner lands it.
import { notImplemented } from "../notImplemented";
import type { CaptionGroup, FxCue, OverlayItem, Timeline, VisualClip } from "@docmaker/core";

export interface SeriesSeq { type: "seq"; clip: VisualClip; durationInFrames: number; headHandle: number; tailHandle: number; trimBefore: number }
export interface SeriesTrans { type: "trans"; clipId: string; presentation: "dissolve" | "blurDissolve" | "push" | "wipe"; durationInFrames: number; direction: "left" | "right" | "up" | "down" }
export interface ComputedChapter { id: string; from: number; dur: number; series: (SeriesSeq | SeriesTrans)[] }
export interface CoverWindow { id: string; clipId: string; cut: number; from: number; dur: number; presentation: string; color: string; peak: number; direction: string }
export interface VelocityEdge { preset: string; direction: string; frames: number; flash: number } // exit on A / entry on B
export interface ComputedTimeline {
  fps: number; width: number; height: number; durationInFrames: number;
  chapters: ComputedChapter[];
  covers: CoverWindow[];
  exits: Record<string, VelocityEdge>; // by outgoing clip id
  entries: Record<string, VelocityEdge>; // by incoming clip id
  cutFlashes: { from: number; dur: number; peak: number; color: string }[];
  pulses: { from: number; dur: number; amt: number }[];
  overlays: { picture: OverlayItem[]; graphics: OverlayItem[]; hud: OverlayItem[] }; // sorted by (z, from, id)
  captions: CaptionGroup[]; // burn === true only
  fx: FxCue[]; // + derived fx from covers (glitch → glitch+rgb)
  warnings: string[];
}
export function computeTimeline(t: Timeline): ComputedTimeline {
  throw notImplemented("remotion.computeTimeline");
}
/** Chapter-aligned chunks; chapters longer than chunkFrames are split evenly. */
export function planChunks(ct: ComputedTimeline, chunkFrames: number): { index: number; from: number; to: number }[] {
  throw notImplemented("remotion.planChunks");
}
/** sha256 (core pure-JS) of {ctx, fps, size, grade, render tokens, items intersecting [from−premount, to+premount] with frames
 *  NORMALISED to chunk-relative (f − from), their asset ids}. Lengthening CH1 does not invalidate unchanged later chunks. */
export function sliceHash(t: Timeline, from: number, to: number, ctx: { codeHash: string; preset: string; premount: number }): string {
  throw notImplemented("remotion.sliceHash");
}
