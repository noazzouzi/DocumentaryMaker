// SFX analysis (§11.2 "Manifest build"): sync point, sample peak, loudness, normalisation and seamless loops.
import type { SfxCategory } from "@docmaker/core";
import { CATEGORY_PEAK_DBFS } from "./recipes";

const SR = 48000;

/** Energy envelope in dB (sum over channels), centred moving window, 1 ms hop. */
export function energyEnvelopeDb(data: readonly Float32Array[], windowMs: number): Float64Array {
  const N = data[0]?.length ?? 0;
  const pre = new Float64Array(N + 1);
  for (let i = 0; i < N; i++) {
    let p = 0;
    for (const c of data) p += c[i]! * c[i]!;
    pre[i + 1] = pre[i]! + p;
  }
  const hop = SR / 1000;
  const half = Math.max(1, Math.round((windowMs * SR) / 2000));
  const out = new Float64Array(Math.ceil(N / hop));
  for (let k = 0; k < out.length; k++) {
    const s = k * hop;
    const a = Math.max(0, s - half), b = Math.min(N, s + half);
    out[k] = 10 * Math.log10((pre[b]! - pre[a]!) / Math.max(1, b - a) + 1e-20);
  }
  return out;
}

function lineFit(xs: number[], ys: number[]): { m: number; b: number } {
  const n = xs.length;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]!; my += ys[i]!; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i]! - mx) * (ys[i]! - my); sxx += (xs[i]! - mx) ** 2; }
  const m = sxx > 0 ? sxy / sxx : 0;
  return { m, b: my - m * mx };
}

/**
 * Peak of a swelling sound, in samples. The raw maximum of a noise sweep jitters by tens of ms, so the attack and decay
 * slopes of the log-energy envelope (the region within 9 dB of a 50 ms-smoothed maximum) are fitted with two lines and
 * intersected (≤ 3 refinements). Degenerate fits fall back to the smoothed maximum.
 */
export function envelopePeakIndex(data: readonly Float32Array[]): number {
  const N = data[0]?.length ?? 0;
  if (N === 0) return 0;
  const fine = energyEnvelopeDb(data, 10);
  const coarse = energyEnvelopeDb(data, 50);
  let p = 0;
  for (let k = 1; k < coarse.length; k++) if (coarse[k]! > coarse[p]!) p = k;
  const top = coarse[p]!;
  let a = p, b = p;
  while (a > 0 && coarse[a - 1]! > top - 9) a--;
  while (b < coarse.length - 1 && coarse[b + 1]! > top - 9) b++;
  for (let it = 0; it < 3; it++) {
    const lx: number[] = [], ly: number[] = [], rx: number[] = [], ry: number[] = [];
    for (let k = a; k <= b; k++) {
      if (k <= p) { lx.push(k); ly.push(fine[k]!); }
      if (k >= p) { rx.push(k); ry.push(fine[k]!); }
    }
    if (lx.length < 5 || rx.length < 5) break;
    const l = lineFit(lx, ly), r = lineFit(rx, ry);
    if (!(l.m > 0 && r.m < 0)) break;
    const q = Math.round(Math.min(b, Math.max(a, (r.b - l.b) / (l.m - r.m))));
    if (q === p) break;
    p = q;
  }
  return Math.min(N - 1, p * (SR / 1000));
}

/** Index of the max |sample| over channels, and that peak. */
export function maxAbs(data: readonly Float32Array[]): { index: number; peak: number } {
  let peak = 0;
  let index = 0;
  const N = data[0]?.length ?? 0;
  for (let i = 0; i < N; i++) {
    for (const c of data) {
      const a = Math.abs(c[i]!);
      if (a > peak) { peak = a; index = i; }
    }
  }
  return { index, peak };
}

