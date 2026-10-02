// Pure easing helpers (no React, no remotion): cubic-bezier solver, named eases and the camera ease table.
// Kept framework-free so compute/, fx/ and unit tests share the exact same curves as the components.

export type Ease = (x: number) => number;
export type Bezier4 = readonly [number, number, number, number];

export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => clamp(x, 0, 1);
/** Guards NaN/±Infinity (never let a bad number reach a CSS value). */
export const finite = (x: number, fallback = 0): number => (Number.isFinite(x) ? x : fallback);

/**
 * CSS cubic-bezier(x1, y1, x2, y2) as a function of x ∈ [0,1] (Newton–Raphson with a bisection fallback).
 * Identical in shape to remotion's Easing.bezier; outputs may exceed [0,1] for overshooting curves.
 */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solveT = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sampleX(t);
      if (Math.abs(v - x) < 1e-7) return t;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return sampleY(solveT(x));
  };
}
export const bezierOf = (b: Bezier4): Ease => bezier(b[0], b[1], b[2], b[3]);

// ---- named eases (GSAP naming where the spec uses it)
export const linear: Ease = (x) => x;
export const easeOutExpo: Ease = (x) => (x >= 1 ? 1 : x <= 0 ? 0 : 1 - Math.pow(2, -10 * x));
export const easeInExpo: Ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, 10 * x - 10));
export const easeInOutExpo: Ease = (x) =>
  x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2;
export const power = (n: number) => ({
  in: ((x: number) => Math.pow(clamp01(x), n)) as Ease,
  out: ((x: number) => 1 - Math.pow(1 - clamp01(x), n)) as Ease,
  inOut: ((x: number) => {
    const c = clamp01(x);
    return c < 0.5 ? Math.pow(2, n - 1) * Math.pow(c, n) : 1 - Math.pow(-2 * c + 2, n) / 2;
  }) as Ease,
});
/** GSAP power2 = cubic, power3 = quartic, power4 = quintic. */
export const power2 = power(3);
export const power3 = power(4);
export const power4 = power(5);
export const inOutCubic: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const outCubic: Ease = (x) => 1 - Math.pow(1 - clamp01(x), 3);
export const inCubic: Ease = (x) => Math.pow(clamp01(x), 3);
export const smoothstep: Ease = (x) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};
/** expo.out ≈ cubic-bezier(0.16, 1, 0.3, 1): the default entry ease of the component library. */
export const EXPO_OUT_BEZIER: Bezier4 = [0.16, 1, 0.3, 1];
export const expoOut: Ease = bezierOf(EXPO_OUT_BEZIER);

/** Numerical end slopes of an ease (dy/dx at x=0 and x=1). Used to extrapolate camera moves through overlap handles. */
export function endSlopes(e: Ease, eps = 1e-4): { start: number; end: number } {
  return { start: (e(eps) - e(0)) / eps, end: (e(1) - e(1 - eps)) / eps };
}

/** Progress of `f` through [start, start + frames) eased, clamped to [0, 1] (frames ≤ 0 → step at start). */
export function prog(f: number, start: number, frames: number, e: Ease = linear): number {
  if (frames <= 0) return f >= start ? 1 : 0;
  return e(clamp01((f - start) / frames));
}

/** Linear map of `x` from [a0,a1] to [b0,b1] (clamped). */
export function remap(x: number, a0: number, a1: number, b0: number, b1: number): number {
  if (a1 === a0) return x >= a1 ? b1 : b0;
  return b0 + (b1 - b0) * clamp01((x - a0) / (a1 - a0));
}
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
