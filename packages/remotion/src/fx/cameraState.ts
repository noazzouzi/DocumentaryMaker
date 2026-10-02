// Camera rig + light state from Timeline fx cues (§10.6). Port of the prototype cameraState (lib/motion.ts, MIT,
// makevoid) extended with per-cue origins, plate shakes (hz), seeded-noise impact shakes, rotation, overscan and blur.
// Pure: a function of (cues, frame) only, so out-of-order frame rendering is safe.
import type { FxCue } from "@docmaker/core";
import { noise2D } from "@remotion/noise";
import { finite } from "../lib/easing";
import { hash01 } from "../lib/random";
import { cueLive, env, pulseScale } from "./envelope";

export interface Pulse { from: number; dur: number; amt: number }
export interface CutFlash { from: number; dur: number; peak: number; color: string }
export interface Origin { x: number; y: number } // units of the frame (0..1)

/** Uniform scale + translation + rotation about the frame centre, in px at width × height. */
export interface CameraSample {
  s: number; // total scale
  tx: number; // translation (px) of the scaled plane, transform-origin 0 0
  ty: number;
  rotDeg: number; // rotation about the frame centre
  blurPx: number;
}
export const IDENTITY: CameraSample = { s: 1, tx: 0, ty: 0, rotDeg: 0, blurPx: 0 };

export type CuePart = "all" | "zoomOnly";
export interface CameraQuery {
  fx: readonly FxCue[];
  pulses?: readonly Pulse[];
  f: number;
  fps: number;
  width: number;
  height: number;
  /** Fallback origin for cues without (x, y): the clip camera origin at f. */
  originAt: (f: number) => Origin;
  /** Which part of a cue applies to this target (null = ignore the cue). */
  select: (cue: FxCue) => CuePart | null;
}

const CAMERA_FX = new Set(["punch", "zoom", "shake", "blur"]);

export function cameraStateAt(q: CameraQuery): CameraSample {
  const { f, fps, width: W, height: H } = q;
  let s = 1;
  let tx = 0;
  let ty = 0;
  let dx = 0;
  let dy = 0;
  let rot = 0;
  let blur = 0;
  let overscan = 1;
  const scaleAbout = (k: number, o: Origin) => {
    if (!(k > 0) || k === 1) return;
    const ox = o.x * W;
    const oy = o.y * H;
    // p' = k(s·p + t − o) + o
    tx = k * (tx - ox) + ox;
    ty = k * (ty - oy) + oy;
    s *= k;
  };
  for (const cue of q.fx) {
    if (!CAMERA_FX.has(cue.fx) || !cueLive(cue, f)) continue;
    const part = q.select(cue);
    if (part === null) continue;
    const e = env(cue, f, fps);
    if (e <= 0) continue;
    const origin = cue.x != null && cue.y != null ? { x: cue.x, y: cue.y } : q.originAt(f);
    if (cue.fx === "punch") {
      scaleAbout(1 + cue.amt * e, origin);
      if (part === "all" && e > 0.05) blur += 2 * e * e * e;
    } else if (cue.fx === "zoom") {
      scaleAbout(1 + cue.amt * e, origin);
    } else if (cue.fx === "shake" && part === "all") {
      const t = f - cue.from;
      const amt = cue.amt;
      if (cue.hz != null) {
        dx += amt * e * Math.sin((2 * Math.PI * cue.hz * t) / fps);
        dy += (cue.ampY ?? 0.6 * amt) * e * Math.cos((2 * Math.PI * 1.31 * cue.hz * t) / fps);
        if (cue.rotDeg != null) rot += noise2D(`${cue.seed}r`, t * 0.9, 0) * cue.rotDeg * e;
      } else {
        dx += noise2D(`${cue.seed}x`, t * 0.9, 0) * amt * e;
        dy += noise2D(`${cue.seed}y`, t * 0.9, 0) * amt * e;
        rot += noise2D(`${cue.seed}r`, t * 0.9, 0) * (cue.rotDeg ?? 0.6) * e;
      }
      overscan *= 1 + (2 * Math.abs(amt) * e) / 1080;
    } else if (cue.fx === "blur" && part === "all") {
      blur += cue.amt * e;
    }
  }
  if (q.pulses) {
    for (const p of q.pulses) {
      const k = pulseScale(p, f);
      if (k !== 1) scaleAbout(k, q.originAt(f));
    }
  }
  // overscan about the frame centre so shakes never reveal edges
  scaleAbout(overscan, { x: 0.5, y: 0.5 });
  return { s: finite(s, 1), tx: finite(tx + dx), ty: finite(ty + dy), rotDeg: finite(rot), blurPx: Math.max(0, finite(blur)) };
}

