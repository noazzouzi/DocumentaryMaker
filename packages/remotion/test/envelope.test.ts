// Envelope, camera-state and motion math. The first five tests are the port of $SP/mgtest/motion.test.ts (bun) for
// src/lib/motion.ts (MIT, makevoid); the rest cover the Timeline-level fx/ modules and transforms.
import { describe, expect, it } from "vitest";
import type { CameraMove, FxCue } from "@docmaker/core";
import { coverIntensity, coverPhase, dipPhases } from "../src/compute/covers";
import { cameraMatrix, cameraStateAt, lightStateAt, type CameraQuery } from "../src/fx/cameraState";
import { env, pulseScale } from "../src/fx/envelope";
import { clipCameraAt } from "../src/lib/camera";
import { bezier, bezierOf, endSlopes, expoOut, power3 } from "../src/lib/easing";
import { cameraState, cueEnv, cues, ease, pop, slam, slap, snapCut, tween, typed, type Beat } from "../src/lib/motion";
import { monotoneSpline } from "../src/lib/monotone";
import { entryTailFrames, velocityTransform } from "../src/transitions/velocity";
import beatsJson from "./data/beats.json";

// ------------------------------------------------------------------ port of motion.test.ts (5 tests)
describe("lib/motion (port of mgtest/motion.test.ts)", () => {
  it("entrances settle to identity", () => {
    for (const f of [slap, pop, slam]) {
      const end = f(10, 0);
      expect(end.scale).toBeCloseTo(1, 6);
      expect(end.alpha).toBe(1);
      expect(f(-1, 0).alpha).toBe(0);
    }
    // slap overshoots below 1 mid-way (outBack), slam starts oversized
    expect(Math.min(...Array.from({ length: 22 }, (_, i) => slap(i / 100, 0).scale))).toBeLessThan(1);
    expect(slam(0.01, 0).scale).toBeGreaterThan(1.6);
  });

  it("cue envelope hit/span/pre", () => {
    expect(cueEnv({ fx: "punch", f: 24, dur: 8 }, 24)).toBe(1);
    expect(cueEnv({ fx: "punch", f: 24, dur: 8 }, 32)).toBe(0);
    expect(cueEnv({ fx: "glitch", f: 10, dur: 10, shape: "span", fade: 2 }, 15)).toBe(1);
    expect(cueEnv({ fx: "whip", f: 10, dur: 4, pre: 3 }, 8)).toBeGreaterThan(0);
    const s = cameraState([{ fx: "punch", f: 24, dur: 8, amt: 0.05 }, { fx: "flash", f: 24, dur: 6 }], 24);
    expect(s.scale).toBeCloseTo(1.05, 6);
    expect(s.flash).toBe(1);
  });

  it("cues are accent-insensitive (French) and throw on missing words", () => {
    const cue = cues([{ w: "Déjà", s: 1, e: 1.3 }, { w: "vu", s: 1.3, e: 1.5 }, { w: "déjà", s: 4, e: 4.2 }]);
    expect(cue("deja", 2).s).toBe(4);
    expect(() => cue("absent")).toThrow();
  });

  it("snap cut to beat grid from beats.py output", () => {
    const beats = (beatsJson as unknown as { beats: Beat[] }).beats;
    // a speech-driven cut at 2.30s snaps to the 2.229s downbeat -> frame 53 at 24fps
    expect(snapCut(beats, 2.3, 24)).toBe(53);
    // far from any beat -> unchanged
    expect(snapCut(beats, 2.0, 24, 0.05)).toBe(48);
  });

  it("typewriter + tween", () => {
    expect(typed("HELLO", 0.5)).toBe("HEL");
    expect(tween(1, 0, 1, 0, 100, ease.linear)).toBe(100);
  });
});

