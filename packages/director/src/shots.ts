// Step 2 — SHOTS (V1) (§9.3): ASL with aslMul, word-snapped cuts, camera-change shots, clip shots (+ hold shots),
// beat starts with cut lead, contiguity and min-length merges. Also the shot-level edits of steps 6 (reveal cut snap)
// and 11b (musicCue "hit" → nearest cut onto a downbeat).
import { COMPONENT_META, fnv1a32, ids, lerp, msToFrame, type ClipLayout, type LayoutParams, type OverlayComponentId, type VisualKind } from "@docmaker/core";
import { clamp, type BeatCtx, type Ctx, type Shot, type Src } from "./ctx";
import { montageShots } from "./montage";
import { nearestIn, type MusicPlan } from "./music";
import { readText } from "./overlays/hold";
import type { RevealInfo } from "./reveal";

const NO_CUT = { kind: "cut", accent: { type: "none" } } as const;

export function blankShot(o: Partial<Shot> & Pick<Shot, "chapterId" | "beatId" | "from" | "end" | "src" | "role">): Shot {
  return {
    id: "", change: false, layout: "cover", layoutParams: null, forcedCard: false, maxCamScale: 1.6, baseUpscale: 1, camera: null,
    treatment: "none", transition: NO_CUT, tkey: "cut", tsource: "none", explicitFlash: false, sourceLabel: null, snap: "none",
    anchorWord: null, anchorOffset: 0, zoomCut: false, ...o,
  };
}

const RECIPE: Partial<Record<VisualKind, Src["recipe"]>> = {
  text_card: "keywordCard", document_screenshot: "paper", social_post: "paper", motion_graphic: "gradientGrid", map: "gradientGrid",
};

export function generatedSrc(ctx: Ctx, b: BeatCtx | null, text: string, recipe?: Src["recipe"]): Src {
  const pal = ctx.tok.tokens.palette;
  const kw = b ? b.plan.visualQuery.split(/\s+/).filter((w) => w.length > 2).slice(0, 3).join(" ").toUpperCase() : "";
  const fallbackText = b ? (b.text.onScreenText || (ctx.lang === "en" ? kw : "") || b.ch.title) : text;
  return {
    kind: "generated", assetId: null, sourceIn: 0, crop: null, focal: { x: 0.5, y: 0.45 },
    recipe: recipe ?? (b ? RECIPE[b.plan.visualKind] ?? backdropRecipe(ctx) : backdropRecipe(ctx)),
    text: (text || fallbackText).slice(0, 120), palette: [pal.ink, pal.accent, pal.secondary], seed: fnv1a32(b ? b.id : text),
    width: null, height: null, mediaFrames: null, headHandle: 0, pickSlot: null, key: `gen:${b ? b.id : text}`,
  };
}

/** The theme/style backdrop as a generated recipe (blurSelf has no generated form → darkNoise). */
export function backdropRecipe(ctx: Ctx): "gradientGrid" | "paper" | "darkNoise" {
  const r = ctx.tok.theme?.backdropRecipe ?? ctx.tok.tokens.backdrop;
  return r === "blurSelf" ? "darkNoise" : r;
}

/** Visual sources of a beat: its picks by slot (planKey-checked in ctx), else one generated backdrop. */
export function sourcesFor(ctx: Ctx, b: BeatCtx): Src[] {
  const picks = ctx.picksByBeat.get(b.id) ?? [];
  const out: Src[] = [];
  for (const p of picks) {
    const a = ctx.frozen[p.assetId]!;
    const cw = a.width ?? 1920, chh = a.height ?? 1080;
    const w = p.crop ? Math.max(1, Math.round(cw * p.crop.w)) : cw;
    const h = p.crop ? Math.max(1, Math.round(chh * p.crop.h)) : chh;
    out.push({
      kind: a.kind === "video" ? "video" : "image", assetId: a.id,
      sourceIn: a.kind === "video" ? msToFrame(p.sourceInMs ?? a.conform.handleHeadMs, ctx.fps) : 0,
      crop: p.crop, focal: p.focal, recipe: "darkNoise", text: "", palette: [], seed: 0, width: w, height: h,
      mediaFrames: a.kind === "video" && a.durationMs !== null ? msToFrame(a.durationMs, ctx.fps) : null,
      headHandle: msToFrame(a.conform.handleHeadMs, ctx.fps), pickSlot: p.slot, key: `${a.id}:${p.slot}`,
    });
  }
  if (out.length === 0) out.push(generatedSrc(ctx, b, ""));
  return out;
}

