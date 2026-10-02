// Deterministic randomness for frames: every value is a pure function of (seed, key, n). Never Math.random().
import { fnv1a32, mulberry32, rngFor } from "@docmaker/core";

/** Uniform [0,1) for (seed, key, n) — stable across renders, tabs and chunk boundaries. */
export function hash01(seed: number | string, key: string, n = 0): number {
  const s = typeof seed === "number" ? seed : fnv1a32(seed);
  return mulberry32(fnv1a32(`${s}|${key}|${n}`))();
}
/** Uniform [-1, 1). */
export const hashSigned = (seed: number | string, key: string, n = 0): number => hash01(seed, key, n) * 2 - 1;
/** Seed number from any string id (clip ids, item ids). */
export const seedOf = (id: string): number => fnv1a32(id);
/** A seeded generator for building static layouts (positions of bars, cards, scribbles). */
export const rngOf = (seed: number, key: string): (() => number) => rngFor(seed, key);

/** Smooth 1D value noise in [-1, 1] (cosine-interpolated lattice): cheap, seedable, no dependencies. */
export function valueNoise1D(seed: number | string, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hashSigned(seed, "vn", i);
  const b = hashSigned(seed, "vn", i + 1);
  const t = (1 - Math.cos(Math.PI * f)) / 2;
  return a + (b - a) * t;
}