// ------------------------------------------------------------------ fx/envelope (§10.6)
const anchor = { ref: "program" as const, edge: "start" as const, offset: 0 };
function cue(o: Partial<FxCue> & Pick<FxCue, "fx" | "from" | "dur">): FxCue {
  return {
    id: `fx:test:${o.fx}`, start: anchor, end: anchor, shape: "hit", pre: 0, curve: 2, fade: 0, amt: 0.1, decay: null, hz: null, ampY: null, rotDeg: null,
    x: null, y: null, color: null, seed: 7, target: "picture", ...o,
  };
}

describe("fx/envelope", () => {
  it("matches the prototype cueEnv for hit and span shapes", () => {
    for (let f = 15; f < 40; f++) {
      expect(env(cue({ fx: "punch", from: 24, dur: 8, curve: 2.2 }), f, 30)).toBeCloseTo(cueEnv({ fx: "punch", f: 24, dur: 8 }, f), 10);
      expect(env(cue({ fx: "glitch", from: 20, dur: 10, shape: "span", fade: 3 }), f, 30)).toBeCloseTo(cueEnv({ fx: "glitch", f: 20, dur: 10, shape: "span", fade: 3 }, f), 10);
      expect(env(cue({ fx: "flash", from: 24, dur: 6, pre: 3, curve: 2.2 }), f, 30)).toBeCloseTo(cueEnv({ fx: "flash", f: 24, dur: 6, pre: 3 }, f), 10);
    }
  });

  it("pre-roll q², plate decay exp(−decay·t/fps), zero outside", () => {
    const c = cue({ fx: "punch", from: 30, dur: 18, pre: 3, decay: 9 });
    expect(env(c, 26, 30)).toBe(0);
    expect(env(c, 27, 30)).toBeCloseTo(0.25 * 0.25, 10);
    expect(env(c, 29, 30)).toBeCloseTo(0.75 * 0.75, 10);
    expect(env(c, 30, 30)).toBe(1);
    expect(env(c, 40, 30)).toBeCloseTo(Math.exp(-9 * 10 / 30), 10);
    expect(env(c, 48, 30)).toBe(0);
  });

  it("zoom spans snap in and hold to the cut (no fade-out)", () => {
    const z = cue({ fx: "zoom", from: 100, dur: 60, shape: "span", fade: 3 });
    expect(env(z, 99, 30)).toBe(0);
    expect(env(z, 100, 30)).toBeGreaterThan(0.85);
    expect(env(z, 102, 30)).toBe(1);
    expect(env(z, 159, 30)).toBe(1);
    expect(env(z, 160, 30)).toBe(0);
    const snap = cue({ fx: "zoom", from: 0, dur: 10, shape: "span", fade: 0 });
    expect(env(snap, 0, 30)).toBe(1);
  });

  it("pulse: 1 + amt·(1 − t/frames)²", () => {
    const p = { from: 10, dur: 8, amt: 0.05 };
    expect(pulseScale(p, 9)).toBe(1);
    expect(pulseScale(p, 10)).toBeCloseTo(1.05, 10);
    expect(pulseScale(p, 14)).toBeCloseTo(1 + 0.05 * 0.25, 10);
    expect(pulseScale(p, 18)).toBe(1);
  });
});

// ------------------------------------------------------------------ fx/cameraState
function q(fx: FxCue[], f: number, extra: Partial<CameraQuery> = {}): CameraQuery {
  return { fx, f, fps: 30, width: 1920, height: 1080, originAt: () => ({ x: 0.5, y: 0.5 }), select: () => "all", ...extra };
}

