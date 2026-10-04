// Dead air (§9.3 step 7c): a generated backdrop (gradientGrid / paper / darkNoise, or a keywordCard without text) is a
// stage, not content — and so is a procedural fallback asset (gradient-grid / archive-still / paper-drift picked as an
// image or video when no real picture was found: the same empty backdrop under another source kind). No stretch of the picture track may show a bare backdrop with no foreground graphic for longer
// than DEAD_AIR_MAX_SEC. Fills, in order of preference:
//   1. the VO-synced card that ends the stretch (QuoteCard, TimelineGraphic, …) enters earlier — its sub-items keep
//      their spoken frames, the first list item shows at the entry;
//   2. the card that starts the stretch holds longer (≤ its maxHold);
//   3. the neighbouring real shot of the same beat holds (the cut moves), when shots may still change;
//   4. a KineticText of the beat's emphasis words (style policy and cooldown respected, readable in the stretch);
//   5. the neighbouring real shot of the adjacent beat of the chapter holds;
//   6. the KineticText regardless of its cooldown.
// Shot edits (3, 5) run only in the pass before cameras and visual change; the second pass (after arbitration) is
// overlay-only.
import { COMPONENT_META, framesAt, isFunctionWord, type OverlayComponentId } from "@docmaker/core";
import { truncate, type BeatCtx, type Ctx, type Shot } from "./ctx";
import { contentText } from "./overlays/cues";
import { holdOf } from "./overlays/hold";
import { CLS, addOv, cooldownOk, policyOf, type OvState } from "./overlays/state";
import { moveCut, numberShots } from "./shots";

export const DEAD_AIR_MAX_SEC = 1.2;

/** Components that may enter before their cue: they show a meaningful card (portrait, document, map) before the first sub-item. */
const EARLY_OK: ReadonlySet<OverlayComponentId> = new Set([
  "QuoteCard", "TimelineGraphic", "MapPin", "HeadlineStack", "DocumentCard", "ArticleHighlight", "SocialPost", "BarChart", "PhotoBurst",
  "EvidenceBoard", "CommentPile",
]);
/** Components whose first list item is moved to the (earlier) entry so the card never opens empty. */
const LIST_KEY: Partial<Record<OverlayComponentId, string>> = {
  TimelineGraphic: "events", MapPin: "places", HeadlineStack: "items", PhotoBurst: "items", EvidenceBoard: "items", CommentPile: "items",
};
/** Components that may hold longer than planned over a bare backdrop. */
const EXTEND_OK: ReadonlySet<OverlayComponentId> = new Set([...EARLY_OK, "KineticText", "NumberCounter"]);

/** A picture-track source that is only a backdrop (no subject of its own): a generated backdrop, or a procedural asset. */
export function isBareSource(src: { kind: string; recipe?: string; text?: string; procedural?: boolean }): boolean {
  if (src.procedural === true) return true;
  return src.kind === "generated" && !(src.recipe === "keywordCard" && (src.text ?? "").trim() !== "");
}

/** Overlays that count as foreground content over a backdrop (graphics band, plus self-contained picture items). */
export function isForeground(component: OverlayComponentId): boolean {
  const m = COMPONENT_META[component];
  return m.band === "graphics" || component === "SplitScreen" || component === "FreezeLabel";
}

export interface Stretch { from: number; end: number }

/**
 * Bare-backdrop stretches longer than `limit` frames: the frames of backdrop-only shots minus the spans of foreground
 * overlays. Works on any picture/overlay list (director shots, or a finished timeline's video/overlays).
 */
