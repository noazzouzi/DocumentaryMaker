// Step 6 — PUNCHES (§9.3): candidates by priority (EMPHASIS cue > emphasis words > first word of energy ≥ 4 beats >
// clip key line), acceptance rules (quiet zones, gaps, caps, punchable picture, tail, exclusion, upscale headroom),
// then the fill pass (zoom cuts, strongest remaining candidates) and the per-chapter floor.
import { COMPONENT_META, lerp, msToFrame, type LayoutWord } from "@docmaker/core";
import { camMax } from "./camera";
import { cueWord, intensityAt, rateOk, shotIdxAt, type BeatCtx, type Ctx, type Shot } from "./ctx";
import type { Fx, FxBook } from "./fx";
import { eligibleSeconds } from "./music";
import type { OvState } from "./overlays";
import { CLS } from "./overlays/state";

export interface PunchCand { frame: number; word: LayoutWord | null; beat: BeatCtx; prio: number; amt: number; fill: boolean }

const amtFor = (ctx: Ctx, b: BeatCtx) => lerp(ctx.P.punch.scale, Math.min(5, Math.max(1, b.energy)) / 5) - 1;

/** Priority candidates (and, with fill=true, the extra fill candidates). */
export function punchCandidates(ctx: Ctx, withFill: boolean): PunchCand[] {
  const out: PunchCand[] = [];
  const seen = new Set<number>();
  const push = (c: PunchCand) => { if (!seen.has(c.frame)) { seen.add(c.frame); out.push(c); } };
  for (const b of ctx.beats) {
    if (b.montage) continue;
    b.cues.forEach((c, k) => {
      if (c.type !== "EMPHASIS") return;
      const w = cueWord(ctx, b, k);
      if (w) push({ frame: w.from, word: w, beat: b, prio: 4, amt: amtFor(ctx, b), fill: false });
    });
    for (const i of b.text.emphasisIdx) {
      const w = ctx.words[b.wordStart + i];
      if (w && b.wordStart + i < b.wordEnd) push({ frame: w.from, word: w, beat: b, prio: 3, amt: amtFor(ctx, b), fill: false });
    }
    if (b.energy >= 4 && b.wordEnd > b.wordStart) {
      const w = ctx.words[b.wordStart]!;
      push({ frame: w.from, word: w, beat: b, prio: 2, amt: amtFor(ctx, b), fill: false });
    }
    if (b.isClip && b.seg.mode === "clip" && b.seg.dur > ctx.S(6)) {
      const cw = ctx.I.clipWords[b.seg.segmentId] ?? [];
      const clip = ctx.clipBySeg.get(b.seg.segmentId);
      if (clip?.passageInMs !== null && clip?.passageInMs !== undefined && cw.length > 1) {
        let k = cw.length - 1;
        for (let j = cw.length - 2; j >= 0; j--) { if (/[.?!…]["»”]?$/.test(cw[j]!.text.trim())) { k = j + 1; break; } }
        const f = b.seg.from + msToFrame(cw[k]!.startMs - clip.passageInMs, ctx.fps);
        if (f > b.seg.from && f < b.seg.from + b.seg.dur) push({ frame: f, word: null, beat: b, prio: 1, amt: ctx.P.clip.keyLinePunch, fill: false });
      }
    }
  }
  if (withFill) {
    for (const b of ctx.beats) {
      if (b.montage || b.wordEnd <= b.wordStart) continue;
      const ws = ctx.words.slice(b.wordStart, b.wordEnd);
      push({ frame: ws[0]!.from, word: ws[0]!, beat: b, prio: 0.5, amt: amtFor(ctx, b), fill: true });
      for (const w of ws) if (/\p{N}/u.test(w.norm) || w.norm.length >= 8) push({ frame: w.from, word: w, beat: b, prio: 0.3, amt: amtFor(ctx, b), fill: true });
    }
  }
  return out.sort((a, b) => b.prio - a.prio || a.frame - b.frame);
}

/** Max planned punch amount per shot (camera upscale guard reserve). */
export function plannedReserve(ctx: Ctx, shots: readonly Shot[]): (s: Shot) => number {
  const best = new Map<Shot, number>();
  for (const c of punchCandidates(ctx, false)) {
    const s = shots[shotIdxAt(shots, c.frame)]!;
    best.set(s, Math.max(best.get(s) ?? 0, c.amt));
  }
  return (s) => best.get(s) ?? 0;
}

export interface PunchEnv { shots: Shot[]; st: OvState; book: FxBook; quiet: [number, number][]; room: (f: number) => boolean }

const isPunch = (f: Fx) => !f.dropped && (f.role === "punch" || f.role === "fillPunch");

/** All punch-like events (span zoom punches + zoom cuts) in program frames. */
export function punchFrames(env: PunchEnv): number[] {
  return [...env.book.items.filter(isPunch).map((f) => f.from), ...env.shots.filter((s) => s.zoomCut).map((s) => s.from)].sort((a, b) => a - b);
}

/** Tries to accept a punch at candidate c; returns the Fx or null. */
function tryPunch(ctx: Ctx, env: PunchEnv, c: PunchCand, fill: boolean): Fx | null {
  const P = ctx.P.punch;
  const a = c.frame;
  if (env.quiet.some(([q0, q1]) => a >= q0 && a < q1)) return null;
  const frames = punchFrames(env);
  if (frames.some((f) => Math.abs(f - a) < P.minGapFrames)) return null;
  if (!rateOk(ctx, frames, a, P.perMin[1] * intensityAt(ctx, a))) return null;
  const si = shotIdxAt(env.shots, a);
  const s = env.shots[si]!;
  if (s.role === "montage") return null;
  const follower = env.st.items.find((o) => !o.dropped && COMPONENT_META[o.component].followsCamera && o.from <= a && a < o.from + o.dur);
  const pictureOk = s.src.kind === "image" || s.src.kind === "video";
  if (!pictureOk && !follower) return null;
  if (s.end - a < P.minTailFrames) return null;
  const ex = P.exclusionFrames;
  for (let j = Math.max(1, si - 1); j <= Math.min(env.shots.length - 1, si + 1); j++) {
    const B = env.shots[j]!;
    const d = Math.abs(B.from - a);
    if (B.tkey !== "cut" && d <= ex) return null;
    if (B.transition.kind === "cover" && Math.abs(B.from - a) <= ex + B.transition.durationFrames / 2) return null;
    if (d > 0 && d <= ex) return null;
  }
  if (env.st.items.some((o) => !o.dropped && Math.abs(o.from - a) <= ex && o.component !== "SourceLabel")) return null;
  // upscale headroom
  let amt = c.amt;
  if (pictureOk) {
    const head = s.maxCamScale / Math.max(1, camMax(s.camera)) - 1;
    amt = Math.min(amt, head);
  }
  if (amt < 0.08) return null;
  if (fill && !env.room(a)) return null;
  const fx = env.book.add(ctx, c.word?.id ?? `${c.beat.id}@${a}`, {
    fx: "zoom", shape: "span", amt, fade: P.inFrames[1], from: a, dur: s.end - a, x: s.src.focal.x, y: s.src.focal.y,
    target: "picture+followers", role: fill ? "fillPunch" : "punch", anchorWord: c.word?.id ?? null,
    cls: fill ? CLS.fill : c.prio >= 4 ? CLS.cue : CLS.quota, beatId: c.beat.id,
  });
  return fx;
}

/** Acts ≥ exemptActsShorterThanSec as [from, end) frame ranges. */
export function eligibleRanges(ctx: Ctx): [number, number][] {
  const out: [number, number][] = [];
  let k = 0;
  while (k < ctx.chapters.length) {
    let j = k;
    while (j + 1 < ctx.chapters.length && ctx.chapters[j + 1]!.act === ctx.chapters[k]!.act) j++;
    const from = ctx.chapters[k]!.from, end = ctx.chapters[j]!.end;
    if ((end - from) / ctx.fps >= ctx.style.techniqueFloor.exemptActsShorterThanSec) out.push([from, end]);
    k = j + 1;
  }
  return out;
}

/** 60-s windows (10-s steps) fully inside eligible acts. */
export function floorWindows(ctx: Ctx): [number, number][] {
  const W = ctx.S(60), step = ctx.S(10);
  const out: [number, number][] = [];
  for (const [a, e] of eligibleRanges(ctx)) {
    if (e - a < W) continue;
    for (let s = a; s + W <= e; s += step) out.push([s, s + W]);
    if ((e - a - W) % step !== 0) out.push([e - W, e]);
  }
  return out;
}

export function placePunches(ctx: Ctx, env: PunchEnv): void {
  for (const c of punchCandidates(ctx, false)) tryPunch(ctx, env, c, false);
  if (!ctx.P.punch.fillToMin) return;
  void eligibleSeconds;
  const fillCands = punchCandidates(ctx, true).sort((a, b) => b.amt - a.amt || b.prio - a.prio || a.frame - b.frame);
  for (const [w0, w1] of floorWindows(ctx)) {
    const minI = Math.min(...ctx.chapters.filter((c) => c.from < w1 && c.end > w0).map((c) => ctx.Bu.actIntensity[c.act] ?? 1));
    const floor = Math.ceil(ctx.P.punch.perMin[0] * minI - 1e-9);
    const count = () => punchFrames(env).filter((f) => f >= w0 && f < w1).length;
    // (1) zoom cuts: intra-beat cuts between shots of the same asset
    for (let i = 1; i < env.shots.length && count() < floor; i++) {
      const A = env.shots[i - 1]!, B = env.shots[i]!;
      if (B.from < w0 || B.from >= w1 || B.zoomCut || B.role !== "normal" || A.beatId !== B.beatId) continue;
      if (!B.src.assetId || B.src.assetId !== A.src.assetId || B.layout !== A.layout || B.tkey !== "cut") continue;
      if (B.maxCamScale < ctx.P.reframe.scale[0]) continue;
      const frames = punchFrames(env);
      if (frames.some((f) => Math.abs(f - B.from) < ctx.P.punch.minGapFrames)) continue;
      if (!rateOk(ctx, frames, B.from, ctx.P.punch.perMin[1] * intensityAt(ctx, B.from))) continue;
      if (env.quiet.some(([q0, q1]) => B.from >= q0 && B.from < q1)) continue;
      if (!env.room(B.from)) continue;
      B.zoomCut = true;
      B.change = true;
      // a zoom cut reads as a punch: tight reframe + a short pulse on the cut
      B.transition = { kind: "cut", accent: { type: "pulse", amt: Math.min(0.1, ctx.P.cutAccent.pulseAmt), frames: Math.max(1, ctx.F30(ctx.P.cutAccent.pulseFrames)) } };
      B.tkey = "cut";
    }
    // (2) strongest remaining candidates (all other constraints hold)
    for (const c of fillCands) {
      if (count() >= floor) break;
      if (c.frame < w0 || c.frame >= w1) continue;
      tryPunch(ctx, env, c, true);
    }
  }
  // per-chapter floor
  const perCh = ctx.style.techniqueFloor.perChapter.punch ?? 0;
  if (perCh > 0) {
    for (const ch of ctx.chapters) {
      const n = () => punchFrames(env).filter((f) => f >= ch.from && f < ch.end).length;
      for (const c of fillCands) {
        if (n() >= perCh) break;
        if (c.frame < ch.from || c.frame >= ch.end) continue;
        tryPunch(ctx, env, c, true);
      }
    }
  }
}