export const isIdentity = (c: CameraSample): boolean =>
  Math.abs(c.s - 1) < 1e-6 && Math.abs(c.tx) < 1e-3 && Math.abs(c.ty) < 1e-3 && Math.abs(c.rotDeg) < 1e-4;

/** CSS matrix() for a sample (apply with transform-origin "0 0"). Rotation is about the frame centre. */
export function cameraMatrix(c: CameraSample, width: number, height: number): string {
  const r = (c.rotDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const cx = width / 2;
  const cy = height / 2;
  // p'' = R(s·p + t − c) + c
  const a = c.s * cos;
  const b = c.s * sin;
  const cc = -c.s * sin;
  const d = c.s * cos;
  const ex = cos * (c.tx - cx) - sin * (c.ty - cy) + cx;
  const fy = sin * (c.tx - cx) + cos * (c.ty - cy) + cy;
  const n = (v: number) => Number(finite(v).toFixed(5));
  return `matrix(${n(a)}, ${n(b)}, ${n(cc)}, ${n(d)}, ${n(ex)}, ${n(fy)})`;
}

// ------------------------------------------------------------------ light & signal-damage state (FxLightLayer)
export interface LightSample {
  flash: number; // opacity (screen blend)
  flashColor: string;
  dark: number; // black overlay opacity
  rgbPx: number; // chromatic split offset (0 below .5 px)
  glitchPx: number; // slice displacement amplitude (0 on near-clean frames)
  glitchSeed: number; // per-frame seed for the slice pattern (cue-relative)
}
export const NO_LIGHT: LightSample = { flash: 0, flashColor: "#FFFFFF", dark: 0, rgbPx: 0, glitchPx: 0, glitchSeed: 0 };
export const FLASH_HARD_CAP = 0.9;

export function lightStateAt(q: { fx: readonly FxCue[]; cutFlashes?: readonly CutFlash[]; f: number; fps: number; select: (cue: FxCue) => boolean }): LightSample {
  const { f, fps } = q;
  let flash = 0;
  let flashColor = "#FFFFFF";
  let strongest = 0;
  let dark = 0;
  let rgb = 0;
  let glitch = 0;
  let glitchSeed = 0;
  for (const cue of q.fx) {
    if (cue.fx !== "flash" && cue.fx !== "dark" && cue.fx !== "rgb" && cue.fx !== "glitch") continue;
    if (!cueLive(cue, f) || !q.select(cue)) continue;
    const e = env(cue, f, fps);
    if (e <= 0) continue;
    if (cue.fx === "flash") {
      const v = cue.amt * e;
      flash += v;
      if (v > strongest) {
        strongest = v;
        flashColor = cue.color ?? "#FFFFFF";
      }
    } else if (cue.fx === "dark") dark = Math.max(dark, cue.amt * e);
    else if (cue.fx === "rgb") rgb += cue.amt * e;
    else {
      const t = f - cue.from;
      // ~30 % near-clean frames, chosen by a cue-relative hash (chunk-shift invariant)
      if (hash01(cue.seed, "glitch-clean", t) >= 0.3) {
        glitch += cue.amt * e;
        glitchSeed = (cue.seed * 31 + t * 7919) >>> 0;
      }
    }
  }
  for (const cf of q.cutFlashes ?? []) {
    const t = f - cf.from;
    if (t < 0 || t >= cf.dur) continue;
    // hold the peak for the first frame, then decay linearly to 0 at the end (FlashFrame prototype)
    const v = cf.dur <= 1 ? cf.peak : t === 0 ? cf.peak : cf.peak * (1 - t / cf.dur);
    flash += v;
    if (v > strongest) {
      strongest = v;
      flashColor = cf.color;
    }
  }
  return {
    flash: Math.min(FLASH_HARD_CAP, Math.max(0, finite(flash))),
    flashColor,
    dark: Math.min(1, Math.max(0, finite(dark))),
    rgbPx: rgb >= 0.5 ? finite(rgb) : 0,
    glitchPx: Math.max(0, finite(glitch)),
    glitchSeed,
  };
}