export function bareStretches(
  pics: readonly { from: number; end: number; bare: boolean }[], covers: readonly { from: number; end: number }[], limit: number,
): Stretch[] {
  const runs: Stretch[] = [];
  for (const p of pics) {
    if (!p.bare || p.end <= p.from) continue;
    const last = runs[runs.length - 1];
    if (last && last.end === p.from) last.end = p.end;
    else runs.push({ from: p.from, end: p.end });
  }
  const cs = covers.filter((c) => c.end > c.from).sort((a, b) => a.from - b.from);
  const out: Stretch[] = [];
  for (const r of runs) {
    let cur = r.from;
    for (const c of cs) {
      if (c.end <= cur || c.from >= r.end) continue;
      if (c.from > cur && c.from - cur > limit) out.push({ from: cur, end: c.from });
      cur = Math.max(cur, c.end);
      if (cur >= r.end) break;
    }
    if (cur < r.end && r.end - cur > limit) out.push({ from: cur, end: r.end });
  }
  return out;
}

function stretchesOf(ctx: Ctx, shots: readonly Shot[], st: OvState): Stretch[] {
  return bareStretches(
    shots.map((s) => ({ from: s.from, end: s.end, bare: isBareSource(s.src) })),
    st.items.filter((o) => !o.dropped && isForeground(o.component)).map((o) => ({ from: o.from, end: o.from + o.dur })),
    ctx.S(DEAD_AIR_MAX_SEC),
  );
}

/** Adds `d` to every relative sub-item time (`at`, `…At`) of overlay props. */
function shiftAts(v: unknown, d: number): unknown {
  if (Array.isArray(v)) return v.map((x) => shiftAts(x, d));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, (k === "at" || /At$/.test(k)) && typeof x === "number" ? x + d : shiftAts(x, d)]));
  }
  return v;
}

const live = (st: OvState) => st.items.filter((o) => !o.dropped && isForeground(o.component));
const beatOf = (ctx: Ctx, id: string | null) => (id ? ctx.beats.find((b) => b.id === id) : undefined);

/** 1. The card that ends the stretch enters at its start (bounded by its maxHold and its beat's first shot). */
function enterEarlier(ctx: Ctx, shots: readonly Shot[], st: OvState, g: Stretch): boolean {
  const o = live(st).find((x) => Math.abs(x.from - g.end) <= 1 && EARLY_OK.has(x.component));
  if (!o) return false;
  const maxHold = framesAt(ctx.fps, COMPONENT_META[o.component].maxHold30);
  const beatStart = shots.find((s) => s.beatId === o.beatId)?.from ?? o.from;
  const to = Math.max(g.from, o.from + o.dur - maxHold, beatStart);
  const d = o.from - to;
  if (d <= 0) return false;
  let props = shiftAts(o.props, d) as Record<string, unknown>;
  const key = LIST_KEY[o.component];
  const enter = framesAt(ctx.fps, COMPONENT_META[o.component].enter30);
  if (key && Array.isArray(props[key]) && (props[key] as { at?: number }[]).length > 0) { // the card never opens empty
    const items = (props[key] as { at: number }[]).map((x, k) => (k === 0 ? { ...x, at: Math.min(x.at, enter) } : x));
    props = { ...props, [key]: items };
  }
  o.props = props;
  o.from = to;
  o.dur += d;
  o.readHold += d;
  return true;
}

/** 2. The card that starts the stretch holds to its end (≤ maxHold, inside its chapter). */
function holdLonger(ctx: Ctx, st: OvState, g: Stretch): boolean {
  const o = live(st).find((x) => Math.abs(x.from + x.dur - g.from) <= 1 && EXTEND_OK.has(x.component));
  if (!o) return false;
  const ch = ctx.chapters.find((c) => c.from <= o.from && o.from < c.end);
  const end = Math.min(g.end, o.from + framesAt(ctx.fps, COMPONENT_META[o.component].maxHold30), ch ? ch.end : ctx.N);
  if (end <= o.from + o.dur) return false;
  o.dur = end - o.from;
  return true;
}

/** Cut moves that must stay (reveal flashes, structural cuts, chapter starts). */
const pinned = (ctx: Ctx, s: Shot) => s.explicitFlash || s.tsource === "structural" || s.tsource === "explicit" || ctx.chapters.some((c) => c.from === s.from);

