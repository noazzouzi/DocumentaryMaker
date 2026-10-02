// @docmaker/remotion "." — public API (packages/remotion/src/index.ts). Browser-safe: no node:* (lint-enforced).
// P0 skeleton (SPEC §4.19 + §0.1 step 4): Documentary is a placeholder that W7 replaces; the types are verbatim.
import type React from "react";
import { BUILTIN_FONTS, type Timeline } from "@docmaker/core";
import { Documentary as DocumentaryImpl } from "./Documentary";
import { useTimeline as useTimelineImpl } from "./data/useTimeline";

export interface DocProps {
  timeline: Timeline | null; // Player: inline
  timelineUrl: string | null; // render worker: served by the asset server → inputProps stay tiny and identical across chunks
  assetBaseUrl: string; // render: "http://127.0.0.1:<port>/p"; Player: "/api/projects/<slug>/media"
  mode: "render" | "preview";
  layers: { picture: boolean; graphics: boolean; captions: boolean; hud: boolean; covers: boolean; audio: boolean };
  itemId: string | null;
  scratchBanner: boolean; // preview: "SCRATCH VO" banner when the timeline was built from a scratch take
}
export const Documentary: React.FC<DocProps> = DocumentaryImpl;
export const COMPOSITION_IDS = {
  doc: "Documentary", overlay: "DocumentaryOverlay", item: "OverlayItem",
  still: "GeneratedStill", gl: "GlProbe", fonts: "FontSpecimen", specimen: "StyleSpecimen",
} as const satisfies {
  readonly doc: "Documentary"; readonly overlay: "DocumentaryOverlay"; readonly item: "OverlayItem";
  readonly still: "GeneratedStill"; readonly gl: "GlProbe"; readonly fonts: "FontSpecimen"; readonly specimen: "StyleSpecimen";
};
/** Must equal core BUILTIN_FONTS (test). */
export const FONT_REGISTRY: readonly { family: string; weights: readonly number[]; italic: boolean }[] = BUILTIN_FONTS.map((f) => ({
  family: f.family, weights: f.weights, italic: f.italic,
}));
export function useTimeline(p: DocProps): Timeline | null {
  return useTimelineImpl(p);
}
/** Components implemented so far (M1/M2); others render FallbackCard. */
export const IMPLEMENTED_COMPONENTS: ReadonlySet<string> = new Set<string>();
