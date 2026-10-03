// Keyframe math: CSS camera (focal origin) ≡ NLE transform (centre anchor), fx rig composition, sampling rules.
import { describe, expect, it } from "vitest";
import type { CameraMove, FxCue, VisualClip } from "@docmaker/core";
import { makeTimeline } from "@docmaker/core/testing";
import { cameraToNle, clipMotion, evenFrames, exactCamera, fxEnv, gainKeys, isSparseCamera, scaleAbout, simplifyLinear, valueAt } from "../src/keyframes";

const W = 1920;
const H = 1080;
const KB: [number, number, number, number] = [0.2, 0.12, 0.8, 0.88];

/** CSS: p' = o + t + R·s·(p − o) */
function cssMap(p: [number, number], c: { scale: number; x: number; y: number; rot: number }, o: { x: number; y: number }): [number, number] {
  const ox = o.x * W;
  const oy = o.y * H;
  const r = (c.rot * Math.PI) / 180;
  const vx = c.scale * (p[0] - ox);
  const vy = c.scale * (p[1] - oy);
  return [ox + c.x + Math.cos(r) * vx - Math.sin(r) * vy, oy + c.y + Math.sin(r) * vx + Math.cos(r) * vy];
}
/** NLE: p' = c + pos + R·s·(p − c) */
function nleMap(p: [number, number], x: { s: number; dx: number; dy: number; rot: number }): [number, number] {
  const r = (x.rot * Math.PI) / 180;
  const vx = x.s * (p[0] - W / 2);
  const vy = x.s * (p[1] - H / 2);
  return [W / 2 + x.dx + Math.cos(r) * vx - Math.sin(r) * vy, H / 2 + x.dy + Math.sin(r) * vx + Math.cos(r) * vy];
}

const clipOf = (camera: Partial<CameraMove>, over?: Partial<VisualClip>): VisualClip => {
  const t = makeTimeline({ seconds: 10 });
  const c = structuredClone(t.video[0]!);
  return { ...c, from: 0, dur: 120, camera: { ...c.camera, ...camera }, transitionIn: { kind: "cut", accent: { type: "none" } }, ...over };
};

describe("transform equivalence", () => {
  it("the NLE transform maps every pixel where the CSS camera does (scale, offset, rotation, off-centre origin)", () => {
    const cases = [
      { c: { scale: 1.2, x: 0, y: 0, rot: 0 }, o: { x: 0.5, y: 0.5 } },
      { c: { scale: 1.15, x: -40, y: 12, rot: 0 }, o: { x: 0.3, y: 0.7 } },
      { c: { scale: 1.08, x: 10, y: -5, rot: 2.5 }, o: { x: 0.62, y: 0.41 } },
    ];
    for (const { c, o } of cases) {
      const x = cameraToNle(c, o, W, H);
      for (const p of [[0, 0], [W, 0], [W / 3, H / 2], [W, H]] as [number, number][]) {
        const a = cssMap(p, c, o);
        const b = nleMap(p, x);
        expect(b[0]).toBeCloseTo(a[0], 6);
        expect(b[1]).toBeCloseTo(a[1], 6);
      }
    }
  });

  it("a rig scale about another origin composes like the Remotion camera rig", () => {
    const c = { scale: 1.1, x: 5, y: -3, rot: 0 };
    const o = { x: 0.4, y: 0.45 };
    const k = 1.06;
    const o2 = [0.55 * W, 0.4 * H] as const;
    const x = scaleAbout(cameraToNle(c, o, W, H), k, o2[0], o2[1], W, H);
    for (const p of [[100, 100], [1500, 900]] as [number, number][]) {
      const a = cssMap(p, c, o);
      const rig: [number, number] = [k * (a[0] - o2[0]) + o2[0], k * (a[1] - o2[1]) + o2[1]];
      const b = nleMap(p, x);
      expect(b[0]).toBeCloseTo(rig[0], 6);
      expect(b[1]).toBeCloseTo(rig[1], 6);
    }
  });
});

