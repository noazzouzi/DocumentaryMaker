// Shared helpers for director tests: cubic-bezier easing, camera sampling, cached scenario runs.
import type { CameraMove, Timeline } from "@docmaker/core";
import { TEST_STYLE } from "@docmaker/core/testing";
import { direct, type DirectorOutput } from "../src/index";
import { buildInputs } from "./fixtures";
import { richScenario } from "./rich";
import { policyScenario } from "./scenario";
import { tulipInputs } from "./tulip";

/** CSS cubic-bezier(x1, y1, x2, y2) easing: progress → eased value. */
export function bezier([x1, y1, x2, y2]: readonly [number, number, number, number]): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t;
  const Y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 12; i++) {
      const e = X(t) - x;
      if (Math.abs(e) < 1e-9) break;
      const d = dX(t);
      if (Math.abs(d) < 1e-9) break;
      t -= e / d;
    }
    let lo = 0, hi = 1;
    for (let i = 0; i < 40 && Math.abs(X(t) - x) > 1e-9; i++) { t = (lo + hi) / 2; if (X(t) < x) lo = t; else hi = t; }
    return Y(t);
  };
}

/** Camera scale at a local frame (keys + ease), as the remotion camera rig evaluates it. */
export function scaleAt(cam: CameraMove, f: number): number {
  const ks = cam.keys;
  if (ks.length === 1 || f <= ks[0]!.f) return ks[0]!.scale;
  const last = ks[ks.length - 1]!;
  if (f >= last.f) return last.scale;
  let i = 0;
  while (ks[i + 1]!.f < f) i++;
  const a = ks[i]!, b = ks[i + 1]!;
  const p = (f - a.f) / (b.f - a.f);
  const e = cam.ease === "kb" ? bezier(TEST_STYLE.motion.kbEase)(p) : cam.ease === "linear" ? p : p;
  return a.scale + (b.scale - a.scale) * e;
}

let cache: Record<string, DirectorOutput> | null = null;
/** Director outputs of the three reference scenarios (computed once per test file). */
export function runs(): Record<"rich" | "policy" | "tulip", DirectorOutput> {
  if (cache) return cache as Record<"rich" | "policy" | "tulip", DirectorOutput>;
  const sc = richScenario();
  const rich = direct(buildInputs({ script: sc.script, plans: sc.plans, slices: sc.slices, take: sc.take, frozen: sc.frozen, clips: sc.clips }).input);
  cache = { rich, policy: direct(policyScenario().input), tulip: direct(tulipInputs().input) };
  return cache as Record<"rich" | "policy" | "tulip", DirectorOutput>;
}

export const errorsOf = (o: DirectorOutput) => o.lint.filter((l) => l.level === "error");

/** Act ranges ≥ minSec of a timeline (frames). */
export function eligibleActs(t: Timeline, minSec: number): { act: string; from: number; end: number }[] {
  const out: { act: string; from: number; end: number }[] = [];
  let k = 0;
  while (k < t.chapters.length) {
    let j = k;
    while (j + 1 < t.chapters.length && t.chapters[j + 1]!.act === t.chapters[k]!.act) j++;
    const from = t.chapters[k]!.from, end = t.chapters[j]!.from + t.chapters[j]!.dur;
    if ((end - from) / t.fps >= minSec) out.push({ act: t.chapters[k]!.act, from, end });
    k = j + 1;
  }
  return out;
}