/** First sample whose |x| reaches peak·10^(relDb/20). */
export function onsetIndex(data: readonly Float32Array[], peak: number, relDb = -30): number {
  const thr = peak * Math.pow(10, relDb / 20);
  const N = data[0]?.length ?? 0;
  for (let i = 0; i < N; i++) for (const c of data) if (Math.abs(c[i]!) >= thr) return i;
  return 0;
}

/**
 * Sync point in ms from the file start:
 * - `end`: duration − 30 ms;
 * - `peak`: the envelope peak (two-slope fit, see envelopePeakIndex: noise sweeps have no meaningful sample maximum);
 * - `onset`: the max |sample| when it belongs to the attack (≤ 25 ms after the onset), else the onset itself
 *   (first sample above −30 dB re. peak) — impacts, bells and textures are "hit" at their attack.
 */
export function syncPointMs(data: readonly Float32Array[], sync: "peak" | "onset" | "end"): number {
  const N = data[0]?.length ?? 0;
  if (N === 0) return 0;
  if (sync === "end") return Math.max(0, Math.round((N * 1000) / SR) - 30);
  if (sync === "peak") return Math.round((envelopePeakIndex(data) * 1000) / SR);
  const { index, peak } = maxAbs(data);
  if (peak <= 0) return 0;
  const on = onsetIndex(data, peak);
  const idx = index - on <= Math.round(0.025 * SR) ? index : on;
  return Math.round((idx * 1000) / SR);
}

/** Drops trailing samples below −90 dB re. peak (echo filters and hard stops leave digital tails), keeps 5 ms. */
export function trimTrailingSilence(data: Float32Array[]): Float32Array[] {
  const { peak } = maxAbs(data);
  if (peak <= 0) return data;
  const thr = peak * Math.pow(10, -90 / 20);
  const N = data[0]!.length;
  let last = N - 1;
  outer: for (; last > 0; last--) for (const c of data) if (Math.abs(c[last]!) > thr) break outer;
  const keep = Math.min(N, last + 1 + Math.round(0.005 * SR));
  return keep >= N ? data : data.map((c) => c.slice(0, keep));
}

/**
 * Folds `xfade` samples past `len` onto the head so sample len−1 → 0 is continuous:
 * out[i] = in[i]·wIn(i) + in[len+i]·wOut(i) for i < xfade. Linear law for periodic material, equal power for noise.
 */
export function foldLoop(data: readonly Float32Array[], len: number, law: "linear" | "power"): Float32Array[] {
  return data.map((c) => {
    const out = c.slice(0, len);
    const x = Math.min(c.length - len, len);
    for (let i = 0; i < x; i++) {
      const u = (i + 0.5) / x;
      const wIn = law === "linear" ? u : Math.sin((u * Math.PI) / 2);
      const wOut = law === "linear" ? 1 - u : Math.cos((u * Math.PI) / 2);
      out[i] = c[i]! * wIn + c[len + i]! * wOut;
    }
    return out;
  });
}

export function applyGain(data: Float32Array[], g: number): void {
  for (const c of data) for (let i = 0; i < c.length; i++) c[i] = c[i]! * g;
}

/** Middle of the category's peak range (dBFS); −18 when the category has no range. */
export function categoryMidPeakDb(category: SfxCategory): number {
  const r = CATEGORY_PEAK_DBFS[category];
  return r ? (r[0] + r[1]) / 2 : -18;
}

/** Energy 1–5 for a category (fallback when a pack does not provide one). */
export function categoryEnergy(category: SfxCategory): number {
  if (category === "impact" || category.startsWith("boom")) return 5;
  if (category === "riser" || category === "thud" || category === "whoosh.heavy") return 4;
  if (category === "whoosh.whip" || category === "whoosh.up" || category === "glitch" || category === "swell.reverse" || category === "tape.stop" || category === "heartbeat" || category === "impact.soft" || category === "scratch" || category === "cash") return 3;
  if (category === "click" || category === "tick" || category === "paper" || category === "marker" || category === "keys" || category.startsWith("ambience")) return 1;
  return 2;
}
