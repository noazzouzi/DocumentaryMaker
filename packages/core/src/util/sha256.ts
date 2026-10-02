// packages/core/src/util/sha256.ts — PURE-JS SHA-256 (FIPS 180-4) so hashing works in the browser, Remotion bundles
// and Node alike. Never import node:crypto here (lint + test enforced).
import { canonicalJson } from "./json";

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const encoder = new TextEncoder();
const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** SHA-256 of a UTF-8 string or raw bytes, as 64 lowercase hex chars. */
export function sha256Hex(data: string | Uint8Array): string {
  const msg = typeof data === "string" ? encoder.encode(data) : data;
  const len = msg.length;
  // padding: 0x80, zeros, 64-bit big-endian bit length; total multiple of 64 bytes
  const total = (((len + 9 + 63) >> 6) << 6);
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[len] = 0x80;
  const bitLenHi = Math.floor(len / 0x20000000); // len * 8 / 2^32
  const bitLenLo = (len << 3) >>> 0;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bitLenHi >>> 0, false);
  dv.setUint32(total - 4, bitLenLo, false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const x = w[i - 15]!, y = w[i - 2]!;
      const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
      const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  let out = "";
  for (const v of [h0, h1, h2, h3, h4, h5, h6, h7]) {
    out += HEX[(v >>> 24) & 0xff]! + HEX[(v >>> 16) & 0xff]! + HEX[(v >>> 8) & 0xff]! + HEX[v & 0xff]!;
  }
  return out;
}

/** sha256Hex(canonicalJson(v)). */
export function hashJson(v: unknown): string {
  return sha256Hex(canonicalJson(v));
}
export function sha16(s: string): string {
  return sha256Hex(s).slice(0, 16);
}
export function sha12(s: string): string {
  return sha256Hex(s).slice(0, 12);
}
export function sha8(s: string): string {
  return sha256Hex(s).slice(0, 8);
}

/** Wall-clock fields excluded from content hashes (docHash). */
export const VOLATILE_KEYS = ["updatedAt", "createdAt", "checkedAt", "frozenAt", "retrievedAt", "setAt", "generatedAt", "approvedAt", "probedAt", "installedAt"] as const;
const VOLATILE = new Set<string>(VOLATILE_KEYS);

/** Deep copy without VOLATILE_KEYS (at any depth). */
export function omitVolatile<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => omitVolatile(x)) as unknown as T;
  if (v !== null && typeof v === "object" && !ArrayBuffer.isView(v)) {
    const o = v as unknown as { toJSON?: () => unknown };
    const src: unknown = typeof o.toJSON === "function" ? o.toJSON() : v;
    if (src === null || typeof src !== "object") return src as T;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(src as Record<string, unknown>)) {
      if (VOLATILE.has(k)) continue;
      out[k] = omitVolatile(x);
    }
    return out as T;
  }
  return v;
}

/** Content hash used in EVERY stage inputs hash: hashJson(omitVolatile(doc)). Byte etags are only for optimistic concurrency. */
export function docHash(v: unknown): string {
  return hashJson(omitVolatile(v));
}
