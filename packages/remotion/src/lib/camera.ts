// Clip camera (CameraMove keys → transform at a clip-local frame). Pure.
// Keys are clip-local (0 = the cut frame, excluding overlap handles). Outside the key range the move continues along
// its end tangent (bounded by the ≤ 15-frame handles), so a dissolve never "settles" a Ken Burns move.
import type { CameraMove, MotionTokens } from "@docmaker/core";
import { bezierOf, clamp01, endSlopes, expoOut, finite, inOutCubic, linear, type Ease } from "./easing";
import { monotoneSpline } from "./monotone";
import { valueNoise1D } from "./random";

export interface ClipCameraSample { scale: number; x: number; y: number; rot: number; blurPx: number }

const easeCache = new Map<string, { e: Ease; s: { start: number; end: number } }>();
function easeFor(kind: CameraMove["ease"], motion: Pick<MotionTokens, "kbEase">): { e: Ease; s: { start: number; end: number } } {
  const key = kind === "kb" ? `kb:${motion.kbEase.join(",")}` : kind;
  let v = easeCache.get(key);
  if (!v) {
    const e: Ease = kind === "kb" ? bezierOf(motion.kbEase) : kind === "expoOut" ? expoOut : kind === "inOutCubic" ? inOutCubic : linear;
    v = { e, s: endSlopes(e) };
    easeCache.set(key, v);
  }
  return v;
}

type Channel = "scale" | "x" | "y" | "rot";
const CHANNELS: Channel[] = ["scale", "x", "y", "rot"];

/**
 * Smallest scale at which a cover-filled frame (width × height, transform origin `cam.origin`) translated by (x, y)
 * still covers the frame: x ≤ (s−1)·ox, −x ≤ (s−1)·(W−ox), and the same for y. Sides closer than 1 px to the origin
 * cannot be covered by scaling and are ignored.
 */
export function minCoverScale(x: number, y: number, origin: { x: number; y: number }, width: number, height: number): number {
  const ox = origin.x * width, oy = origin.y * height;
  let need = 1;
  const side = (t: number, d: number) => { if (t > 0 && d >= 1) need = Math.max(need, 1 + t / d); };
  side(x, ox); side(-x, width - ox); side(y, oy); side(-y, height - oy);
  return Math.min(need, 1.25);
}

export function clipCameraAt(
  cam: CameraMove, localFrame: number, motion: Pick<MotionTokens, "kbEase">,
  opts?: { fps?: number; seed?: number; cover?: { width: number; height: number } },
): ClipCameraSample {
  const keys = [...cam.keys].sort((a, b) => a.f - b.f);
  const out: ClipCameraSample = { scale: 1, x: 0, y: 0, rot: 0, blurPx: 0 };
  if (keys.length === 0) return out;
  const f = localFrame;
  if (keys.length === 1) {
    const k = keys[0]!;
    Object.assign(out, { scale: k.scale, x: k.x, y: k.y, rot: k.rot });
  } else if (cam.ease === "monotone") {
    const xs = keys.map((k) => k.f);
    for (const ch of CHANNELS) out[ch] = monotoneSpline(xs, keys.map((k) => k[ch])).at(f);
  } else {
    const { e, s } = easeFor(cam.ease, motion);
    const first = keys[0]!;
    const last = keys[keys.length - 1]!;
    if (f <= first.f) {
      const k1 = keys[1]!;
      const span = Math.max(1, k1.f - first.f);
      for (const ch of CHANNELS) out[ch] = first[ch] + ((k1[ch] - first[ch]) / span) * s.start * (f - first.f);
    } else if (f >= last.f) {
      const k0 = keys[keys.length - 2]!;
      const span = Math.max(1, last.f - k0.f);
      for (const ch of CHANNELS) out[ch] = last[ch] + ((last[ch] - k0[ch]) / span) * s.end * (f - last.f);
    } else {
      let i = 0;
      while (i < keys.length - 2 && f >= keys[i + 1]!.f) i++;
      const a = keys[i]!;
      const b = keys[i + 1]!;
      const p = e(clamp01((f - a.f) / Math.max(1, b.f - a.f)));
      for (const ch of CHANNELS) out[ch] = a[ch] + (b[ch] - a[ch]) * p;
    }
  }
  // pull-back entry blur: blurFromPx → 0 across the first key segment
  if (cam.blurFromPx > 0) {
    const a = keys[0]!;
    const b = keys[1] ?? a;
    const span = Math.max(1, b.f - a.f);
    const p = f <= a.f ? 0 : clamp01((f - a.f) / span);
    out.blurPx = cam.blurFromPx * (1 - expoOut(p));
  }
  if (cam.handheld && cam.handheld.ampPx > 0) {
    const fps = opts?.fps ?? 30;
    const step = Math.floor((Math.max(0, f) * Math.max(0.5, cam.handheld.fps)) / fps);
    const seed = opts?.seed ?? 0;
    out.x += valueNoise1D(`${seed}hx`, step * 0.73) * cam.handheld.ampPx;
    out.y += valueNoise1D(`${seed}hy`, step * 0.61) * cam.handheld.ampPx;
  }
  out.scale = Math.max(0.05, finite(out.scale, 1));
  out.x = finite(out.x);
  out.y = finite(out.y);
  // cover-filled pictures never show the background: the overlap-handle extrapolation (below the first / past the
  // last key) and the handheld noise may leave the cover region, so the scale is raised back to it
  if (opts?.cover) out.scale = Math.max(out.scale, minCoverScale(out.x, out.y, cam.origin, opts.cover.width, opts.cover.height));
  out.rot = finite(out.rot);
  return out;
}
