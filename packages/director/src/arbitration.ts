// Step 9 — ARBITRATION (fatigue control, §9.3): salience window + min gap with priority classes (lowest resolved first:
// delay ≤ F30(6) to the next word onset, else drop), cooldown re-check, clean stretches (≥ minSec accent-free per window).
import { COMPONENT_META } from "@docmaker/core";
import { intensityAt, nextWordOnset, shotIdxAt, type Ctx, type Shot } from "./ctx";
import type { Fx, FxBook } from "./fx";
import type { Ov, OvState } from "./overlays";
import { CLS } from "./overlays/state";

type Ref = { t: "shot"; s: Shot } | { t: "fx"; f: Fx } | { t: "ov"; o: Ov } | { t: "impact"; key: string };
export interface Accent { frame: number; weight: number; cls: number; exempt: boolean; group: string | null; ref: Ref; id: string }

export interface ImpactEvent { key: string; frame: number; cls: number; combo: "reveal" | null; beatId: string | null }

const SLAMS = new Set(["KeywordSlam", "Stamp", "FreezeLabel"]);

export function collectAccents(ctx: Ctx, shots: readonly Shot[], st: OvState, book: FxBook, impacts: readonly ImpactEvent[], dropped: ReadonlySet<string>): Accent[] {
  const W = ctx.Bu.salience.weights;
  const out: Accent[] = [];
  for (const s of shots) {
    if (s.tkey === "cut" || s.from === 0) continue;
    const structural = s.tsource === "structural" || s.tsource === "explicit";
    out.push({
      frame: s.from, weight: s.tkey === "flash" ? W.flash : W.transitionNonCut,
      cls: structural ? CLS.structural : s.tsource === "cue" || s.tsource === "intent" ? CLS.cueTransition : CLS.quota,
      exempt: s.tsource === "montage", group: s.explicitFlash ? `reveal@${s.from}` : structural ? `struct@${s.from}` : null, ref: { t: "shot", s }, id: s.id,
    });
  }
  for (const f of book.live()) {
    if (f.role === "punch" || f.role === "fillPunch") out.push({ frame: f.from, weight: W.punch, cls: f.cls, exempt: false, group: null, ref: { t: "fx", f }, id: f.id });
    else if (f.role === "plate") out.push({ frame: f.from, weight: W.punch, cls: CLS.structural, exempt: false, group: `shock@${f.from}`, ref: { t: "fx", f }, id: f.id });
    else if (f.role === "revealFlash") out.push({ frame: f.from, weight: W.flash, cls: CLS.structural, exempt: false, group: `reveal@${f.from}`, ref: { t: "fx", f }, id: f.id });
  }
  const revealFrames = impacts.filter((i) => i.combo === "reveal").map((i) => i.frame);
  for (const o of st.items) {
    if (o.dropped || COMPONENT_META[o.component].band === "hud") continue;
    const structural = o.origin === "structural" || o.origin === "resource";
    const slam = SLAMS.has(o.component);
    const reveal = o.component === "Stamp" ? revealFrames.find((a) => o.from >= a && o.from - a <= ctx.F30(6)) : undefined;
    out.push({
      frame: o.from, weight: slam ? W.slam : W.overlayEntry, cls: structural ? CLS.structural : o.cls, exempt: false,
      group: reveal !== undefined ? `reveal@${reveal}` : structural ? `struct@${o.from}` : null, ref: { t: "ov", o }, id: o.id,
    });
  }
  for (const i of impacts) {
    if (dropped.has(i.key)) continue;
    out.push({ frame: i.frame, weight: W.impactSfx, cls: i.cls, exempt: false, group: i.combo === "reveal" ? `reveal@${i.frame}` : i.cls >= CLS.structural ? `struct@${i.frame}` : null, ref: { t: "impact", key: i.key }, id: i.key });
  }
  return out.sort((a, b) => a.frame - b.frame || (a.id < b.id ? -1 : 1));
}

/** Weight of accents in [s, s+W): designed-combo groups count once (their heaviest member). */
export function windowWeight(acc: readonly Accent[], s: number, W: number): number {
  let sum = 0;
  const groups = new Map<string, number>();
  for (const a of acc) {
    if (a.exempt || a.frame < s || a.frame >= s + W) continue;
    if (a.group) groups.set(a.group, Math.max(groups.get(a.group) ?? 0, a.weight));
    else sum += a.weight;
  }
  for (const w of groups.values()) sum += w;
  return sum;
}

function dropAccent(ctx: Ctx, a: Accent, droppedImpacts: Set<string>): void {
  switch (a.ref.t) {
    case "shot": a.ref.s.transition = { kind: "cut", accent: { type: "none" } }; a.ref.s.tkey = "cut"; a.ref.s.tsource = "none"; break;
    case "fx": a.ref.f.dropped = true; break;
    case "ov": a.ref.o.dropped = true; break;
    case "impact": droppedImpacts.add(a.ref.key); break;
  }
  void ctx;
}