/** 3/5. A real neighbour shot of the same chapter (same beat when `sameBeat`) holds over the stretch. */
function holdNeighbour(ctx: Ctx, shots: Shot[], g: Stretch, sameBeat: boolean): boolean {
  const minShot = ctx.P.shots.minShotFrames;
  const i = shots.findIndex((s) => s.from <= g.from && g.from < s.end);
  const j = shots.findIndex((s) => s.from < g.end && g.end <= s.end);
  if (i < 0 || j < 0) return false;
  const real = (s: Shot | undefined, ref: Shot): s is Shot => !!s && !isBareSource(s.src) && s.chapterId === ref.chapterId && s.role !== "montage" && (!sameBeat || s.beatId === ref.beatId);
  // leading stretch: the previous shot holds until the stretch ends
  const A = shots[i - 1], B = shots[i]!;
  if (g.from === B.from && real(A, B) && !pinned(ctx, B)) {
    if (g.end <= B.end - minShot && moveCut(ctx, shots, i, g.end)) return true;
    if (i === j && g.end === B.end && absorb(shots, i, i - 1)) return true;
  }
  // trailing stretch: the next shot starts where the stretch starts
  const C = shots[j]!, D = shots[j + 1];
  if (g.end === C.end && real(D, C) && !pinned(ctx, D)) {
    if (g.from >= C.from + minShot && moveCut(ctx, shots, j + 1, g.from)) return true;
    if (i === j && g.from === C.from && !pinned(ctx, C) && absorb(shots, j, j + 1)) return true;
  }
  return false;
}

/** Removes bare shot `k`; its neighbour `into` (adjacent) covers its frames. */
function absorb(shots: Shot[], k: number, into: number): boolean {
  const s = shots[k]!, t = shots[into]!;
  const d = s.end - s.from;
  if (t.src.kind === "video") {
    if (into > k ? t.src.sourceIn - d < 0 : t.src.mediaFrames !== null && t.src.sourceIn + (t.end - t.from) + d > t.src.mediaFrames) return false;
  }
  if (into > k) {
    t.from = s.from;
    if (t.src.kind === "video") t.src = { ...t.src, sourceIn: t.src.sourceIn - d };
    t.anchorWord = s.anchorWord;
    t.anchorOffset = s.anchorOffset;
    t.transition = s.transition; t.tkey = s.tkey; t.tsource = s.tsource;
  } else t.end = s.end;
  shots.splice(k, 1);
  return true;
}

