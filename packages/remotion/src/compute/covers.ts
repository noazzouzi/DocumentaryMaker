// Cover transitions (class 2, §10.5): an overlay centred on the cut — no timeline shortening, no dual render.
// Window timing + per-frame intensity are pure so the CoverLayer, the QA sheets and the tests agree.
import { DEFERRED_TRANSITIONS, type CoverPresentation, type FxCue, type TransitionKey, type VisualClip } from "@docmaker/core";
import { clamp01, smoothstep } from "../lib/easing";
import { seedOf } from "../lib/random";
import type { CoverWindow } from "./types";

/** Cover presentations with a real implementation in src/transitions/cover (others map via DEFERRED_TRANSITIONS). */
export const IMPLEMENTED_COVERS: ReadonlySet<CoverPresentation> = new Set<CoverPresentation>([
  "flash", "dipToBlack", "dipToWhite", "glitch", "lightLeak", "filmBurn", "whipStreaks", "paperRip", "dotWipe", "iris",
]);

/** Resolves a presentation to one that renders (DEFERRED_TRANSITIONS chain, else flash). */
export function resolveCover(p: string): { presentation: CoverPresentation; mapped: boolean } {
  let cur = p as TransitionKey;
  for (let i = 0; i < 4; i++) {
    if (IMPLEMENTED_COVERS.has(cur as CoverPresentation)) return { presentation: cur as CoverPresentation, mapped: cur !== p };
    const next = DEFERRED_TRANSITIONS[cur];
    if (!next) break;
    cur = next;
  }
  return { presentation: "flash", mapped: true };
}

/** Dip phases: out ≈ 0.4·d, hold ≈ 0.2·d, in = rest; the cut (A→B switch) sits mid-hold. */
export function dipPhases(d: number): { out: number; hold: number; inn: number; cutOffset: number } {
  const dd = Math.max(2, Math.round(d));
  const out = Math.max(1, Math.round(0.4 * dd));
  const hold = Math.max(1, Math.min(dd - out - 1, Math.round(0.2 * dd)));
  const inn = Math.max(0, dd - out - hold);
  return { out, hold, inn, cutOffset: out + Math.floor(hold / 2) };
}

/** Frames between the window start and the cut. */
export function coverCutOffset(presentation: string, d: number): number {
  if (presentation === "dipToBlack" || presentation === "dipToWhite") return dipPhases(d).cutOffset;
  return Math.floor(d / 2);
}

/** Window of a cover transition on `clip` (its transitionIn), clamped to [0, N). */
export function coverWindow(clip: VisualClip, N: number): CoverWindow | null {
  const tr = clip.transitionIn;
  if (tr.kind !== "cover") return null;
  const { presentation } = resolveCover(tr.presentation);
  const d = Math.max(2, tr.durationFrames);
  const cut = clip.from;
  let from = cut - coverCutOffset(presentation, d);
  let dur = d;
  if (from < 0) {
    dur += from;
    from = 0;
  }
  if (from + dur > N) dur = N - from;
  if (dur <= 0) return null;
  return { id: `cov:${clip.id}`, clipId: clip.id, cut, from, dur, presentation, color: tr.color, peak: tr.peak, direction: tr.direction };
}

/**
 * Main intensity (0..1, × peak where relevant) of a cover at absolute frame f. Presentations with spatial structure
 * (glitch bars, wipes, iris) use it as their progress driver.
 */
export function coverIntensity(w: Pick<CoverWindow, "presentation" | "cut" | "from" | "dur" | "peak">, f: number, fullDur?: number): number {
  const k = f - w.from;
  if (k < 0 || k >= w.dur) return 0;
  const d = Math.max(2, fullDur ?? w.dur);
  switch (w.presentation) {
    case "flash": {
      const half = d / 2;
      return w.peak * Math.max(0, 1 - Math.abs(f - w.cut) / half);
    }
    case "dipToBlack":
    case "dipToWhite": {
      const { out, hold, inn } = dipPhases(d);
      const kk = f - (w.cut - dipPhases(d).cutOffset);
      if (kk < out) return smoothstep(kk / out);
      if (kk < out + hold) return 1;
      return smoothstep(1 - (kk - out - hold + 1) / (inn + 1));
    }
    case "lightLeak":
    case "filmBurn": {
      const p = clamp01((k + 0.5) / d);
      return Math.sin(Math.PI * p) * (w.presentation === "lightLeak" ? Math.max(0.35, w.peak) : 1);
    }
    default:
      // glitch, whipStreaks, paperRip, dotWipe, iris: progress-shaped, full strength at the cut
      return 1 - Math.abs(f - w.cut) / (d / 2 + 1);
  }
}

/** Signed progress through the window: −1 at the start, 0 at the cut, +1 at the end (for wipes and irises). */
export function coverPhase(w: Pick<CoverWindow, "cut" | "from" | "dur">, f: number): number {
  const before = Math.max(1, w.cut - w.from);
  const after = Math.max(1, w.from + w.dur - w.cut);
  return f < w.cut ? -clamp01((w.cut - f) / before) : clamp01((f - w.cut + 1) / after);
}

/** Derived signal-damage fx for glitch covers (6 slices ±20 px with ~30 % near-clean frames, rgb 8–20 px). */
export function derivedCoverFx(w: CoverWindow): FxCue[] {
  if (w.presentation !== "glitch") return [];
  const seed = seedOf(w.clipId);
  const anchor = (offset: number) => ({ ref: "program" as const, edge: "start" as const, offset });
  const base = {
    start: anchor(w.from), end: anchor(w.from + w.dur), from: w.from, dur: w.dur, shape: "span" as const, pre: 0, curve: 1, fade: 1,
    decay: null, hz: null, ampY: null, rotDeg: null, x: null, y: null, color: null, seed, target: "picture" as const,
  };
  return [
    { ...base, id: `fx:${w.clipId}:cover-glitch`, fx: "glitch", amt: 20 },
    { ...base, id: `fx:${w.clipId}:cover-rgb`, fx: "rgb", amt: 8 + 12 * clamp01(w.peak) },
  ];
}
