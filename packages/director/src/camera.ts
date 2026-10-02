// Step 4 — CAMERA (§9.3): rate-based Ken Burns with kbEase and a direction ledger, reframes (tight/wide), pull-backs,
// creeps (TENSION_BUILD / IRONY / video / clips), upscale guard (camera × planned punch ≤ maxCamScale) and overscan.
import { lerp, type CameraMove } from "@docmaker/core";
import { clamp, type Ctx, type Shot } from "./ctx";

type Dir = "in" | "out" | "left" | "right" | "up" | "down";
const DIRS: readonly Dir[] = ["in", "out", "left", "right", "up", "down"];
const OPP: Record<Dir, Dir> = { in: "out", out: "in", left: "right", right: "left", up: "down", down: "up" };
const W = 1920, H = 1080;
const r4 = (x: number) => Math.round(x * 10000) / 10000;
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Deterministic preference order of the six directions for one shot. */
function ranking(r: () => number): Dir[] {
  const a = [...DIRS];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Largest |translation| (px) a cover-filled picture allows on one side at scale s around origin o. */
function room(s: number, o: number, size: number, sign: 1 | -1): number {
  // x ≤ (s−1)·o (content moved right) and x ≥ −(s−1)·(size−o) (moved left)
  return sign > 0 ? Math.max(0, (s - 1) * o) : Math.max(0, (s - 1) * (size - o));
}

function staticCam(scale: number, origin: { x: number; y: number }): CameraMove {
  return { kind: "static", keys: [{ f: 0, scale: r4(scale), x: 0, y: 0, rot: 0 }], ease: "linear", origin, blurFromPx: 0, handheld: null, direction: "none" };
}

export interface CameraOptions { reserve: (s: Shot) => number }

export function assignCameras(ctx: Ctx, shots: Shot[], o: CameraOptions): void {
  let prevDir: Dir | null = null;
  const lastBase = new Map<string, number>();
  const kb = ctx.P.kenBurns;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]!;
    const dur = Math.max(1, s.end - s.from);
    const b = s.beatId ? ctx.beatById.get(s.beatId) ?? null : null;
    const r = ctx.R(`cam:${s.beatId ?? s.chapterId}:${s.from}`);
    const origin = { x: clamp(s.src.focal.x, 0, 1), y: clamp(s.src.focal.y, 0, 1) };
    const maxS = Math.max(1, s.maxCamScale / (1 + Math.max(0, o.reserve(s))));
    const coverLike = s.layout === "cover" || s.src.kind === "generated";
    const intensity = b?.intensity ?? 1;
    const srcKey = s.src.assetId ?? s.src.key;
    const creep = (from: number, to: number): CameraMove => ({
      kind: "creep", keys: [{ f: 0, scale: r4(from), x: 0, y: 0, rot: 0 }, { f: dur, scale: r4(to), x: 0, y: 0, rot: 0 }],
      ease: "linear", origin, blurFromPx: 0, handheld: null, direction: "none",
    });
    let cam: CameraMove;
    const tension = b && (b.cueTypes.has("TENSION_BUILD") || b.cueTypes.has("IRONY")) && s.role !== "clip";
    if (s.role === "clip") {
      cam = creep(1, Math.min(maxS, lerp(ctx.P.clip.creep, r())));
    } else if (tension && b) {
      const beatShots = shots.filter((x) => x.beatId === b.id);
      const bs = beatShots[0]!.from, be = beatShots[beatShots.length - 1]!.end;
      const c = Math.min(maxS, lerp(ctx.P.creep.scale, ctx.R(`creep:${b.id}`)()));
      const at = (f: number) => 1 + ((c - 1) * (f - bs)) / Math.max(1, be - bs);
      if (s.change || s.zoomCut) {
        // a camera-change shot inside a creep keeps the creep's speed on a tight/wide reframe of its source
        const wasWide = s.zoomCut || (lastBase.get(srcKey) ?? 1) < 1.15;
        const base = Math.min(maxS / Math.max(1, at(s.end)), wasWide ? lerp(ctx.P.reframe.scale, r()) : lerp(ctx.P.reframe.wideScale, r()));
        cam = { ...creep(base * at(s.from), base * at(s.end)), kind: "reframe" };
      } else cam = creep(at(s.from), at(s.end));
    } else if (s.src.kind === "video") {
      const prevSame = shots[i - 1] && shots[i - 1]!.src.assetId === s.src.assetId ? shots[i - 1]! : null;
      const reframe = s.zoomCut || (s.change && (prevSame === null || prevSame.layout === s.layout));
      const wants = (dur >= ctx.S(4) && b !== null && (b.plan.camera === "slow_push_in" || b.plan.camera === "ken_burns"));
      if (reframe) {
        const wasWide = s.zoomCut || (lastBase.get(srcKey) ?? 1) < 1.15;
        const base = Math.min(maxS, wasWide ? lerp(ctx.P.reframe.scale, r()) : lerp(ctx.P.reframe.wideScale, r()));
        const end = wants ? Math.min(maxS, base * lerp(kb.videoCreep, r())) : base;
        cam = { ...creep(base, end), kind: "reframe" };
      } else cam = wants ? creep(1, Math.min(maxS, lerp(kb.videoCreep, r()))) : staticCam(1, origin);
    } else if (b && b.plan.camera === "zoom_out_reveal" && shots[i - 1]?.beatId !== b.id) {
      const pf = Math.min(ctx.P.pullBack.frames, dur);
      cam = {
        kind: "pullBack", keys: [{ f: 0, scale: r4(Math.min(maxS, ctx.P.pullBack.from)), x: 0, y: 0, rot: 0 }, { f: pf, scale: 1, x: 0, y: 0, rot: 0 }],
        ease: "expoOut", origin, blurFromPx: ctx.P.pullBack.blurPx, handheld: null, direction: "none",
      };
    } else {
      // reframe when this is a camera-change shot that kept the previous layout of its source
      const prevSame = shots[i - 1] && (shots[i - 1]!.src.assetId ?? shots[i - 1]!.src.key) === srcKey ? shots[i - 1]! : null;
      const reframe = s.zoomCut || (s.change && (prevSame === null || prevSame.layout === s.layout));
      let base = 1;
      if (reframe) {
        const wasWide = s.zoomCut || (lastBase.get(srcKey) ?? 1) < 1.15;
        base = wasWide ? lerp(ctx.P.reframe.scale, r()) : lerp(ctx.P.reframe.wideScale, r());
        base = Math.min(base, maxS);
      }
      if (dur >= ctx.S(kb.minShotSec)) {
        cam = kenBurns(ctx, s, i, shots, r, { base: reframe ? base : null, maxS, intensity, origin, coverLike, prevDir });
        if (reframe) cam.kind = "reframe";
      } else if (reframe) {
        cam = { ...staticCam(base, origin), kind: "reframe" };
      } else cam = staticCam(Math.min(1.04, maxS), origin);
    }
    if (ctx.P.handheld) cam.handheld = ctx.P.handheld;
    if (cam.direction !== "none") prevDir = cam.direction as Dir;
    lastBase.set(srcKey, Math.min(...cam.keys.map((k) => k.scale)));
    s.camera = cam;
  }
}