const clean = (w: string) => w.replace(/^[«“"'(]+|[»”"'),.;:!?…]+$/gu, "");

/** Short phrase starting at word index `k` (same sentence): three words or more when the first ones are function words —
 *  "height of the mania", "started with a botanist", not a lone "height" — at most three content words and five words,
 *  trailing function words dropped. */
function phraseAt(ctx: Ctx, k: number, end: number): string | null {
  const ws: string[] = [];
  let content = 0;
  for (let i = k; i < end && ws.length < 5; i++) {
    const w = ctx.words[i]!;
    ws.push(clean(w.text));
    if (!isFunctionWord(clean(w.text), ctx.lang)) content++;
    if (/[.!?…;:]["»”]?$/.test(w.text) || content >= 3 || (content >= 2 && ws.length >= 3)) break;
  }
  const t = contentText(ws.join(" "), ctx.lang);
  return t && t.length <= 48 ? t : null;
}

/** Text for a fill card: the beat's emphasis words spoken in (or nearest) the stretch, else its on-screen text, else the narration. */
function fillText(ctx: Ctx, b: BeatCtx, g: Stretch): { text: string; emphasis: string[] } | null {
  const pad = ctx.F30(15);
  const emph = b.text.emphasisIdx.map((i) => b.wordStart + i).filter((k) => k < b.wordEnd && !isFunctionWord(ctx.words[k]!.text, ctx.lang));
  const near = (k: number) => Math.abs(ctx.words[k]!.from - (g.from + g.end) / 2);
  const inside = emph.filter((k) => ctx.words[k]!.from >= g.from - pad && ctx.words[k]!.from <= g.end).sort((a, c) => near(a) - near(c));
  for (const k of [...inside, ...[...emph].sort((a, c) => near(a) - near(c))]) {
    const t = phraseAt(ctx, k, b.wordEnd);
    if (t) return { text: t, emphasis: [clean(ctx.words[k]!.text)] };
  }
  const ost = contentText(b.text.onScreenText, ctx.lang);
  if (ost && ost.length <= 48) return { text: ost, emphasis: [] };
  for (let k = b.wordStart; k < b.wordEnd; k++) {
    const w = ctx.words[k]!;
    if (w.from < g.from - pad || w.from > g.end || isFunctionWord(w.text, ctx.lang) || clean(w.text).length < 4) continue;
    const t = phraseAt(ctx, k, b.wordEnd);
    if (t) return { text: t, emphasis: [clean(w.text)] };
  }
  return null;
}

/** 4/6. A KineticText of the beat's emphasis words over the stretch. */
function kineticFill(ctx: Ctx, shots: readonly Shot[], st: OvState, g: Stretch, strict: boolean): boolean {
  if (!policyOf(ctx, "KineticText")) return false;
  if (strict && !cooldownOk(ctx, st, "KineticText", g.from)) return false;
  const s = shots.find((x) => x.from <= g.from && g.from < x.end);
  const b = beatOf(ctx, s?.beatId ?? null) ?? ctx.beats.find((x) => x.from <= g.from && g.from < x.end);
  if (!b) return false;
  const t = fillText(ctx, b, g);
  if (!t) return false;
  const props = { lines: [truncate(t.text, 48)], emphasis: t.emphasis, align: "center" };
  const h = holdOf("KineticText", props, ctx.fps);
  const dur = Math.min(g.end - g.from, h.maxHold);
  if (dur < 1 || (strict && dur < Math.min(h.readHold, h.maxHold))) return false;
  const word = ctx.words.find((w) => Math.abs(w.from - g.from) <= ctx.F30(15));
  return addOv(ctx, st, {
    component: "KineticText", ref: b.id, beatId: b.id, from: g.from, dur, props, cls: CLS.fill, origin: "cue",
    anchorWord: word?.id ?? null, readHold: Math.min(h.readHold, dur),
  }) !== null;
}

/**
 * Fills every bare-backdrop stretch longer than DEAD_AIR_MAX_SEC. `shotsMayChange` allows the cut moves of fills 3 and
 * 5. Returns the number of fills and whether the picture track changed (cameras must then be re-assigned).
 */
export function fillDeadAir(ctx: Ctx, shots: Shot[], st: OvState, o: { shotsMayChange: boolean }): { fills: number; shotsChanged: boolean } {
  const skip = new Set<number>();
  let fills = 0, shotsChanged = false;
  for (let guard = 0; guard < 500; guard++) {
    const g = stretchesOf(ctx, shots, st).find((x) => !skip.has(x.from));
    if (!g) break;
    let ok = enterEarlier(ctx, shots, st, g) || holdLonger(ctx, st, g);
    if (!ok && o.shotsMayChange && holdNeighbour(ctx, shots, g, true)) { ok = true; shotsChanged = true; }
    if (!ok) ok = kineticFill(ctx, shots, st, g, true);
    if (!ok && o.shotsMayChange && holdNeighbour(ctx, shots, g, false)) { ok = true; shotsChanged = true; }
    if (!ok) ok = kineticFill(ctx, shots, st, g, false);
    if (ok) { fills++; continue; }
    skip.add(g.from);
    ctx.warn("DEAD_AIR", beatOf(ctx, shots.find((s) => s.from <= g.from && g.from < s.end)?.beatId ?? null)?.id ?? "global",
      `${((g.end - g.from) / ctx.fps).toFixed(1)} s of bare backdrop at ${(g.from / ctx.fps).toFixed(1)} s could not be filled`);
  }
  if (shotsChanged) numberShots(shots);
  return { fills, shotsChanged };
}
