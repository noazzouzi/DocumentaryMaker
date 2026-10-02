// Port of the makevoid/motion-graphics-music-video-skill helpers (tools/p5/lib/time.js, fx.js, core.js) and the Swift
// cue envelope (tools/vfx/Sources/mvfx/Cues.swift) to pure, framework-free TypeScript.
//
// Original work: Copyright (c) 2026 makevoid — MIT License.
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
// documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice
// and this permission notice shall be included in all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
//
// Every function is deterministic in (t | frame), so it is safe inside Remotion's useCurrentFrame() render.
// The Timeline-aware envelope used by the camera rig lives in fx/envelope.ts (§10.6); `cueEnv`/`cameraState` below are
// the original prototype API, kept for hero code (R1) and as the reference the fx/ tests compare against.

export type Ease = (x: number) => number;
const c1 = 1.70158;
const c3 = c1 + 1;
export const ease = {
  linear: (x: number) => x,
  inCubic: (x: number) => x * x * x,
  outCubic: (x: number) => 1 - Math.pow(1 - x, 3),
  inOutCubic: (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  outExpo: (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  outBack: (x: number) => 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2),
  outElastic: (x: number) =>
    x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1,
} satisfies Record<string, Ease>;

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const progress = (t: number, start: number, dur: number, e: Ease = ease.linear) => e(clamp01((t - start) / dur));
export const tween = (t: number, start: number, dur: number, from: number, to: number, e: Ease = ease.outCubic) =>
  from + (to - from) * progress(t, start, dur, e);
export const live = (t: number, start: number, end = Infinity) => t >= start && t < end;
export const envelope = (t: number, start: number, end: number, fadeIn = 0, fadeOut = 0) => {
  if (t < start || t >= end) return 0;
  const a = fadeIn ? clamp01((t - start) / fadeIn) : 1;
  const b = fadeOut ? clamp01((end - t) / fadeOut) : 1;
  return Math.min(a, b);
};
export const steps = (t: number, start: number, period: number) => Math.max(0, Math.floor((t - start) / period));

/** mulberry32, identical to Anim.rng and to @docmaker/core mulberry32. */
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type Xf = { scale: number; rot: number; alpha: number };
/** Entrance transforms (fx.js). Feed into `scale(${s}) rotate(${rot}rad)` + opacity. Times in seconds. */
export const slap = (t: number, start: number, { dur = 0.22, from = 1.18, rot = 0, spin = 0.08 } = {}): Xf => {
  if (t < start) return { scale: 1, rot, alpha: 0 };
  const p = clamp01((t - start) / dur);
  return { scale: from + (1 - from) * ease.outBack(p), rot: rot + spin * (1 - ease.outCubic(p)), alpha: clamp01(p * 4) };
};
export const pop = (t: number, start: number, { dur = 0.16, from = 0.55 } = {}): Xf => {
  if (t < start) return { scale: 1, rot: 0, alpha: 0 };
  const p = clamp01((t - start) / dur);
  return { scale: from + (1 - from) * ease.outBack(p), rot: 0, alpha: clamp01(p * 3) };
};
export const slam = (t: number, start: number, { dur = 0.12, from = 1.7 } = {}): Xf => {
  if (t < start) return { scale: 1, rot: 0, alpha: 0 };
  const p = clamp01((t - start) / dur);
  return { scale: from + (1 - from) * ease.inCubic(p), rot: 0, alpha: clamp01(p * 2) };
};
/** Decaying shake; seeded per frame (p5 used randomSeed(1000 + frame)). */
export const shake = (t: number, start: number, frame: number, { dur = 0.3, amp = 14 } = {}) => {
  const p = (t - start) / dur;
  if (p < 0 || p > 1) return { x: 0, y: 0 };
  const k = amp * Math.pow(1 - p, 2);
  const r = rng(1000 + frame);
  return { x: (r() * 2 - 1) * k, y: (r() * 2 - 1) * k };
};
export const typed = (str: string, p: number) => str.slice(0, Math.round(str.length * clamp01(p)));

/** Word cues ({w,s,e} from an alignment). cue("word", nth) throws if missing, so timing never silently drifts. */
export type Word = { w: string; s: number; e: number };
export const cues = (words: Word[]) => {
  const norm = (w: string) => w.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9']/g, "");
  const list = words.map((x) => ({ ...x, w: norm(x.w) }));
  const cue = (word: string, nth = 1) => {
    const hits = list.filter((x) => x.w === norm(word));
    if (!hits[nth - 1]) throw new Error(`cue "${word}" #${nth} not in transcript`);
    return hits[nth - 1]!;
  };
  return Object.assign(cue, { list });
};

/** Frame-cued effect envelope (Cues.swift Cue.env). f = hit frame, dur frames after, pre = ramp-in frames before f. */
export type Cue = { fx: string; f: number; dur: number; pre?: number; shape?: "hit" | "span"; fade?: number; amt?: number; hold?: number };
export const cueEnv = (c: Cue, frame: number, defaultShape: "hit" | "span" = "hit", curve = 2.2) => {
  const pre = c.pre ?? 0;
  if (frame < c.f - pre || frame >= c.f + c.dur) return 0;
  if (frame < c.f) {
    const q = (frame - (c.f - pre) + 1) / (pre + 1);
    return q * q;
  }
  const t = frame - c.f;
  if ((c.shape ?? defaultShape) === "span") {
    const fd = Math.max(c.fade ?? 4, 1);
    return Math.min(1, (t + 1) / fd, (c.dur - t) / fd);
  }
  return Math.pow(1 - t / Math.max(c.dur, 1), curve);
};
/** Camera state accumulated from all live cues (subset of Effects.swift state()). */
export const cameraState = (cuesList: Cue[], frame: number) => {
  let scale = 1;
  let dx = 0;
  let dy = 0;
  let rot = 0;
  let zoomBlur = 0;
  let flash = 0;
  let dark = 0;
  let rgb = 0;
  for (const c of cuesList) {
    switch (c.fx) {
      case "punch": {
        const e = cueEnv(c, frame, "hit", 2.5);
        scale *= 1 + (c.amt ?? 0.06) * e;
        zoomBlur += 2 * e ** 3;
        rgb += 0.002 * e;
        break;
      }
      case "zoom": {
        if (frame < c.f || frame >= c.f + c.dur) break;
        const p = (frame - c.f + 1) / Math.max(c.dur, 1);
        scale *= 1 + (c.amt ?? 0.08) * p * p * (3 - 2 * p);
        break;
      }
      case "shake": {
        const e = cueEnv(c, frame, "hit", 2);
        const a = (c.amt ?? 14) * e;
        const r = rng((frame * 73856093) ^ (c.f * 19349663));
        dx += (r() * 2 - 1) * a;
        dy += (r() * 2 - 1) * a;
        rot += (r() * 2 - 1) * 0.006 * e;
        scale *= 1 + (2 * a) / 1080;
        break;
      }
      case "flash":
        flash += (c.amt ?? 1) * cueEnv(c, frame, "hit", 2.8);
        break;
      case "dark": {
        const hold = c.hold ?? 2;
        const t = frame - c.f;
        if (frame < c.f - (c.pre ?? 0) || frame >= c.f + c.dur) break;
        const e = t < 0 ? cueEnv(c, frame) : t < hold ? 1 : Math.pow(1 - (t - hold) / Math.max(c.dur - hold, 1), 2);
        dark = Math.max(dark, (c.amt ?? 0.94) * e);
        break;
      }
      case "rgb":
        rgb += (c.amt ?? 0.006) * cueEnv(c, frame, "hit", 2);
        break;
    }
  }
  return { scale, dx, dy, rot, zoomBlur, flash, dark, rgb };
};

/** Beat helpers over beats.py output ({beats:[{t,f,n,bar_pos,strength,low}]}). The director owns cut snapping (W6). */
export type Beat = { t: number; f: number; n: number; bar_pos: number; strength: number; low: number };
export const nearestBeat = (beats: Beat[], t: number, { downbeatOnly = false, maxDist = 0.12 } = {}) => {
  let best: Beat | null = null;
  for (const b of beats) {
    if (downbeatOnly && b.bar_pos !== 0) continue;
    if (Math.abs(b.t - t) <= maxDist && (!best || Math.abs(b.t - t) < Math.abs(best.t - t))) best = b;
  }
  return best;
};
/** Snap an edit point to the nearest beat if it is close; otherwise keep the speech-driven time. */
export const snapCut = (beats: Beat[], t: number, fps: number, maxDist = 0.12) => {
  const b = nearestBeat(beats, t, { maxDist });
  return Math.round((b ? b.t : t) * fps);
};