describe("camera sampling", () => {
  it("kb/linear 2-key moves are sparse; expoOut, monotone and pullBack are dense", () => {
    const keys = [{ f: 0, scale: 1, x: 0, y: 0, rot: 0 }, { f: 120, scale: 1.2, x: 0, y: 0, rot: 0 }];
    expect(isSparseCamera({ ...clipOf({}).camera, keys, ease: "kb", kind: "kenBurns" })).toBe(true);
    expect(isSparseCamera({ ...clipOf({}).camera, keys, ease: "expoOut", kind: "kenBurns" })).toBe(false);
    expect(isSparseCamera({ ...clipOf({}).camera, keys, ease: "linear", kind: "pullBack" })).toBe(false);
    expect(isSparseCamera({ ...clipOf({}).camera, keys: [...keys, { f: 60, scale: 1.1, x: 0, y: 0, rot: 0 }], ease: "monotone", kind: "reframe" })).toBe(false);
  });

  it("a centred Ken Burns zoom gives exactly 2 scale keyframes and no position", () => {
    const clip = clipOf({ kind: "kenBurns", ease: "kb", origin: { x: 0.5, y: 0.5 }, keys: [{ f: 0, scale: 1, x: 0, y: 0, rot: 0 }, { f: 120, scale: 1.2, x: 0, y: 0, rot: 0 }] });
    const m = clipMotion({ clip, fx: [], fps: 30, width: W, height: H, kbEase: KB, tailFrames: 0 });
    expect(m.scale.map((k) => k.frame)).toEqual([0, 119]);
    expect(m.scale[0]!.value).toBe(1);
    expect(m.scale[1]!.value).toBeCloseTo(1 + (0.2 * 119) / 120, 5);
    expect(m.position).toEqual([]);
    expect(m.rotation).toEqual([]);
  });

  it("an off-centre focal point turns into position keys (the NLE scales about the centre)", () => {
    const clip = clipOf({ kind: "kenBurns", ease: "linear", origin: { x: 0.25, y: 0.5 }, keys: [{ f: 0, scale: 1, x: 0, y: 0, rot: 0 }, { f: 120, scale: 1.2, x: 0, y: 0, rot: 0 }] });
    const m = clipMotion({ clip, fx: [], fps: 30, width: W, height: H, kbEase: KB, tailFrames: 10 });
    expect(m.position.length).toBe(2);
    // dx = (s − 1)(c − o) = 0.2 × (960 − 480) at f = 120 (the tail handle extends to 129)
    expect(m.position[1]!.frame).toBe(129);
    expect(m.position[1]!.x).toBeCloseTo((1 + (0.2 * 129) / 120 - 1) * 480, 1);
  });

  it("dense moves are capped at 60 keys and follow the exact eased curve", () => {
    const clip = clipOf({ kind: "pullBack", ease: "expoOut", origin: { x: 0.5, y: 0.5 }, keys: [{ f: 0, scale: 1.3, x: 0, y: 0, rot: 0 }, { f: 300, scale: 1, x: 0, y: 0, rot: 0 }] }, { dur: 300 });
    const m = clipMotion({ clip, fx: [], fps: 30, width: W, height: H, kbEase: KB, tailFrames: 0 });
    expect(m.dense).toBe(true);
    expect(m.scale.length).toBeLessThanOrEqual(60);
    expect(m.scale.length).toBeGreaterThan(5);
    for (const k of m.scale) expect(k.value).toBeCloseTo(exactCamera(clip.camera, k.frame, KB).scale, 4);
    // between keys the linear NLE interpolation stays within 0.5 % of the true curve
    for (let f = 0; f < 300; f += 7) expect(Math.abs(valueAt(m.scale, f, 1) - exactCamera(clip.camera, f, KB).scale)).toBeLessThan(0.005);
  });

  it("punch and zoom fx are multiplied into scale keys densely inside their window only", () => {
    const clip = clipOf({ kind: "static", ease: "linear", origin: { x: 0.5, y: 0.5 }, keys: [{ f: 0, scale: 1.05, x: 0, y: 0, rot: 0 }] });
    const punch: FxCue = {
      id: "fx:t:punch", start: { ref: "program", edge: "start", offset: 50 }, end: { ref: "program", edge: "start", offset: 58 }, from: 50, dur: 8, fx: "punch", shape: "hit",
      pre: 2, curve: 2, fade: 0, amt: 0.1, decay: null, hz: null, ampY: null, rotDeg: null, x: 0.5, y: 0.5, color: null, seed: 1, target: "picture",
    };
    const m = clipMotion({ clip, fx: [punch], fps: 30, width: W, height: H, kbEase: KB, tailFrames: 0 });
    const peak = m.scale.find((k) => k.frame === 50)!;
    expect(peak.value).toBeCloseTo(1.05 * 1.1, 5);
    expect(m.scale[0]).toEqual({ frame: 0, value: 1.05, interp: "linear" });
    expect(m.scale.every((k) => k.frame === 0 || k.frame === 119 || (k.frame >= 47 && k.frame <= 58))).toBe(true);
    for (let f = 47; f < 58; f++) expect(valueAt(m.scale, f, 1)).toBeCloseTo(1.05 * (1 + 0.1 * fxEnv(punch, f, 30)), 4);
    expect(m.position).toEqual([]); // centred punch on a centred camera: no offset
  });

  it("pulse cut accents are portable (scale bump at the head of the clip)", () => {
    const clip = clipOf({ kind: "static", ease: "linear", origin: { x: 0.5, y: 0.5 }, keys: [{ f: 0, scale: 1, x: 0, y: 0, rot: 0 }] }, { transitionIn: { kind: "cut", accent: { type: "pulse", amt: 0.05, frames: 8 } } });
    const m = clipMotion({ clip, fx: [], fps: 30, width: W, height: H, kbEase: KB, tailFrames: 0 });
    expect(m.scale[0]!.value).toBeCloseTo(1.05, 5);
    expect(valueAt(m.scale, 8, 1)).toBeCloseTo(1, 5);
  });
});

