// @docmaker/director — public API (packages/director/src/index.ts). PURE: no I/O, no Date, no Math.random.
import { notImplemented } from "./notImplemented";
import type { AnchorIndex, BeatPlan, CaptionDNA, LayoutWord, LintIssue, OverridesDoc, ProgramLayout, StyleData, Timeline, FrozenAsset } from "@docmaker/core";
import type { DirectorInput, DirectorOutput } from "./types";

export { DIRECTOR_VERSION } from "./version";
export type { LayoutInput, DirectorInput, DirectorStats, DirectorOutput } from "./types";
export { layoutProgram } from "./layout";

export function direct(i: DirectorInput): DirectorOutput {
  void i;
  throw notImplemented("director.direct");
}
export function groupCaptions(words: readonly LayoutWord[], g: CaptionDNA["grouping"], fps: number): { words: LayoutWord[]; from: number; dur: number }[] {
  void words; void g; void fps;
  throw notImplemented("director.groupCaptions");
}
export function lintTimeline(t: Timeline, style: StyleData, ctx: { layout: ProgramLayout; layoutHash: string; frozen: Record<string, FrozenAsset> }): LintIssue[] {
  void t; void style; void ctx;
  throw notImplemented("director.lintTimeline");
}
export function applyOverrides(t: Timeline, o: OverridesDoc, ix: AnchorIndex, ctx: { style: StyleData; validateAsset: DirectorInput["validateAsset"]; plans: BeatPlan[] }): { timeline: Timeline; rejected: { id: string; reason: string }[] } {
  void t; void o; void ix; void ctx;
  throw notImplemented("director.applyOverrides");
}
export const LINT_RULES: Readonly<Record<string, { level: "error" | "warn"; help: string }>> = {};