describe("fx/cameraState", () => {
  it("a timeline without fx renders like a plain render (identity)", () => {
    const s = cameraStateAt(q([], 10));
    expect(s).toEqual({ s: 1, tx: 0, ty: 0, rotDeg: 0, blurPx: 0 });
    expect(lightStateAt({ fx: [], f: 10, fps: 30, select: () => true })).toMatchObject({ flash: 0, dark: 0, rgbPx: 0, glitchPx: 0 });
  });

  it("punches scale about their focal point (it stays fixed on screen) and add a short zoom blur", () => {
    const c = cue({ fx: "punch", from: 0, dur: 10, amt: 0.2, x: 0.25, y: 0.4 });
    const s = cameraStateAt(q([c], 0));
    expect(s.s).toBeCloseTo(1.2, 10);
    // the origin maps to itself: s·o + t = o
    expect(s.s * 480 + s.tx).toBeCloseTo(480, 6);
    expect(s.s * 432 + s.ty).toBeCloseTo(432, 6);
    expect(s.blurPx).toBeCloseTo(2, 6);
    // origin falls back to the clip camera origin
    const d = cameraStateAt(q([cue({ fx: "punch", from: 0, dur: 10, amt: 0.2 })], 0, { originAt: () => ({ x: 0.1, y: 0.9 }) }));
    expect(d.s * 192 + d.tx).toBeCloseTo(192, 6);
  });

  it("composes multiple scales and the cut pulse", () => {
    const s = cameraStateAt(q([cue({ fx: "punch", from: 0, dur: 10, amt: 0.1 }), cue({ fx: "zoom", from: 0, dur: 30, shape: "span", fade: 0, amt: 0.05 })], 0, { pulses: [{ from: 0, dur: 8, amt: 0.05 }] }));
    expect(s.s).toBeCloseTo(1.1 * 1.05 * 1.05, 10);
  });

  it("plate shake (hz) is the sin/cos(1.31×) model; impact shake (noise) is seeded and overscans", () => {
    const plate = cue({ fx: "shake", from: 0, dur: 18, amt: 8, ampY: 5, hz: 12, decay: 9 });
    const s = cameraStateAt(q([plate], 1));
    const e = Math.exp(-9 / 30);
    const over = 1 + (2 * 8 * e) / 1080;
    expect(s.s).toBeCloseTo(over, 10);
    // translation = overscan about the centre + the shake offset
    expect(s.tx - (1 - over) * 960).toBeCloseTo(8 * e * Math.sin((2 * Math.PI * 12) / 30), 8);
    expect(s.ty - (1 - over) * 540).toBeCloseTo(5 * e * Math.cos((2 * Math.PI * 1.31 * 12) / 30), 8);
    const impact = cue({ fx: "shake", from: 0, dur: 12, amt: 20, rotDeg: 0.8, target: "all" });
    const a = cameraStateAt(q([impact], 3));
    const b = cameraStateAt(q([impact], 3));
    expect(a).toEqual(b);
    expect(Math.abs(a.rotDeg)).toBeLessThanOrEqual(0.8);
    expect(a.s).toBeGreaterThan(1);
    const other = cameraStateAt(q([{ ...impact, seed: 8 }], 3));
    expect(other.tx).not.toBeCloseTo(a.tx, 6);
  });

  it("followers get only the punch/zoom part; shakes never reach them", () => {
    const fx = [cue({ fx: "zoom", from: 0, dur: 30, shape: "span", fade: 0, amt: 0.1, target: "picture+followers" }), cue({ fx: "shake", from: 0, dur: 12, amt: 20, target: "picture+followers" })];
    const s = cameraStateAt(q(fx, 2, { select: (c) => (c.target === "picture+followers" ? "zoomOnly" : null) }));
    expect(s.s).toBeCloseTo(1.1, 10);
    expect(s.blurPx).toBe(0);
    expect(s.rotDeg).toBe(0);
    const none = cameraStateAt(q(fx, 2, { select: (c) => (c.target === "all" ? "all" : null) }));
    expect(none.s).toBe(1);
  });

  it("cameraMatrix encodes the sample (identity → unit matrix)", () => {
    expect(cameraMatrix({ s: 1, tx: 0, ty: 0, rotDeg: 0, blurPx: 0 }, 1920, 1080)).toBe("matrix(1, 0, 0, 1, 0, 0)");
    expect(cameraMatrix({ s: 2, tx: -960, ty: -540, rotDeg: 0, blurPx: 0 }, 1920, 1080)).toBe("matrix(2, 0, 0, 2, -960, -540)");
  });

  it("light: flash capped at 0.9, cut flashes hold then decay, rgb only ≥ .5 px, ~30 % clean glitch frames", () => {
    const fl = lightStateAt({ fx: [cue({ fx: "flash", from: 0, dur: 4, amt: 0.8 }), cue({ fx: "flash", from: 0, dur: 4, amt: 0.8, color: "#FF0000" })], f: 0, fps: 30, select: () => true });
    expect(fl.flash).toBe(0.9);
    const cf = { from: 10, dur: 4, peak: 0.4, color: "#f5f2ed" };
    expect(lightStateAt({ fx: [], cutFlashes: [cf], f: 10, fps: 30, select: () => true }).flash).toBeCloseTo(0.4, 10);
    expect(lightStateAt({ fx: [], cutFlashes: [cf], f: 12, fps: 30, select: () => true }).flash).toBeCloseTo(0.2, 10);
    expect(lightStateAt({ fx: [], cutFlashes: [cf], f: 14, fps: 30, select: () => true }).flash).toBe(0);
    expect(lightStateAt({ fx: [cue({ fx: "rgb", from: 0, dur: 4, amt: 0.4 })], f: 0, fps: 30, select: () => true }).rgbPx).toBe(0);
    expect(lightStateAt({ fx: [cue({ fx: "rgb", from: 0, dur: 4, amt: 12 })], f: 0, fps: 30, select: () => true }).rgbPx).toBe(12);
    const g = cue({ fx: "glitch", from: 0, dur: 2000, shape: "span", fade: 1, amt: 20 });
    let clean = 0;
    for (let f = 0; f < 1000; f++) if (lightStateAt({ fx: [g], f, fps: 30, select: () => true }).glitchPx === 0) clean++;
    expect(clean / 1000).toBeGreaterThan(0.24);
    expect(clean / 1000).toBeLessThan(0.36);
  });
});