/** ASL (seconds) of a beat (§9.3 step 2). */
export function aslOf(ctx: Ctx, b: BeatCtx): number {
  const s = ctx.P.shots;
  let asl = s.targetAslSec * (b.hook ? s.hookAslFactor : 1) * (s.aslMul.byEnergy[clamp(b.energy, 1, 5) - 1] ?? 1);
  for (const c of [...b.cueTypes].sort()) asl *= s.aslMul.byCue[c] ?? 1;
  asl *= s.aslMul.byAct[b.act] ?? 1;
  asl *= 0.8 + 0.4 * ctx.R(`asl:${b.id}`)();
  return clamp(asl, s.aslSec[0] * 0.5, s.aslMaxSec);
}

function videoAvail(src: Src, sourceIn: number): number {
  return src.mediaFrames === null ? Number.POSITIVE_INFINITY : src.mediaFrames - sourceIn;
}

function normalShots(ctx: Ctx, b: BeatCtx, bs: number, be: number): Shot[] {
  const minShot = ctx.P.shots.minShotFrames;
  const cutLead = ctx.P.shots.cutLeadFrames;
  const dur = be - bs;
  const asl = aslOf(ctx, b);
  const n = Math.max(1, Math.round(dur / ctx.S(asl)));
  const words = ctx.words.slice(b.wordStart, b.wordEnd);
  const cuts: { f: number; word: string | null }[] = [];
  for (let k = 1; k < n; k++) {
    const ideal = bs + (k * dur) / n;
    let best: { f: number; word: string | null } | null = null;
    for (const w of words) {
      const f = w.from - cutLead;
      if (Math.abs(f - ideal) <= ctx.S(0.6) && (!best || Math.abs(f - ideal) < Math.abs(best.f - ideal))) best = { f, word: w.id };
    }
    cuts.push(best ?? { f: Math.round(ideal), word: null });
  }
  const kept: { f: number; word: string | null }[] = [];
  let last = bs;
  for (const c of cuts.sort((a, b2) => a.f - b2.f)) {
    if (c.f - last >= minShot && be - c.f >= minShot) { kept.push(c); last = c.f; }
  }
  const srcs = sourcesFor(ctx, b);
  // same-picture camera-change cuts (shot k ≥ number of sources) read as a formulaic "wide → punch" when every beat has
  // them: below energy 4 they are kept only on a cue / emphasis word, or where the merged shot would outlast the
  // visual-change limit; otherwise the picture holds with a Ken Burns move instead
  const cueWords = new Set<string>();
  b.cues.forEach((_, k) => { const a = b.text.cueAnchorIdx[k] ?? -1; if (a >= 0 && b.wordStart + a < b.wordEnd) cueWords.add(ctx.words[b.wordStart + a]!.id); });
  for (const i of b.text.emphasisIdx) if (b.wordStart + i < b.wordEnd) cueWords.add(ctx.words[b.wordStart + i]!.id);
  const vcMax = ctx.S(ctx.P.shots.visualChangeSec[1]);
  const gated: { f: number; word: string | null }[] = [];
  for (let j = 0; j < kept.length; j++) {
    const c = kept[j]!;
    const changeCut = gated.length + 1 >= srcs.length;
    if (changeCut && b.energy < 4 && !(c.word && cueWords.has(c.word))) {
      const prev = gated.length ? gated[gated.length - 1]!.f : bs;
      const next = kept[j + 1]?.f ?? be;
      if (next - prev <= vcMax) continue;
    }
    gated.push(c);
  }
  kept.splice(0, kept.length, ...gated);
  const cursor = new Map<string, number>(); // video source → next media frame
  const shots: Shot[] = [];
  const bounds = [{ f: bs, word: null as string | null }, ...kept, { f: be, word: null }];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const base = srcs[k % srcs.length]!;
    const src: Src = { ...base };
    if (src.kind === "video") src.sourceIn = cursor.get(base.key) ?? base.sourceIn;
    const s = blankShot({ chapterId: b.ch.id, beatId: b.id, from: bounds[k]!.f, end: bounds[k + 1]!.f, src, role: "normal", change: k >= srcs.length });
    if (bounds[k]!.word) { s.anchorWord = bounds[k]!.word; s.anchorOffset = -cutLead; }
    if (src.kind === "video") cursor.set(base.key, src.sourceIn + (s.end - s.from));
    shots.push(s);
  }
  // video shots longer than their media: split; the remainder takes the next source or restarts the video at its head handle
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i]!;
    if (s.src.kind !== "video") continue;
    const avail = videoAvail(s.src, s.src.sourceIn);
    if (s.end - s.from <= avail) continue;
    let cut = s.from + Math.max(0, avail);
    if (cut - s.from < minShot) cut = s.from; // nothing usable: replace the whole shot
    // the remainder takes another source of the beat, else a cutaway borrowed from a neighbouring beat of the chapter;
    // replaying the video from its head (a visible loop) is the last resort
    const need = s.end - s.from - Math.max(0, avail);
    const at = (x: Src): Src => ({ ...x, sourceIn: x.kind === "video" ? cursor.get(x.key) ?? x.sourceIn : x.sourceIn });
    const other = srcs.map(at).find((x) => x.key !== s.src.key && (x.kind !== "video" || videoAvail(x, x.sourceIn) >= need))
      ?? srcs.find((x) => x.key !== s.src.key)
      ?? borrowedSource(ctx, b, s.src.key, need, cursor);
    const restart: Src = other ? at(other) : { ...s.src, sourceIn: s.src.headHandle };
    if (cut === s.from) {
      s.src = restart;
      if (restart.kind === "video") cursor.set(restart.key, restart.sourceIn + (s.end - s.from));
      s.change = s.change || !other;
      continue;
    }
    if (s.end - cut < minShot) cut = s.end - minShot;
    if (cut - s.from < minShot) { s.src = restart; if (restart.kind === "video") cursor.set(restart.key, restart.sourceIn + (s.end - s.from)); continue; }
    const rest = blankShot({ chapterId: s.chapterId, beatId: s.beatId, from: cut, end: s.end, src: restart, role: "normal", change: !other });
    if (restart.kind === "video") cursor.set(restart.key, restart.sourceIn + (s.end - cut));
    s.end = cut;
    shots.splice(i + 1, 0, rest);
  }
  return shots;
}

