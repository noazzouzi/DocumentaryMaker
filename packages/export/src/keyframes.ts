// Camera keys × punch/zoom fx → NLE transform keyframes (§13.1, §13.4). Pure.
//
// Remotion draws a clip with CSS `translate(x,y) rotate(r) scale(s)` about transform-origin o (the focal point), and the
// fx camera rig scales the result again about each cue's origin. NLEs scale/rotate about the frame centre c and offset
// the centre by a position. Equating both: pos = (o − c) + t + R(r)·s·(c − o); a rig scale k about o2 then gives
// pos' = k·pos + (k − 1)(c − o2), s' = k·s. The math (eases, envelopes, monotone spline) mirrors @docmaker/remotion
// (lib/easing, lib/camera, lib/monotone, fx/envelope) so the NLE framing equals the render.
import type { CameraMove, FxCue, Keyframe, Keyframe2, VisualClip } from "@docmaker/core";

export type Ease = (x: number) => number;
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** CSS cubic-bezier(x1, y1, x2, y2). */
export function bezier(x1: number, y1: number, x2: number, y2: number): Ease {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  const solve = (x: number): number => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const err = sx(t) - x;
      if (Math.abs(err) < 1e-7) return t;
      const d = dx(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 40; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-7) return t;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };
  return (x) => (x <= 0 ? 0 : x >= 1 ? 1 : sy(solve(x)));
}
export const linear: Ease = (x) => x;
export const easeOutExpo: Ease = (x) => (x >= 1 ? 1 : x <= 0 ? 0 : 1 - Math.pow(2, -10 * x));
export const expoOut: Ease = bezier(0.16, 1, 0.3, 1);
export const inOutCubic: Ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export function endSlopes(e: Ease, eps = 1e-4): { start: number; end: number } {
  return { start: (e(eps) - e(0)) / eps, end: (e(1) - e(1 - eps)) / eps };
}

/** Fritsch–Carlson monotone cubic through (xs, ys); linear extrapolation along the end tangents. */
export function monotoneSpline(xs: readonly number[], ys: readonly number[]): (x: number) => number {
  const n = Math.min(xs.length, ys.length);
  if (n === 0) return () => 0;
  if (n === 1) return () => ys[0]!;
  const dx: number[] = [];
  const sl: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1]! - xs[i]!;
    dx.push(h);
    sl.push(h === 0 ? 0 : (ys[i + 1]! - ys[i]!) / h);
  }
  const m: number[] = new Array<number>(n);
  m[0] = sl[0]!;
  m[n - 1] = sl[n - 2]!;
  for (let i = 1; i < n - 1; i++) m[i] = sl[i - 1]! * sl[i]! <= 0 ? 0 : (sl[i - 1]! + sl[i]!) / 2;
  for (let i = 0; i < n - 1; i++) {
    const s = sl[i]!;
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
  return (x) => {
    if (x <= xs[0]!) return ys[0]! + m[0]! * (x - xs[0]!);
    if (x >= xs[n - 1]!) return ys[n - 1]! + m[n - 1]! * (x - xs[n - 1]!);
    let i = 0;
    while (i < n - 2 && x >= xs[i + 1]!) i++;
    const h = dx[i]!;
    if (h === 0) return ys[i + 1]!;
    const t = (x - xs[i]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i]! + (t3 - 2 * t2 + t) * h * m[i]! + (-2 * t3 + 3 * t2) * ys[i + 1]! + (t3 - t2) * h * m[i + 1]!;
  };
}

/** Fx envelope (§10.6), identical to remotion fx/envelope.ts. */
export function fxEnv(cue: Pick<FxCue, "fx" | "from" | "dur" | "pre" | "shape" | "curve" | "fade" | "decay">, f: number, fps: number): number {
  const pre = Math.max(0, cue.pre);
  if (f < cue.from - pre) return 0;
  if (f < cue.from) {
    const q = (f - (cue.from - pre) + 1) / (pre + 1);
    return q * q;
  }
  const t = f - cue.from;
  if (t >= cue.dur) return 0;
  if (cue.shape === "hit") {
    if (cue.decay != null) return Math.exp((-cue.decay * t) / Math.max(1, fps));
    const base = Math.max(0, 1 - t / Math.max(cue.dur, 1));
    return Math.pow(base, cue.curve > 0 ? cue.curve : 1);
  }
  const fade = Math.max(cue.fade, 1);
  if (cue.fx === "zoom") return Math.min(1, easeOutExpo((t + 1) / fade));
  return Math.max(0, Math.min(1, (t + 1) / fade, (cue.dur - t) / fade));
}