// ------------------------------------------------------------------ eases, camera keys, transforms
describe("easing + clip camera", () => {
  const KB: [number, number, number, number] = [0.2, 0.12, 0.8, 0.88];

  it("kb ease has non-zero end slopes ≥ 0.5 × the mean slope (no settle at cuts)", () => {
    const s = endSlopes(bezierOf(KB));
    expect(s.start).toBeGreaterThanOrEqual(0.5);
    expect(s.end).toBeGreaterThanOrEqual(0.5);
    expect(s.start).toBeCloseTo(0.6, 2);
    // expo.out settles (end slope ≈ 0) — the reason it is never used for Ken Burns
    expect(endSlopes(expoOut).end).toBeLessThan(0.05);
  });

  it("bezier solver matches known values", () => {
    const lin = bezier(0.25, 0.25, 0.75, 0.75);
    for (const x of [0, 0.1, 0.5, 0.9, 1]) expect(lin(x)).toBeCloseTo(x, 6);
    expect(power3.in(0.5)).toBeCloseTo(0.0625, 10);
  });

  const cam = (o: Partial<CameraMove>): CameraMove => ({
    kind: "kenBurns", keys: [{ f: 0, scale: 1.04, x: 0, y: 0, rot: 0 }, { f: 100, scale: 1.14, x: -20, y: 0, rot: 0 }], ease: "kb",
    origin: { x: 0.5, y: 0.45 }, blurFromPx: 0, handheld: null, direction: "in", ...o,
  });

  it("interpolates keys with the kb ease and keeps moving through overlap handles", () => {
    const motion = { kbEase: KB };
    const c = cam({});
    expect(clipCameraAt(c, 0, motion).scale).toBeCloseTo(1.04, 10);
    expect(clipCameraAt(c, 100, motion).scale).toBeCloseTo(1.14, 10);
    const mid = clipCameraAt(c, 50, motion);
    expect(mid.scale).toBeCloseTo(1.09, 3);
    // tail handle: still zooming in (end slope 0.6 × mean), head handle: before the first key
    expect(clipCameraAt(c, 105, motion).scale).toBeGreaterThan(1.14);
    expect(clipCameraAt(c, -5, motion).scale).toBeLessThan(1.04);
    const stat = cam({ keys: [{ f: 0, scale: 1.04, x: 3, y: 4, rot: 0 }], kind: "static" });
    expect(clipCameraAt(stat, 999, motion)).toEqual({ scale: 1.04, x: 3, y: 4, rot: 0, blurPx: 0 });
  });

  it("monotone ease never overshoots between keys", () => {
    const c = cam({ ease: "monotone", keys: [{ f: 0, scale: 1, x: 0, y: 0, rot: 0 }, { f: 30, scale: 1.3, x: 0, y: 0, rot: 0 }, { f: 60, scale: 1.3, x: 0, y: 0, rot: 0 }, { f: 90, scale: 1.1, x: 0, y: 0, rot: 0 }] });
    for (let f = 0; f <= 90; f++) {
      const s = clipCameraAt(c, f, { kbEase: KB }).scale;
      expect(s).toBeLessThanOrEqual(1.3 + 1e-9);
      expect(s).toBeGreaterThanOrEqual(1 - 1e-9);
    }
    const sp = monotoneSpline([0, 1, 2], [0, 1, 1]);
    expect(sp.at(1.5)).toBe(1);
  });

  it("pull-back blur decays over the first key segment; handheld is deterministic", () => {
    const c = cam({ kind: "pullBack", ease: "expoOut", keys: [{ f: 0, scale: 1.25, x: 0, y: 0, rot: 0 }, { f: 15, scale: 1, x: 0, y: 0, rot: 0 }], blurFromPx: 10 });
    expect(clipCameraAt(c, 0, { kbEase: KB }).blurPx).toBeCloseTo(10, 6);
    expect(clipCameraAt(c, 15, { kbEase: KB }).blurPx).toBeCloseTo(0, 6);
    const h = cam({ handheld: { ampPx: 2, fps: 3 } });
    const a = clipCameraAt(h, 40, { kbEase: KB }, { seed: 5 });
    expect(clipCameraAt(h, 40, { kbEase: KB }, { seed: 5 })).toEqual(a);
    // stepped at 3 fps: frames inside one step share the jitter
    const base = clipCameraAt(cam({}), 40, { kbEase: KB });
    const b = clipCameraAt(h, 41, { kbEase: KB }, { seed: 5 });
    const baseB = clipCameraAt(cam({}), 41, { kbEase: KB });
    expect(a.x - base.x).toBeCloseTo(b.x - baseB.x, 10);
  });
});