function delayable(a: Accent): boolean {
  return a.ref.t === "fx" ? a.ref.f.role === "punch" || a.ref.f.role === "fillPunch" : a.ref.t === "ov";
}

/** Delays a punch/overlay to frame `to` (sub-beats keep their absolute frames). */
function delay(ctx: Ctx, a: Accent, to: number, shots: readonly Shot[], st: OvState): boolean {
  if (a.ref.t === "fx") {
    const f = a.ref.f;
    const s = shots[shotIdxAt(shots, to)]!;
    if (s !== shots[shotIdxAt(shots, f.from)] || s.end - to < ctx.P.punch.minTailFrames) return false;
    f.dur = s.end - to;
    f.from = to;
    f.anchorWord = ctx.words.find((w) => w.from === to)?.id ?? null;
    return true;
  }
  if (a.ref.t === "ov") {
    const o = a.ref.o;
    const d = to - o.from;
    if (o.from + o.dur + d > ctx.N) return false;
    // cooldown re-check against same-component items
    const cd = ctx.Bu.componentCooldownSec[o.component];
    if (cd !== undefined && st.items.some((x) => x !== o && !x.dropped && x.component === o.component && Math.abs(x.from - to) < ctx.S(cd))) return false;
    shiftOverlay(o, d);
    o.anchorWord = ctx.words.find((w) => w.from === to)?.id ?? null;
    return true;
  }
  return false;
}

/** Moves an overlay by d frames keeping its sub-beats on their absolute frames (relative `at` props shift back). */
export function shiftOverlay(o: Ov, d: number): void {
  o.from += d;
  const fix = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(fix);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        out[k] = (k === "at" || /At$/.test(k)) && typeof x === "number" ? Math.max(0, x - d) : fix(x);
      }
      return out;
    }
    return v;
  };
  o.props = fix(o.props) as Record<string, unknown>;
}

export interface ArbitrationResult { drops: number; cleanStretches: number; droppedImpacts: Set<string>; cleanRanges: [number, number][] }

export function arbitrate(ctx: Ctx, shots: Shot[], st: OvState, book: FxBook, impacts: readonly ImpactEvent[]): ArbitrationResult {
  const sal = ctx.Bu.salience;
  const W = ctx.S(sal.windowSec);
  const droppedImpacts = new Set<string>();
  const tolerated = new Set<string>();
  let drops = 0;
  for (let guard = 0; guard < 5000; guard++) {
    const acc = collectAccents(ctx, shots, st, book, impacts, droppedImpacts).filter((a) => !a.exempt);
    let viol: Accent[] | null = null;
    let key = "";
    for (let i = 0; i < acc.length && !viol; i++) {
      const a = acc[i]!;
      const cap = sal.maxAccents * intensityAt(ctx, a.frame);
      if (windowWeight(acc, a.frame, W) > cap + 1e-9) {
        key = `w${a.frame}`;
        if (!tolerated.has(key)) viol = acc.filter((x) => x.frame >= a.frame && x.frame < a.frame + W);
      }
      const p = acc[i - 1];
      if (!viol && p && a.frame - p.frame < sal.minGapFrames && !(a.group && a.group === p.group) && !(a.cls >= CLS.structural && p.cls >= CLS.structural)) {
        key = `g${p.frame}:${a.frame}`;
        if (!tolerated.has(key)) viol = [p, a];
      }
    }
    if (!viol) break;
    const victims = viol.filter((a) => a.cls < CLS.structural).sort((a, b) => a.cls - b.cls || b.frame - a.frame || (a.id < b.id ? 1 : -1));
    const v = victims[0];
    if (!v) { tolerated.add(key); continue; }
    let fixed = false;
    if (delayable(v)) {
      const w = nextWordOnset(ctx, v.frame, ctx.F30(6));
      if (w && delay(ctx, v, w.from, shots, st)) {
        // keep the delay only if it resolves this violation
        const after = collectAccents(ctx, shots, st, book, impacts, droppedImpacts).filter((a) => !a.exempt);
        const still = after.some((a) => windowWeight(after, a.frame, W) > sal.maxAccents * intensityAt(ctx, a.frame) + 1e-9 && a.frame <= w.from && w.from < a.frame + W)
          || after.some((a, i) => i > 0 && (a.id === v.id || after[i - 1]!.id === v.id) && a.frame - after[i - 1]!.frame < sal.minGapFrames && !(a.group && a.group === after[i - 1]!.group));
        if (!still) fixed = true;
        else if (v.ref.t === "ov") shiftOverlay(v.ref.o, v.frame - v.ref.o.from); // undo
        else if (v.ref.t === "fx") { const f = v.ref.f; const s = shots[shotIdxAt(shots, v.frame)]!; f.from = v.frame; f.dur = s.end - v.frame; }
      }
    }
    if (!fixed) { dropAccent(ctx, v, droppedImpacts); drops++; }
  }
  const clean = cleanStretches(ctx, shots, st, book, impacts, droppedImpacts);
  const runs = fixRuns(ctx, shots);
  return { drops: drops + clean.removed + runs, cleanStretches: clean.count, droppedImpacts, cleanRanges: clean.ranges };
}