describe("utilities", () => {
  it("evenFrames keeps both ends and caps the count", () => {
    expect(evenFrames(0, 4, 60)).toEqual([0, 1, 2, 3, 4]);
    const e = evenFrames(0, 999, 60);
    expect(e).toHaveLength(60);
    expect(e[0]).toBe(0);
    expect(e[59]).toBe(999);
  });
  it("simplifyLinear drops collinear points only", () => {
    const pts = [0, 1, 2, 3, 4, 5].map((f) => ({ f, v: [f < 3 ? f : 3 + (f - 3) * 2] }));
    expect(simplifyLinear(pts, [1e-6]).map((p) => p.f)).toEqual([0, 3, 5]);
  });
  it("gainKeys: constant → 1 key; steps keep both sides; silence → −96 dB", () => {
    expect(gainKeys(() => -6, 100)).toEqual([{ frame: 0, value: -6, interp: "linear" }]);
    const k = gainKeys((f) => (f >= 40 && f < 52 ? -200 : -12), 100);
    expect(k.find((x) => x.frame === 39)!.value).toBe(-12);
    expect(k.find((x) => x.frame === 40)!.value).toBe(-96);
    expect(k.find((x) => x.frame === 51)!.value).toBe(-96);
    expect(k.find((x) => x.frame === 52)!.value).toBe(-12);
    expect(k.every((x) => x.value <= 12)).toBe(true);
    const fade = gainKeys((f) => 20 * Math.log10(Math.max(1e-9, 1 - f / 60)), 60);
    expect(fade.length).toBeLessThan(25);
    for (const x of fade) if (x.value > -60) expect(x.value).toBeCloseTo(20 * Math.log10(1 - x.frame / 60), 1);
  });
});