describe("velocity transforms (§10.5)", () => {
  const o = { width: 1920, height: 1080, fullFrame: true };
  it("zoomThrough: exit reaches 1.2 / 20 px / .15 on the last frame; entry starts at .75 / .15 and lands at 1", () => {
    const e = { preset: "zoomThrough", direction: "left", frames: 6, flash: 0 };
    const last = velocityTransform(e, "exit", -1, o);
    expect(last.scale).toBeCloseTo(1.2, 6);
    expect(last.blurPx).toBeCloseTo(20, 6);
    expect(last.opacity).toBeCloseTo(0.15, 6);
    expect(velocityTransform(e, "exit", -7, o)).toMatchObject({ scale: 1, opacity: 1 });
    const en = { ...e, frames: 15 };
    const first = velocityTransform(en, "entry", 0, o);
    expect(first.scale).toBeCloseTo(0.75, 6);
    expect(first.opacity).toBeCloseTo(0.15, 6);
    expect(velocityTransform(en, "entry", 15, o)).toMatchObject({ scale: 1, opacity: 1, blurPx: 0 });
    expect(velocityTransform({ ...e, preset: "zoomThroughInverse" }, "exit", -1, o).scale).toBeCloseTo(0.8, 6);
  });

  it("whip: one frame width of travel split across the cut, blur peaks at the cut", () => {
    const e = { preset: "whip", direction: "left", frames: 8, flash: 0 };
    const a0 = velocityTransform(e, "exit", -8, o);
    const aLast = velocityTransform(e, "exit", -1, o);
    const b0 = velocityTransform(e, "entry", 0, o);
    const bEnd = velocityTransform(e, "entry", 7, o);
    expect(a0.tx).toBeCloseTo(0, 6);
    expect(aLast.tx).toBeLessThan(-0.25 * 1920); // power3.inOut at u = 7/16: A has travelled ≈ 0.29 W of its W/2
    expect(b0.tx).toBeCloseTo(960, 6); // +W/2 → 0
    expect(Math.abs(bEnd.tx)).toBeLessThan(0.05 * 1920);
    expect(b0.blurPx).toBeCloseTo(16, 6);
    expect(b0.stretchX).toBeCloseTo(1.06, 6);
    const right = velocityTransform({ ...e, direction: "right" }, "entry", 0, o);
    expect(right.tx).toBeCloseTo(-960, 6);
    const up = velocityTransform({ ...e, direction: "up" }, "entry", 0, o);
    expect(up.ty).toBeCloseTo(540, 6);
  });

  it("cutTheCurve fades by 30 % of the travel; pushCut releases to 1 without a pop", () => {
    const c = { preset: "cutTheCurve", direction: "left", frames: 9, flash: 0 };
    expect(velocityTransform(c, "exit", -1, o).opacity).toBe(0);
    expect(velocityTransform(c, "entry", 0, o).tx).toBeCloseTo(230, 6);
    const p = { preset: "pushCut", direction: "left", frames: 6, flash: 0.2 };
    expect(velocityTransform({ ...p, frames: 5 }, "exit", -1, o).scale).toBeCloseTo(1.04, 6);
    expect(velocityTransform(p, "entry", 0, o).scale).toBeCloseTo(1.04, 6);
    const tail = entryTailFrames(p);
    let prev = velocityTransform(p, "entry", 0, o).scale;
    for (let r = 1; r < 6 + tail + 1; r++) {
      const s = velocityTransform(p, "entry", r, o).scale;
      expect(Math.abs(s - prev)).toBeLessThan(0.02); // continuous: no jump back to 1
      prev = s;
    }
    expect(prev).toBe(1);
  });
});

describe("cover intensities", () => {
  it("flash peaks at the cut and is 0 at the window edges", () => {
    const w = { presentation: "flash", cut: 4, from: 0, dur: 8, peak: 0.6 };
    expect(coverIntensity(w, 4)).toBeCloseTo(0.6, 10);
    expect(coverIntensity(w, 0)).toBe(0);
    expect(coverIntensity(w, 8)).toBe(0);
  });
  it("dips are fully covered around the switch frame", () => {
    const d = 30;
    const ph = dipPhases(d);
    const w = { presentation: "dipToBlack", cut: ph.cutOffset, from: 0, dur: d, peak: 1 };
    expect(coverIntensity(w, 0)).toBe(0);
    expect(coverIntensity(w, ph.cutOffset)).toBe(1);
    expect(coverIntensity(w, ph.out)).toBe(1);
    expect(coverIntensity(w, d - 1)).toBeGreaterThan(0);
    expect(coverIntensity(w, d - 1)).toBeLessThan(0.3);
    expect(coverPhase(w, ph.cutOffset)).toBeGreaterThan(0);
    expect(coverPhase(w, 0)).toBe(-1);
  });
});
