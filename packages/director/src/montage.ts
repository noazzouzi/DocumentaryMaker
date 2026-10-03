// Step 2b — MONTAGE (breath beats, MONTAGE cues): fast cuts snapped to the music beat grid (every 4th on a downbeat),
// sources = the beat's picks then neighbouring beats' picks (as reframes). Transitions and beat punches are applied later
// from Shot.snap (transitions.ts, fx.ts).
import { lerp } from "@docmaker/core";
import type { BeatCtx, Ctx, Shot, Src } from "./ctx";
import { nearestIn, type MusicPlan } from "./music";
import { blankShot, sourcesFor } from "./shots";

export const MONTAGE_MIN30 = 10;

/** The beat's own picks, then picks of the chapter's other beats by distance (neighbours first). */
function montageSources(ctx: Ctx, b: BeatCtx): { src: Src; borrowed: boolean }[] {
  const own = (ctx.picksByBeat.get(b.id) ?? []).length > 0 ? sourcesFor(ctx, b).map((src) => ({ src, borrowed: false })) : [];
  const others = b.ch.beats
    .filter((x) => x.id !== b.id && (ctx.picksByBeat.get(x.id) ?? []).length > 0)
    .sort((x, y) => Math.abs(x.idx - b.idx) - Math.abs(y.idx - b.idx) || x.idx - y.idx);
  const out = [...own];
  const seen = new Set(out.map((o) => o.src.key));
  for (const o of others) {
    for (const src of sourcesFor(ctx, o)) {
      if (seen.has(src.key)) continue;
      seen.add(src.key);
      out.push({ src, borrowed: true });
    }
    if (out.length >= 8) break;
  }
  if (out.length === 0) out.push({ src: sourcesFor(ctx, b)[0]!, borrowed: false });
  return out;
}

export function montageShots(ctx: Ctx, b: BeatCtx, bs: number, be: number, music: MusicPlan): Shot[] {
  const asl = ctx.S(lerp(ctx.P.montage.aslSec, ctx.R(`mon:${b.id}`)()));
  const minF = ctx.F30(MONTAGE_MIN30);
  const snap = ctx.P.montage.snapFrames;
  const cuts: { f: number; snap: Shot["snap"] }[] = [];
  let pos = bs;
  for (let k = 1; k < 500; k++) {
    const target = pos + asl;
    if (target > be - minF) break;
    let f = Math.round(target);
    let kind: Shot["snap"] = "none";
    const ok = (x: number) => x - pos >= minF && be - x >= minF;
    if (k % 4 === 0) {
      const d = nearestIn(music.downbeats, target, Math.floor(asl / 2));
      if (d !== null && ok(d)) { f = d; kind = "downbeat"; }
    }
    if (kind === "none") {
      const g = nearestIn(music.beats, target, snap);
      if (g !== null && ok(g)) { f = g; kind = music.downbeats.includes(g) ? "downbeat" : "beat"; }
    }
    if (!ok(f)) break;
    cuts.push({ f, snap: kind });
    pos = f;
  }
  const srcs = montageSources(ctx, b);
  const bounds = [{ f: bs, snap: "none" as Shot["snap"] }, ...cuts, { f: be, snap: "none" as Shot["snap"] }];
  const out: Shot[] = [];
  // a video source plays on from where its previous montage shot stopped (one cursor per source) instead of replaying
  // its head; an exhausted source yields to the next one with media left, else re-enters as late as its media allows
  const cursor = new Map<string, number>();
  const tailPad = ctx.F30(8); // room for a montage overlap's tail handle
  const room = (x: Src, len: number) => x.kind !== "video" || x.mediaFrames === null || (cursor.get(x.key) ?? x.sourceIn) + len + tailPad <= x.mediaFrames;
  for (let k = 0; k + 1 < bounds.length; k++) {
    const len = bounds[k + 1]!.f - bounds[k]!.f;
    let j = k % srcs.length;
    for (let d = 0; d < srcs.length && !room(srcs[(k + d) % srcs.length]!.src, len); d++) j = (k + d + 1) % srcs.length;
    if (!room(srcs[j]!.src, len)) j = k % srcs.length;
    const pick = srcs[j]!;
    const src: Src = { ...pick.src };
    if (src.kind === "video") {
      src.sourceIn = cursor.get(src.key) ?? src.sourceIn;
      if (src.mediaFrames !== null && src.sourceIn + len + tailPad > src.mediaFrames) src.sourceIn = Math.max(src.headHandle, src.mediaFrames - len - tailPad);
      cursor.set(src.key, src.sourceIn + len);
    }
    out.push(blankShot({
      chapterId: b.ch.id, beatId: b.id, from: bounds[k]!.f, end: bounds[k + 1]!.f, src, role: "montage",
      change: pick.borrowed || k >= srcs.length, snap: k === 0 ? "none" : bounds[k]!.snap,
    }));
  }
  return out;
}
