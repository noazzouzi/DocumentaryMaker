// Velocity cut accents (§10.5): a hard cut with an exit animation on A and an entry animation on B (no dual render).
// This module extracts the per-clip edges; the per-frame transforms live in src/transitions/velocity.ts.
import type { VisualClip } from "@docmaker/core";
import type { VelocityEdge } from "./types";

export const IMPLEMENTED_VELOCITY: ReadonlySet<string> = new Set(["zoomThrough", "zoomThroughInverse", "whip", "cutTheCurve", "pushCut"]);
export const PUSH_CUT_FLASH_COLOR = "#f5f2ed";

export interface VelocityPair {
  exit: VelocityEdge | null; // on the outgoing clip A
  entry: VelocityEdge | null; // on the incoming clip B
  flash: { from: number; dur: number; peak: number; color: string } | null;
}

/** Edges for the cut between `prev` (A, may be null at program start) and `clip` (B). Frames are clamped to the clips. */
export function velocityPair(prev: VisualClip | null, clip: VisualClip): VelocityPair | null {
  const tr = clip.transitionIn;
  if (tr.kind !== "cut" || tr.accent.type !== "velocity") return null;
  const a = tr.accent;
  const exitFrames = prev ? Math.max(0, Math.min(a.exitFrames, prev.dur)) : 0;
  const entryFrames = Math.max(0, Math.min(a.entryFrames, clip.dur));
  const edge = (frames: number): VelocityEdge => ({ preset: a.preset, direction: a.direction, frames, flash: a.flash });
  const flashFrames = 2;
  return {
    exit: prev && exitFrames > 0 ? edge(exitFrames) : null,
    entry: entryFrames > 0 ? edge(entryFrames) : null,
    flash: a.flash > 0
      ? { from: clip.from - Math.floor(flashFrames / 2), dur: flashFrames, peak: Math.min(0.5, a.flash), color: a.preset === "pushCut" ? PUSH_CUT_FLASH_COLOR : "#FFFFFF" }
      : null,
  };
}
