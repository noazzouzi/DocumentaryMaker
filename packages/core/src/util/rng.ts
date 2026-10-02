// packages/core/src/util/rng.ts — deterministic randomness (never Math.random in hashed outputs). Isomorphic.
const encoder = new TextEncoder();

/** FNV-1a 32-bit over the UTF-8 bytes of s. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (const b of encoder.encode(s)) {
    h ^= b;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — identical to $SP/mgtest/motion.ts rng(). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** mulberry32(fnv1a32(`${seed}|${key}`)). */
export function rngFor(seed: number, key: string): () => number {
  return mulberry32(fnv1a32(`${seed}|${key}`));
}

/** r[0] + (r[1] - r[0]) · t */
export function lerp(r: readonly [number, number], t: number): number {
  return r[0] + (r[1] - r[0]) * t;
}

/** Weighted choice: keys sorted, zero/negative weights skipped; null when nothing is pickable. */
export function weightedPick<K extends string>(weights: Partial<Record<K, number>>, r: () => number): K | null {
  const keys = (Object.keys(weights) as K[]).filter((k) => {
    const w = weights[k];
    return typeof w === "number" && Number.isFinite(w) && w > 0;
  }).sort();
  if (keys.length === 0) return null;
  const total = keys.reduce((a, k) => a + (weights[k] as number), 0);
  let x = r() * total;
  for (const k of keys) {
    x -= weights[k] as number;
    if (x < 0) return k;
  }
  return keys[keys.length - 1]!;
}
