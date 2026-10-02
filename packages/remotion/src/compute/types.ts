// Types of @docmaker/remotion/compute — verbatim from the §4.19 compute stub (the contract other agents code against).
import type { CaptionGroup, FxCue, OverlayItem, VisualClip } from "@docmaker/core";

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
