// Cover transitions (class 2, §10.5): an overlay centred on the cut — no timeline shortening, no dual render.
// Window timing + per-frame intensity are pure so the CoverLayer, the QA sheets and the tests agree.
import { DEFERRED_TRANSITIONS, type CoverPresentation, type FxCue, type TransitionKey, type VisualClip } from "@docmaker/core";
import { clamp01, inCubic, inOutCubic, outCubic, smoothstep } from "../lib/easing";
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

// ---- M3 cover geometry (pure: the cover components draw exactly these numbers, the unit tests check them)

/**
 * Occlusion of the hard-switch covers (dotWipe, iris): rises to 1 on the frame before the cut, stays 1 on the cut frame,
 * then falls back; 0 outside the window. Both frames around the A→B switch are fully covered, so the cut never shows.
 */
export function coverAmount(w: Pick<CoverWindow, "cut" | "from" | "dur">, f: number): number {
  if (f < w.from || f >= w.from + w.dur) return 0;
  const before = Math.max(1, w.cut - w.from);
  const after = Math.max(1, w.from + w.dur - w.cut);
  return f < w.cut ? clamp01((f - w.from + 1) / before) : clamp01(1 - (f - w.cut) / after);
}

/**
 * Iris radius (px, centred) for an occlusion amount: the half diagonal (fully open) → 0 (closed), inOutCubic. The
 * first ~12 % of the amount is a dead zone so the window's edge frames never show black corners (no pop at the ends).
 */
export function irisRadius(amount: number, width = 1920, height = 1080): number {
  const R = Math.hypot(width / 2, height / 2) + 2;
  return R * (1 - inOutCubic(clamp01((amount - 0.12) / 0.88)));
}

export const DOT_GRID_PX = 80;
const DOT_STAGGER = 0.6;
/** Radius at which one dot covers its whole grid cell (half the cell diagonal + 1 px). */
export const dotFullRadius = (grid = DOT_GRID_PX): number => (grid * Math.SQRT2) / 2 + 1;
/**
 * Dot-wipe dot radius. `pos` = position along the motion (0 = leading edge … 1 = trailing edge). Closing (before the
 * cut) the leading dots fill first; opening (after it) the leading dots empty first, so the wave keeps its direction.
 * amount = 1 → every dot ≥ dotFullRadius (the frame is fully covered).
 */
export function dotRadius(amount: number, pos: number, closing: boolean, grid = DOT_GRID_PX): number {
  const q = clamp01(closing ? pos : 1 - pos);
  const local = clamp01(clamp01(amount) * (1 + DOT_STAGGER) - q * DOT_STAGGER);
  return dotFullRadius(grid) * smoothstep(local);
}
/** Position of grid cell (i, j) along the motion of a cover direction (0 = leading edge). */
export function dotPos(i: number, j: number, cols: number, rows: number, direction: string): number {
  const along = direction === "up" || direction === "down" ? j / Math.max(1, rows - 1) : i / Math.max(1, cols - 1);
  // "left" = motion goes left: the right edge leads
  return direction === "left" || direction === "up" ? 1 - along : along;
}

/** Paper rip state: `lead` = the sheet's torn leading edge in motion units (1 = entry side, ≤ PAPER_LEAD_COVER covers
 *  the frame) before the cut; after it the sheet tears along the middle and the halves pull apart by `open` each. */
export interface PaperRipState { phase: "in" | "out"; lead: number; open: number; rotDeg: number }
export const PAPER_EDGE_JAG = 0.035; // max |jag| of a torn edge (motion units)
export const PAPER_TEAR_JAG = 0.05;
const PAPER_LEAD_START = 1 + PAPER_EDGE_JAG + 0.015;
const PAPER_LEAD_END = -(PAPER_EDGE_JAG + 0.045);
const PAPER_OPEN = 0.8;
export function paperRipState(w: Pick<CoverWindow, "cut" | "from" | "dur">, f: number): PaperRipState | null {
  if (f < w.from || f >= w.from + w.dur) return null;
  const before = Math.max(1, w.cut - w.from);
  const after = Math.max(1, w.from + w.dur - w.cut);
  if (f < w.cut) {
    const p = clamp01((f - w.from + 0.5) / before);
    return { phase: "in", lead: PAPER_LEAD_START + (PAPER_LEAD_END - PAPER_LEAD_START) * outCubic(p), open: 0, rotDeg: 0 };
  }
  const q = clamp01((f - w.cut + 0.5) / after);
  const e = inCubic(q);
  return { phase: "out", lead: PAPER_LEAD_END, open: PAPER_OPEN * e, rotDeg: 5 * e };
}

/** Film burn over-exposure (0..1): a near-white flash where the burn peaks, so the splice itself is never visible. */
export const filmBurnWhite = (intensity: number): number => smoothstep((intensity - 0.8) / 0.2);

/** Whip-streak smear wash (0..1): peaks on the two frames around the cut. */
export function whipWash(w: Pick<CoverWindow, "cut" | "from" | "dur">, f: number): number {
  if (f < w.from || f >= w.from + w.dur) return 0;
  return smoothstep(1 - Math.abs(f - (w.cut - 0.5)) / 2.5);
}
