// Monotone cubic (Fritsch–Carlson) interpolation through keyframes: no overshoot between keys, C1-continuous.
// Used by the camera ease "monotone" (multi-key moves that must never bounce past a key).

export interface MonotoneSpline {
  /** Value at x; outside the key range it extrapolates linearly along the end tangents. */
  at(x: number): number;
}

export function monotoneSpline(xs: readonly number[], ys: readonly number[]): MonotoneSpline {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return { at: () => 0 };
  if (n === 1) {
    const y0 = ys[0]!;
    return { at: () => y0 };
  }
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1]! - xs[i]!;
    dx.push(h);
    slope.push(h === 0 ? 0 : (ys[i + 1]! - ys[i]!) / h);
  }
  // initial tangents: three-point averages, then Fritsch–Carlson limiting
  const m: number[] = new Array<number>(n);
  m[0] = slope[0]!;
  m[n - 1] = slope[n - 2]!;
  for (let i = 1; i < n - 1; i++) {
    const s0 = slope[i - 1]!;
    const s1 = slope[i]!;
    m[i] = s0 * s1 <= 0 ? 0 : (s0 + s1) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const s = slope[i]!;
    if (s === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / s;
    const b = m[i + 1]! / s;
    const h = a * a + b * b;
    if (h > 9) {
      const tau = 3 / Math.sqrt(h);
      m[i] = tau * a * s;
      m[i + 1] = tau * b * s;
    }
  }
  return {
    at(x: number): number {
      if (x <= xs[0]!) return ys[0]! + m[0]! * (x - xs[0]!);
      if (x >= xs[n - 1]!) return ys[n - 1]! + m[n - 1]! * (x - xs[n - 1]!);
      let i = 0;
      // keys are few (≤ ~8): linear scan is fastest
      while (i < n - 2 && x >= xs[i + 1]!) i++;
      const h = dx[i]!;
      if (h === 0) return ys[i + 1]!;
      const t = (x - xs[i]!) / h;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      return h00 * ys[i]! + h10 * h * m[i]! + h01 * ys[i + 1]! + h11 * h * m[i + 1]!;
    },
  };
}