/** Dropping transitions can line up three identical non-cut keys: the lowest-priority one of such a run becomes a cut. */
export function fixRuns(ctx: Ctx, shots: Shot[]): number {
  let n = 0;
  const run = ctx.T.noRepeatRun;
  for (let guard = 0; guard < 1000; guard++) {
    const nc = shots.filter((s, i) => i > 0 && s.tkey !== "cut");
    let hit: Shot[] | null = null;
    for (let i = run - 1; i < nc.length && !hit; i++) {
      const win = nc.slice(i - run + 1, i + 1);
      if (win.every((x) => x.tkey === win[0]!.tkey)) hit = win;
    }
    if (!hit) return n;
    const rank = (s: Shot) => (s.tsource === "structural" || s.tsource === "explicit" ? 9 : s.tsource === "montage" ? 1 : s.tsource === "quota" ? 2 : 3);
    const v = [...hit].sort((a, b) => rank(a) - rank(b) || b.from - a.from)[0]!;
    v.transition = { kind: "cut", accent: { type: "none" } };
    v.tkey = "cut";
    v.tsource = "none";
    n++;
  }
  return n;
}

/** Accent weight of the busiest salience window containing f if an accent of `weight` were added there. */
export function salienceRoom(ctx: Ctx, shots: readonly Shot[], st: OvState, book: FxBook, impacts: readonly ImpactEvent[], f: number, weight: number): boolean {
  const W = ctx.S(ctx.Bu.salience.windowSec);
  const acc = collectAccents(ctx, shots, st, book, impacts, new Set()).filter((a) => !a.exempt && a.frame > f - W && a.frame < f + W);
  if (acc.some((a) => Math.abs(a.frame - f) < ctx.Bu.salience.minGapFrames)) return false;
  const probe: Accent = { frame: f, weight, cls: 1, exempt: false, group: null, ref: { t: "impact", key: "probe" }, id: "~probe" };
  const all = [...acc, probe];
  for (const s of [f - W + 1, ...acc.filter((a) => a.frame <= f).map((a) => a.frame)]) {
    if (s > f) continue;
    if (windowWeight(all, s, W) > ctx.Bu.salience.maxAccents * intensityAt(ctx, s) + 1e-9) return false;
  }
  return true;
}

/** Every everySec block holds ≥ minSec without accents; else the cheapest window loses its non-structural accents. */
function cleanStretches(ctx: Ctx, shots: Shot[], st: OvState, book: FxBook, impacts: readonly ImpactEvent[], droppedImpacts: Set<string>): { count: number; removed: number; ranges: [number, number][] } {
  const every = ctx.S(ctx.Bu.cleanStretch.everySec);
  const need = ctx.S(ctx.Bu.cleanStretch.minSec);
  let count = 0, removed = 0;
  const ranges: [number, number][] = [];
  for (let b0 = 0; b0 < ctx.N; b0 += every) {
    const b1 = Math.min(ctx.N, b0 + every);
    if (b1 - b0 < need * 2) break;
    const acc = collectAccents(ctx, shots, st, book, impacts, droppedImpacts).filter((a) => !a.exempt && a.frame >= b0 && a.frame < b1);
    const pts = [b0, ...acc.map((a) => a.frame), b1];
    let best = 0, at = b0;
    for (let k = 1; k < pts.length; k++) if (pts[k]! - pts[k - 1]! > best) { best = pts[k]! - pts[k - 1]!; at = pts[k - 1]!; }
    if (best >= need) { count++; ranges.push([at, at + best]); continue; }
    // cheapest window of `need` frames without structural accents (prefer calm narration)
    let pick: { s: number; cost: number } | null = null;
    const starts = new Set<number>([b0, ...acc.map((a) => a.frame + 1)]);
    for (const s of [...starts].sort((a, b) => a - b)) {
      if (s + need > b1) continue;
      const inside = acc.filter((a) => a.frame >= s && a.frame < s + need);
      if (inside.some((a) => a.cls >= CLS.structural)) continue;
      const energy = ctx.beats.filter((b) => b.from < s + need && b.end > s).reduce((m, b) => Math.max(m, b.energy), 0);
      const cost = inside.reduce((x, a) => x + a.cls * a.weight, 0) + (energy > 2 ? 0.5 : 0);
      if (!pick || cost < pick.cost) pick = { s, cost };
    }
    if (!pick) continue;
    for (const a of acc.filter((x) => x.frame >= pick!.s && x.frame < pick!.s + need)) { dropAccent(ctx, a, droppedImpacts); removed++; }
    count++;
    ranges.push([pick.s, pick.s + need]);
  }
  return { count, removed, ranges };
}