function kenBurns(
  ctx: Ctx, s: Shot, i: number, shots: Shot[], r: () => number,
  o: { base: number | null; maxS: number; intensity: number; origin: { x: number; y: number }; coverLike: boolean; prevDir: Dir | null },
): CameraMove {
  const kb = ctx.P.kenBurns;
  const dur = s.end - s.from;
  const durSec = dur / ctx.fps;
  const order = ranking(r);
  const allowed = order.filter((d) => !o.prevDir || (d !== o.prevDir && d !== OPP[o.prevDir]));
  // seam ledger: the outgoing shot before a velocity whip prefers the whip's direction
  const nx = shots[i + 1]?.transition;
  const whip = nx && nx.kind === "cut" && nx.accent.type === "velocity" && nx.accent.preset === "whip" ? (nx.accent.direction as Dir) : null;
  const dir: Dir = whip && allowed.includes(whip) ? whip : allowed[0] ?? order[0]!;
  let rate = lerp(kb.scaleRatePerSec, r()) * o.intensity;
  let drift = lerp(kb.driftPxPerSec, r());
  let s0 = o.base ?? lerp(kb.scaleStart, r());
  const lateral = dir === "left" || dir === "right" || dir === "up" || dir === "down";
  const ox = o.origin.x * W, oy = o.origin.y * H;
  const axisSize = dir === "up" || dir === "down" ? H : W;
  const axisOrigin = dir === "up" || dir === "down" ? oy : ox;
  if (lateral && o.coverLike) {
    // overscan for the travel: start scale must cover half the drift on the side it starts from
    const halfD = (drift * durSec) / 2;
    const tight = Math.max(1, Math.min(axisOrigin, axisSize - axisOrigin));
    s0 = Math.max(s0, 1 + halfD / tight + 0.004);
  }
  // upscale guard: reduce the rate, then the start scale, then the drift
  s0 = Math.min(s0, o.maxS);
  if (s0 + rate * durSec > o.maxS) rate = Math.max(0, (o.maxS - s0) / durSec);
  const s1 = s0 + rate * durSec;
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0;
  if (lateral) {
    let D = drift * durSec;
    if (o.coverLike) {
      // content moving toward −: starts at +D/2 (needs room on the + side at s0), ends at −D/2 (room on the − side at s1)
      const neg = dir === "left" || dir === "up";
      const startRoom = room(s0, axisOrigin, axisSize, neg ? 1 : -1);
      const endRoom = room(s1, axisOrigin, axisSize, neg ? -1 : 1);
      D = Math.min(D, 2 * startRoom, 2 * endRoom);
      drift = D / durSec;
    }
    const a = D / 2;
    if (dir === "left") { x0 = a; x1 = -a; }
    if (dir === "right") { x0 = -a; x1 = a; }
    if (dir === "up") { y0 = a; y1 = -a; }
    if (dir === "down") { y0 = -a; y1 = a; }
  }
  const [sa, sb] = dir === "out" ? [s1, s0] : [s0, s1];
  return {
    kind: "kenBurns",
    keys: [{ f: 0, scale: r4(sa), x: r2(x0), y: r2(y0), rot: 0 }, { f: dur, scale: r4(sb), x: r2(x1), y: r2(y1), rot: 0 }],
    ease: "kb", origin: o.origin, blurFromPx: 0, handheld: null, direction: dir,
  };
}

/** Max key scale of a camera. */
export const camMax = (c: CameraMove | null) => (c ? Math.max(...c.keys.map((k) => k.scale)) : 1);
