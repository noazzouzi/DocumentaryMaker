// Step 8 — VISUAL CHANGE (§9.3): no gap between visual events longer than visualChangeSec[1]: split the shot at the
// word onset nearest the gap middle (the second part is a camera-change shot), or punch a full-frame follower card.
import { COMPONENT_META } from "@docmaker/core";
import { shotIdxAt, wordIdxAtOrBefore, type Ctx, type Shot } from "./ctx";
import type { FxBook } from "./fx";
import type { OvState } from "./overlays";
import { CLS } from "./overlays/state";
import { numberShots } from "./shots";

/** Visual events: cuts, punches/fx hits, overlay entries and VO-synced sub-beats. */
export function visualEvents(ctx: Ctx, shots: readonly Shot[], st: OvState, book: FxBook): number[] {
  const ev = new Set<number>();
  for (let i = 1; i < shots.length; i++) ev.add(shots[i]!.from);
  for (const f of book.live()) if (f.role === "punch" || f.role === "fillPunch" || f.role === "beatPunch" || f.role === "cardPunch" || f.role === "plate" || f.role === "revealFlash") ev.add(f.from);
  for (const o of st.items) {
    if (o.dropped || COMPONENT_META[o.component].band === "hud") continue;
    ev.add(o.from);
    for (const s of o.subBeats) ev.add(s);
  }
  return [...ev].filter((f) => f > 0 && f < ctx.N).sort((a, b) => a - b);
}

export function maxGap(ctx: Ctx, events: readonly number[]): { gap: number; e0: number; e1: number } {
  const pts = [0, ...events, ctx.N];
  let best = { gap: 0, e0: 0, e1: 0 };
  for (let k = 1; k < pts.length; k++) if (pts[k]! - pts[k - 1]! > best.gap) best = { gap: pts[k]! - pts[k - 1]!, e0: pts[k - 1]!, e1: pts[k]! };
  return best;
}

export function visualChangePass(ctx: Ctx, shots: Shot[], st: OvState, book: FxBook): { splits: number; cardPunches: number } {
  const limit = ctx.S(ctx.P.shots.visualChangeSec[1]);
  const minShot = ctx.P.shots.minShotFrames;
  const cutLead = ctx.P.shots.cutLeadFrames;
  const skip = new Set<number>(); // gap starts that cannot be fixed
  let splits = 0, cardPunches = 0;
  for (let guard = 0; guard < 2000; guard++) {
    const pts = [0, ...visualEvents(ctx, shots, st, book), ctx.N];
    let gap: { e0: number; e1: number } | null = null;
    for (let k = 1; k < pts.length; k++) {
      if (pts[k]! - pts[k - 1]! > limit && !skip.has(pts[k - 1]!)) { gap = { e0: pts[k - 1]!, e1: pts[k]! }; break; }
    }
    if (!gap) break;
    const mid = (gap.e0 + gap.e1) / 2;
    const card = st.items.find((o) => !o.dropped && COMPONENT_META[o.component].fullFrame && COMPONENT_META[o.component].band === "graphics" && o.from <= mid && mid < o.from + o.dur);
    if (card) {
      if (!card.subBeats.length && COMPONENT_META[card.component].followsCamera) {
        const wi = wordIdxAtOrBefore(ctx, Math.round(mid));
        const cands = [ctx.words[wi], ctx.words[wi + 1]].filter((w) => w && w.from > gap!.e0 + ctx.F30(15) && w.from < gap!.e1 - ctx.F30(15) && w.from < card.from + card.dur - ctx.F30(10));
        const w = cands.sort((a, b) => Math.abs(a!.from - mid) - Math.abs(b!.from - mid))[0];
        const at = w ? w.from : Math.round(mid);
        if (at > gap.e0 && at < gap.e1) {
          const end = card.from + card.dur;
          if (book.add(ctx, w?.id ?? `${card.id}@${at}`, { fx: "zoom", shape: "span", amt: 0.04, fade: 6, from: at, dur: end - at, target: "picture+followers", role: "cardPunch", anchorWord: w?.id ?? null, cls: CLS.fill, beatId: card.beatId })) {
            cardPunches++;
            continue;
          }
        }
      }
      skip.add(gap.e0);
      continue;
    }
    const si = shotIdxAt(shots, Math.round(mid));
    const s = shots[si]!;
    if (s.role === "montage") { skip.add(gap.e0); continue; }
    if (s.role === "clip") {
      // a clip keeps its framing (pip/cover switch at a sentence boundary): a gentle push-in reads as the change
      const at = Math.round(mid);
      if (s.end - at >= ctx.F30(20) && book.add(ctx, `${s.id}@${at}`, { fx: "zoom", shape: "span", amt: 0.06, fade: 8, from: at, dur: s.end - at, x: s.src.focal.x, y: s.src.focal.y, target: "picture+followers", role: "cardPunch", anchorWord: null, cls: CLS.fill, beatId: s.beatId })) {
        cardPunches++;
        continue;
      }
      skip.add(gap.e0);
      continue;
    }
    const lo = Math.max(s.from + minShot, gap.e0 + 1), hi = Math.min(s.end - minShot, gap.e1 - 1);
    if (hi < lo) { skip.add(gap.e0); continue; }
    let split: number | null = null;
    let word: string | null = null;
    for (let k = wordIdxAtOrBefore(ctx, lo); k < ctx.words.length; k++) {
      const w = ctx.words[k];
      if (!w || w.from - cutLead > hi) break;
      const f = w.from - cutLead;
      if (f < lo) continue;
      if (split === null || Math.abs(f - mid) < Math.abs(split - mid)) { split = f; word = w.id; }
    }
    if (split === null) split = Math.round(Math.min(hi, Math.max(lo, mid)));
    const rest: Shot = {
      ...s, id: "", from: split, change: true, anchorWord: word, anchorOffset: word ? -cutLead : 0, explicitFlash: false, zoomCut: false,
      transition: { kind: "cut", accent: { type: "none" } }, tkey: "cut", tsource: "none", snap: "none", camera: null,
      src: s.src.kind === "video" ? { ...s.src, sourceIn: s.src.sourceIn + (split - s.from) } : { ...s.src },
    };
    s.end = split;
    shots.splice(si + 1, 0, rest);
    // span punches held "to the cut" now end at the new cut
    for (const f of book.live()) {
      if ((f.role === "punch" || f.role === "fillPunch") && f.from < split && f.from + f.dur > split) f.dur = split - f.from;
    }
    splits++;
  }
  numberShots(shots);
  return { splits, cardPunches };
}