type Channel = "scale" | "x" | "y" | "rot";
const CHANNELS: Channel[] = ["scale", "x", "y", "rot"];
export interface CamSample { scale: number; x: number; y: number; rot: number }

function easeOf(kind: CameraMove["ease"], kbEase: readonly [number, number, number, number]): Ease {
  if (kind === "kb") return bezier(kbEase[0], kbEase[1], kbEase[2], kbEase[3]);
  if (kind === "expoOut") return expoOut;
  if (kind === "inOutCubic") return inOutCubic;
  return linear;
}

/** Exact Remotion clip camera at a clip-local frame (handheld noise excluded: not portable). */
export function exactCamera(cam: CameraMove, f: number, kbEase: readonly [number, number, number, number]): CamSample {
  const keys = [...cam.keys].sort((a, b) => a.f - b.f);
  const out: CamSample = { scale: 1, x: 0, y: 0, rot: 0 };
  if (keys.length === 0) return out;
  if (keys.length === 1) return { scale: keys[0]!.scale, x: keys[0]!.x, y: keys[0]!.y, rot: keys[0]!.rot };
  if (cam.ease === "monotone") {
    const xs = keys.map((k) => k.f);
    for (const ch of CHANNELS) out[ch] = monotoneSpline(xs, keys.map((k) => k[ch]))(f);
    return out;
  }
  const e = easeOf(cam.ease, kbEase);
  const s = endSlopes(e);
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
  return out;
}

/** The NLE's own model of a 2-key move: linear between the keys, extrapolated with the ease's end slopes (handles). */
function linearCamera(cam: CameraMove, f: number, kbEase: readonly [number, number, number, number]): CamSample {
  const keys = [...cam.keys].sort((a, b) => a.f - b.f);
  if (keys.length < 2) return exactCamera(cam, f, kbEase);
  const a = keys[0]!;
  const b = keys[keys.length - 1]!;
  const s = endSlopes(easeOf(cam.ease, kbEase));
  const span = Math.max(1, b.f - a.f);
  const out: CamSample = { scale: 1, x: 0, y: 0, rot: 0 };
  for (const ch of CHANNELS) {
    const slope = (b[ch] - a[ch]) / span;
    if (f <= a.f) out[ch] = a[ch] + slope * s.start * (f - a.f);
    else if (f >= b.f) out[ch] = b[ch] + slope * s.end * (f - b.f);
    else out[ch] = a[ch] + slope * (f - a.f);
  }
  return out;
}

/** NLE transform: uniform scale about the frame centre, centre offset in px (+y down), rotation in deg (clockwise). */
export interface Xf { s: number; dx: number; dy: number; rot: number }

export function cameraToNle(c: CamSample, origin: { x: number; y: number }, W: number, H: number): Xf {
  const ox = origin.x * W;
  const oy = origin.y * H;
  const cx = W / 2;
  const cy = H / 2;
  const r = (c.rot * Math.PI) / 180;
  const vx = c.scale * (cx - ox);
  const vy = c.scale * (cy - oy);
  return {
    s: c.scale,
    dx: ox - cx + c.x + (Math.cos(r) * vx - Math.sin(r) * vy),
    dy: oy - cy + c.y + (Math.sin(r) * vx + Math.cos(r) * vy),
    rot: c.rot,
  };
}

/** Applies a rig scale k about origin o2 (px) to an NLE transform. */
export function scaleAbout(x: Xf, k: number, o2x: number, o2y: number, W: number, H: number): Xf {
  if (!(k > 0) || k === 1) return x;
  return { s: x.s * k, dx: k * x.dx + (k - 1) * (W / 2 - o2x), dy: k * x.dy + (k - 1) * (H / 2 - o2y), rot: x.rot };
}

export const SCALE_FX = new Set(["punch", "zoom"]);
export const NON_PORTABLE_FX = new Set(["shake", "rgb", "glitch", "flash", "dark", "blur"]);

export interface ClipMotionInput {
  clip: VisualClip;
  fx: readonly FxCue[];
  fps: number;
  width: number;
  height: number;
  kbEase: readonly [number, number, number, number];
  /** Frames of media shown after the cut (outgoing dissolve tail handle = d/2). */
  tailFrames: number;
  /** Extra uniform multiplier (pip 0.76). */
  baseScale?: number;
  /** Cap for camera-only dense sampling (fx windows stay dense). */
  maxDenseKeys?: number;
}
export interface ClipMotion { scale: Keyframe[]; position: Keyframe2[]; rotation: Keyframe[]; dense: boolean }