/** A cutaway for a beat whose only video runs out: the nearest other beat of the chapter with a still (or a video with
 *  `need` frames of media), its first such pick. */
function borrowedSource(ctx: Ctx, b: BeatCtx, exceptKey: string, need: number, cursor: ReadonlyMap<string, number>): Src | undefined {
  const others = b.ch.beats
    .filter((x) => x.id !== b.id && (ctx.picksByBeat.get(x.id) ?? []).length > 0)
    .sort((x, y) => Math.abs(x.idx - b.idx) - Math.abs(y.idx - b.idx) || x.idx - y.idx);
  for (const o of others) {
    const src = sourcesFor(ctx, o).find((x) => x.key !== exceptKey && x.assetId !== null && (x.kind === "image" || videoAvail(x, cursor.get(x.key) ?? x.sourceIn) >= need));
    if (src) return src;
  }
  return undefined;
}

/** Clip beat in mode "clip": the passage (with head/tail handles), pip → cover switch, hold shot when media runs out. */
function clipShots(ctx: Ctx, b: BeatCtx, bs: number, be: number): Shot[] {
  const clip = ctx.clipBySeg.get(b.seg.segmentId);
  const asset = clip?.assetId ? ctx.frozen[clip.assetId] : undefined;
  const quote = b.sseg?.displayText ?? "";
  const hold = (from: number, end: number) =>
    blankShot({ chapterId: b.ch.id, beatId: b.id, from, end, src: generatedSrc(ctx, null, quote, backdropRecipe(ctx)), role: "hold" });
  if (!clip || !asset || clip.passageInMs === null || asset.durationMs === null) return [hold(bs, be)];
  const S0 = msToFrame(clip.passageInMs, ctx.fps);
  const media = msToFrame(asset.durationMs, ctx.fps);
  const P0 = b.seg.from;
  const jReserve = ctx.F30(12);
  const lReserve = ctx.F30(9);
  const out: Shot[] = [];
  let start = bs;
  let srcIn = S0 - (P0 - bs);
  if (srcIn < jReserve) { // not enough head handle before the passage: hold until the passage starts
    if (P0 > bs) out.push(hold(bs, P0));
    start = Math.max(bs, P0);
    srcIn = S0 - (P0 - start);
  }
  const maxEnd = start + (media - srcIn - lReserve);
  const clipEnd = Math.min(be, maxEnd);
  if (clipEnd - start < 1) {
    if (out.length === 0) return [hold(bs, be)];
    out[out.length - 1]!.end = be;
    return out;
  }
  const src: Src = {
    kind: "video", assetId: asset.id, sourceIn: srcIn, crop: null, focal: { x: 0.5, y: 0.45 }, recipe: "darkNoise", text: "", palette: [], seed: 0,
    width: asset.width, height: asset.height, mediaFrames: media, headHandle: msToFrame(asset.conform.handleHeadMs, ctx.fps), pickSlot: null, key: `clip:${asset.id}`,
  };
  const year = (clip.youtube?.publishedAt ?? "").slice(0, 4);
  const channel = clip.youtube?.channel ?? sourceNameOfQuote(ctx, clip.quoteId);
  const label = channel ? `Source: ${channel}${/^\d{4}$/.test(year) ? `, ${year}` : ""}`.slice(0, 80) : null;
  const pieces: [number, number][] = [[start, clipEnd]];
  const style = ctx.style.clipLayout;
  if ((clipEnd - start) / ctx.fps > ctx.P.clip.switchLayoutAfterSec && style !== "cover") {
    const split = clipSentenceSplit(ctx, b, start, clipEnd, srcIn);
    if (split !== null) pieces.splice(0, 1, [start, split], [split, clipEnd]);
  }
  pieces.forEach(([f, e], k) => {
    const layout: ClipLayout = pieces.length > 1 && k === 1 ? "cover" : style;
    out.push(blankShot({
      chapterId: b.ch.id, beatId: b.id, from: f, end: e, src: { ...src, sourceIn: srcIn + (f - start) }, role: "clip", change: k > 0,
      layout, layoutParams: layout === "pip" ? pipParams(ctx, b) : null, sourceLabel: label,
    }));
  });
  if (be > clipEnd) out.push(hold(clipEnd, be));
  return out;
}