/** Is this camera exported as its own 2 keyframes (§13.1)? */
export function isSparseCamera(cam: CameraMove): boolean {
  if (cam.keys.length <= 1) return true;
  return cam.keys.length === 2 && (cam.ease === "linear" || cam.ease === "kb") && cam.kind !== "pullBack";
}

/** Evenly subsampled integer frames over [a, b] (both ends included), at most `max` of them. */
export function evenFrames(a: number, b: number, max: number): number[] {
  const n = b - a + 1;
  if (n <= 0) return [];
  if (n <= max) return Array.from({ length: n }, (_, i) => a + i);
  const out = new Set<number>();
  for (let i = 0; i < max; i++) out.add(a + Math.round((i * (n - 1)) / (max - 1)));
  return [...out].sort((x, y) => x - y);
}

/**
 * Drops keys that the linear interpolation of their kept neighbours reproduces within eps (keeps both ends).
 * Swing-door corridor per channel: O(n), so hour-long gain curves stay cheap.
 */
export function simplifyLinear(pts: { f: number; v: number[] }[], eps: number[]): { f: number; v: number[] }[] {
  if (pts.length <= 2) return pts;
  const C = pts[0]!.v.length;
  const out = [pts[0]!];
  let anchor = 0;
  let lo = new Array<number>(C).fill(-Infinity);
  let hi = new Array<number>(C).fill(Infinity);
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[anchor]!;
    const p = pts[i]!;
    const b = pts[i + 1]!;
    const dp = p.f - a.f;
    const db = b.f - a.f;
    let ok = dp > 0 && db > 0;
    for (let c = 0; c < C && ok; c++) {
      lo[c] = Math.max(lo[c]!, (p.v[c]! - eps[c]! - a.v[c]!) / dp);
      hi[c] = Math.min(hi[c]!, (p.v[c]! + eps[c]! - a.v[c]!) / dp);
      const s = (b.v[c]! - a.v[c]!) / db;
      if (s < lo[c]! - 1e-12 || s > hi[c]! + 1e-12) ok = false;
    }
    if (!ok) {
      out.push(p);
      anchor = i;
      lo = new Array<number>(C).fill(-Infinity);
      hi = new Array<number>(C).fill(Infinity);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

const round = (n: number, d: number) => {
  const r = Number(n.toFixed(d));
  return Object.is(r, -0) ? 0 : r;
};

/**
 * Clip-local transform keyframes for V1: camera keys (2 keys for kb/linear moves, dense ≤ 60 otherwise) with the
 * punch/zoom fx and pulse accents overlapping the clip multiplied in (dense inside their windows).
 */
export function clipMotion(i: ClipMotionInput): ClipMotion {
  const { clip, fps, width: W, height: H } = i;
  const cam = clip.camera;
  const lastVisible = Math.max(0, clip.dur - 1 + Math.max(0, i.tailFrames));
  const sparse = isSparseCamera(cam);
  const base = (f: number): CamSample => (sparse ? linearCamera(cam, f, i.kbEase) : exactCamera(cam, f, i.kbEase));
  const frames = new Set<number>([0, lastVisible]);
  if (sparse) {
    for (const k of cam.keys) frames.add(Math.min(lastVisible, Math.max(0, Math.round(k.f))));
  } else {
    for (const f of evenFrames(0, lastVisible, Math.max(2, i.maxDenseKeys ?? 60))) frames.add(f);
  }
  // fx windows (program frames → clip-local)
  const cues = i.fx.filter((c) => SCALE_FX.has(c.fx) && c.amt !== 0);
  const live: FxCue[] = [];
  for (const c of cues) {
    const a = c.from - Math.max(0, c.pre) - clip.from;
    const b = c.from + c.dur - clip.from; // exclusive
    if (b <= 0 || a > lastVisible) continue;
    live.push(c);
    for (let f = Math.max(0, a - 1); f <= Math.min(lastVisible, b); f++) frames.add(f);
  }
  const pulse = clip.transitionIn.kind === "cut" && clip.transitionIn.accent.type === "pulse" ? clip.transitionIn.accent : null;
  if (pulse) for (let f = 0; f <= Math.min(lastVisible, pulse.frames); f++) frames.add(f);
  const k0 = i.baseScale ?? 1;

  const sampleAt = (f: number): Xf => {
    const c = base(f);
    let x = cameraToNle(c, cam.origin, W, H);
    const pf = clip.from + f;
    for (const cue of live) {
      const e = fxEnv(cue, pf, fps);
      if (e <= 0) continue;
      const ox = (cue.x ?? cam.origin.x) * W;
      const oy = (cue.y ?? cam.origin.y) * H;
      x = scaleAbout(x, 1 + cue.amt * e, ox, oy, W, H);
    }
    if (pulse && f >= 0 && f < pulse.frames) {
      const kk = 1 - f / Math.max(1, pulse.frames);
      x = scaleAbout(x, 1 + pulse.amt * kk * kk, cam.origin.x * W, cam.origin.y * H, W, H);
    }
    if (k0 !== 1) x = { s: x.s * k0, dx: x.dx * k0, dy: x.dy * k0, rot: x.rot };
    return x;
  };
  const sorted = [...frames].sort((a, b) => a - b);
  const pts = sorted.map((f) => {
    const x = sampleAt(f);
    return { f, v: [x.s, x.dx, x.dy, x.rot] };
  });
  return { ...channelsFrom(pts), dense: !sparse };
}

const EPS = [5e-5, 0.05, 0.05, 0.001];

function channel(pts: { f: number; v: number[] }[], idx: number[], eps: number[], identity: number[]): { f: number; v: number[] }[] {
  const sub = pts.map((p) => ({ f: p.f, v: idx.map((k) => p.v[k]!) }));
  const constant = sub.every((p) => p.v.every((v, c) => Math.abs(v - sub[0]!.v[c]!) <= eps[c]!));
  if (constant) {
    if (sub[0]!.v.every((v, c) => Math.abs(v - identity[c]!) <= eps[c]!)) return [];
    return [sub[0]!];
  }
  return simplifyLinear(sub, eps);
}

export function channelsFrom(pts: { f: number; v: number[] }[]): Omit<ClipMotion, "dense"> {
  const s = channel(pts, [0], [EPS[0]!], [1]);
  const p = channel(pts, [1, 2], [EPS[1]!, EPS[2]!], [0, 0]);
  const r = channel(pts, [3], [EPS[3]!], [0]);
  return {
    scale: s.map((k) => ({ frame: k.f, value: round(k.v[0]!, 5), interp: "linear" as const })),
    position: p.map((k) => ({ frame: k.f, x: round(k.v[0]!, 2), y: round(k.v[1]!, 2), interp: "linear" as const })),
    rotation: r.map((k) => ({ frame: k.f, value: round(k.v[0]!, 3), interp: "linear" as const })),
  };
}

/** Value of a keyframe channel at a local frame (linear; hold before/after). */
export function valueAt(keys: readonly { frame: number; value: number }[], f: number, dflt: number): number {
  if (keys.length === 0) return dflt;
  if (f <= keys[0]!.frame) return keys[0]!.value;
  const last = keys[keys.length - 1]!;
  if (f >= last.frame) return last.value;
  let i = 0;
  while (i < keys.length - 2 && f >= keys[i + 1]!.frame) i++;
  const a = keys[i]!;
  const b = keys[i + 1]!;
  return a.value + ((b.value - a.value) * (f - a.frame)) / Math.max(1e-9, b.frame - a.frame);
}

/**
 * Samples a per-frame gain curve (dB) into keyframes: candidates every `step` frames plus both sides of every step
 * (|Δ| > 3 dB between consecutive frames), then simplified with `tolDb`. Values ≤ floorDb are written as −96 dB.
 */
export function gainKeys(db: (localFrame: number) => number, dur: number, o?: { step?: number; tolDb?: number; floorDb?: number }): Keyframe[] {
  const step = o?.step ?? 3;
  const tol = o?.tolDb ?? 0.5;
  const floor = o?.floorDb ?? -60;
  if (dur <= 0) return [];
  const v = (f: number) => Math.min(12, Math.max(floor, db(f)));
  const cand = new Set<number>([0, dur - 1]);
  for (let f = 0; f < dur; f += step) cand.add(f);
  let prev = v(0);
  for (let f = 1; f < dur; f++) {
    const cur = v(f);
    if (Math.abs(cur - prev) > 3) {
      cand.add(f - 1);
      cand.add(f);
    }
    prev = cur;
  }
  const pts = [...cand].sort((a, b) => a - b).map((f) => ({ f, v: [v(f)] }));
  const constant = pts.every((p) => Math.abs(p.v[0]! - pts[0]!.v[0]!) <= 0.01);
  const kept = constant ? [pts[0]!] : simplifyLinear(pts, [tol]);
  return kept.map((p) => ({ frame: p.f, value: p.v[0]! <= floor + 1e-9 ? -96 : round(p.v[0]!, 2), interp: "linear" as const }));
}