function sourceNameOfQuote(ctx: Ctx, quoteId: string): string {
  const q = ctx.facts.quotes.find((x) => x.id === quoteId);
  const s = q ? ctx.facts.sources.find((x) => x.id === q.sourceId) : undefined;
  return s?.publisher ?? "";
}

/** Clip-word sentence boundary nearest the middle of [from, end) (program frame of the next sentence's first word). */
function clipSentenceSplit(ctx: Ctx, b: BeatCtx, from: number, end: number, srcIn: number): number | null {
  const minShot = ctx.P.shots.minShotFrames;
  const words = ctx.I.clipWords[b.seg.segmentId] ?? [];
  const toProgram = (ms: number) => from + (msToFrame(ms, ctx.fps) - srcIn);
  const mid = (from + end) / 2;
  let best: number | null = null;
  for (let k = 0; k + 1 < words.length; k++) {
    const w = words[k]!, nx = words[k + 1]!;
    const boundary = /[.?!…]["»”]?$/.test(w.text.trim()) || nx.startMs - w.endMs >= 300;
    if (!boundary) continue;
    const f = toProgram(nx.startMs) - ctx.P.shots.cutLeadFrames;
    if (f - from < minShot || end - f < minShot) continue;
    if (best === null || Math.abs(f - mid) < Math.abs(best - mid)) best = f;
  }
  if (best !== null) return best;
  const m = Math.round(mid);
  return m - from >= minShot && end - m >= minShot ? m : null;
}

export function pipParams(ctx: Ctx, b: BeatCtx): LayoutParams {
  const r = ctx.R(`pip:${b.id}`);
  return {
    backdrop: "blurSelf", heightFrac: 0.76, borderPx: 0, tiltDeg: Math.round((r() < 0.5 ? -1 : 1) * lerp([1, 2], r()) * 100) / 100,
    shadow: true, stroke: ctx.tok.theme?.accent ?? ctx.tok.tokens.palette.accent, entry: "scale", backdropSeed: fnv1a32(b.id),
  };
}

function hasOnset(b: BeatCtx): boolean {
  return b.wordEnd > b.wordStart && b.seg.mode === "vo";
}

export function buildShots(ctx: Ctx, music: MusicPlan): Shot[] {
  const minShot = ctx.P.shots.minShotFrames;
  const cutLead = ctx.P.shots.cutLeadFrames;
  const shots: Shot[] = [];
  for (const ch of ctx.chapters) {
    const chShots: Shot[] = [];
    if (ch.beats.length === 0) {
      chShots.push(blankShot({ chapterId: ch.id, beatId: null, from: ch.from, end: ch.end, src: generatedSrc(ctx, null, ch.title, backdropRecipe(ctx)), role: "hold" }));
    }
    for (let k = 0; k < ch.beats.length; k++) {
      const b = ch.beats[k]!;
      const prev = chShots[chShots.length - 1];
      const want = k === 0 ? ch.from : hasOnset(b) ? b.onset - cutLead : b.from;
      const bs = prev ? Math.max(prev.from + minShot, want) : ch.from;
      const nb = ch.beats[k + 1];
      const be = Math.min(ch.end, nb ? (hasOnset(nb) ? nb.onset - cutLead : nb.from) : ch.end);
      if (be - bs < 1) continue; // swallowed by the previous shot
      if (prev) prev.end = bs;
      const made = b.isClip && b.seg.mode === "clip" ? clipShots(ctx, b, bs, be)
        : b.montage ? montageShots(ctx, b, bs, be, music)
        : normalShots(ctx, b, bs, be);
      chShots.push(...made);
    }
    if (chShots.length) {
      chShots[0]!.from = ch.from;
      chShots[chShots.length - 1]!.end = ch.end;
    }
    mergeShort(chShots, minShot);
    shots.push(...chShots);
  }
  // contiguity over the whole program
  for (let i = 0; i + 1 < shots.length; i++) shots[i]!.end = shots[i + 1]!.from;
  if (shots.length) { shots[0]!.from = 0; shots[shots.length - 1]!.end = ctx.N; }
  numberShots(shots);
  return shots;
}

/** Can shot `t` grow by `d` frames on its left (true) or right (false) side? */
function canGrow(t: Shot, d: number, left: boolean): boolean {
  if (t.role === "montage") return false;
  if (t.src.kind !== "video") return true;
  if (left) return t.src.sourceIn - d >= 0;
  return t.src.mediaFrames === null || t.src.sourceIn + (t.end - t.from) + d <= t.src.mediaFrames;
}

/** Merges shots shorter than minShot into the longer neighbour that can absorb them (never across chapters). */
function mergeShort(shots: Shot[], minShot: number): void {
  const stuck = new Set<Shot>();
  for (let guard = 0; guard < 10_000 && shots.length > 1; guard++) {
    const i = shots.findIndex((s) => s.end - s.from < minShot && s.role !== "montage" && !stuck.has(s));
    if (i < 0) return;
    const s = shots[i]!;
    const d = s.end - s.from;
    const L = shots[i - 1], R = shots[i + 1];
    const opts = [L ? { t: L, left: false } : null, R ? { t: R, left: true } : null]
      .filter((x): x is { t: Shot; left: boolean } => x !== null && canGrow(x.t, d, x.left))
      .sort((a, b) => (b.t.end - b.t.from) - (a.t.end - a.t.from));
    const o = opts[0];
    if (!o) { stuck.add(s); continue; } // a short shot is better than a broken media range
    if (o.left) {
      o.t.from = s.from;
      if (o.t.src.kind === "video") o.t.src = { ...o.t.src, sourceIn: o.t.src.sourceIn - d };
      o.t.anchorWord = s.anchorWord;
      o.t.anchorOffset = s.anchorOffset;
    } else o.t.end = s.end;
    shots.splice(i, 1);
  }
}

/** Positional ids v:<beatId>:<n> (chapter id for beat-less chapters). */
export function numberShots(shots: Shot[]): void {
  const n = new Map<string, number>();
  for (const s of shots) {
    const ref = s.beatId ?? s.chapterId;
    const k = n.get(ref) ?? 0;
    s.id = ids.shot(ref, k);
    n.set(ref, k + 1);
  }
}

/** Moves a shot boundary to `to` when both sides keep ≥ minShot frames and media ranges stay valid. */
export function moveCut(ctx: Ctx, shots: Shot[], i: number, to: number): boolean {
  const A = shots[i - 1], B = shots[i];
  if (!A || !B || A.chapterId !== B.chapterId) return false;
  const minShot = B.role === "montage" || A.role === "montage" ? ctx.F30(10) : ctx.P.shots.minShotFrames;
  if (to - A.from < minShot || B.end - to < minShot) return false;
  const d = to - B.from;
  if (d === 0) return true;
  if (d > 0 ? !canGrow(A, d, false) : !canGrow(B, -d, true)) return false;
  A.end = to;
  if (B.src.kind === "video") B.src = { ...B.src, sourceIn: B.src.sourceIn + d };
  B.from = to;
  return true;
}

/** §9.3 step 6: a cut within ±F30(6) of the reveal word moves onto it and carries the explicit flash. */
export function snapRevealCuts(ctx: Ctx, shots: Shot[], reveals: readonly RevealInfo[]): Set<string> {
  const snapped = new Set<string>();
  for (const r of reveals) {
    let best = -1;
    for (let i = 1; i < shots.length; i++) {
      const d = Math.abs(shots[i]!.from - r.a);
      if (d <= ctx.F30(6) && (best < 0 || d < Math.abs(shots[best]!.from - r.a))) best = i;
    }
    if (best < 0) continue;
    if (shots[best]!.from === ctx.chapters.find((c) => c.id === r.chapterId)?.from) continue;
    if (moveCut(ctx, shots, best, r.a)) {
      const s = shots[best]!;
      s.explicitFlash = true; // flash cut on the reveal word (explicit when the per-minute budget allowed it)
      s.anchorWord = r.wordId;
      s.anchorOffset = 0;
      snapped.add(r.beat.id);
    }
  }
  return snapped;
}

/** §9.3 step 11b musicCue "hit": the beat's cut moves onto the closest downbeat within ±F30(3). Returns the hit frames. */
export function applyHits(ctx: Ctx, shots: Shot[], music: MusicPlan): { beatId: string; frame: number }[] {
  const out: { beatId: string; frame: number }[] = [];
  for (const b of ctx.beats) {
    if (b.plan.musicCue !== "hit") continue;
    const i = shots.findIndex((s) => s.beatId === b.id);
    if (i <= 0) { out.push({ beatId: b.id, frame: b.onset }); continue; }
    const s = shots[i]!;
    const db = nearestIn(music.downbeats, s.from, ctx.F30(3));
    if (db !== null && s.from !== ctx.chapters.find((c) => c.id === s.chapterId)?.from && moveCut(ctx, shots, i, db)) {
      s.anchorWord = null;
      out.push({ beatId: b.id, frame: db });
    } else out.push({ beatId: b.id, frame: s.from });
  }
  return out;
}

/**
 * A keywordCard backdrop draws the beat's on-screen text as a full-width headline; a text overlay (KineticText and other
 * centred, non-full-frame text graphics) on top of it would draw the same words twice. Such shots get the textless
 * dark base instead (the overlay carries the words). Returns the ids of the shots changed.
 */
export function textlessUnderText(shots: Shot[], overlays: readonly { component: OverlayComponentId; from: number; dur: number; zone: string; props: Record<string, unknown>; dropped: boolean }[]): string[] {
  const out: string[] = [];
  const texty = overlays.filter((o) => !o.dropped && isCentredText(o.component, o.zone, o.props));
  for (const s of shots) {
    if (s.src.kind !== "generated" || s.src.recipe !== "keywordCard" || !s.src.text) continue;
    if (!texty.some((o) => o.from < s.end && s.from < o.from + o.dur)) continue;
    s.src = { ...s.src, recipe: "darkNoise", text: "" };
    out.push(s.id);
  }
  return out;
}

/** Centred text graphics that would collide with a keywordCard headline. */
export function isCentredText(component: OverlayComponentId, zone: string, props: Record<string, unknown>): boolean {
  const m = COMPONENT_META[component];
  if (m.band !== "graphics" || m.fullFrame || (zone !== "center" && zone !== "full")) return false;
  return readText(component, props).some((t) => t.trim().length > 0);
}