// Step 0 (SETUP) of §9.3: the read-only context every pass works with, plus small shared helpers.
import {
  buildAnchorIndex, framesAt, rngFor, secToFrames, tokenizeDisplay,
  type Anchor, type AnchorIndex, type AssetPick, type BeatLang, type BeatPlan, type CameraMove, type ChapterPlan, type ClipLayout,
  type ClipResolution, type CueTag, type CueType, type FactSheet, type FrozenAsset, type LayoutBeat, type LayoutParams, type LayoutSegment,
  type LayoutWord, type LintIssue, type MacroAct, type NormPoint, type NormRect, type OverlayComponentId, type ProgramLayout,
  type ScriptSegment, type StoryShape, type StyleData, type StyleRenderTokens, type Transition, type TransitionKey, type ZoneName,
  type Outline,
} from "@docmaker/core";
import type { DirectorInput } from "./types";

export interface ChapterCtx {
  id: string; idx: number; title: string; act: string; macro: MacroAct; from: number; end: number; firstWordFrame: number | null;
  beats: BeatCtx[]; titleSting: boolean; cardIndex: number; plan: ChapterPlan | null;
}

export interface BeatCtx {
  id: string; idx: number; plan: BeatPlan; text: BeatLang; lb: LayoutBeat; seg: LayoutSegment; sseg: ScriptSegment | null;
  ch: ChapterCtx; act: string; macro: MacroAct; intensity: number; hook: boolean; energy: number;
  from: number; end: number; onset: number; wordStart: number; wordEnd: number;
  cues: CueTag[]; cueTypes: Set<CueType>; firstOfChapter: boolean; isClip: boolean; isBreath: boolean; montage: boolean;
}

/** Shot source (picture track) before it becomes a VisualSource. */
export interface Src {
  kind: "image" | "video" | "generated";
  assetId: string | null;
  sourceIn: number; // video: media frame shown at the shot's `from`
  crop: NormRect | null; focal: NormPoint;
  recipe: "gradientGrid" | "paper" | "darkNoise" | "keywordCard"; text: string; palette: string[]; seed: number;
  width: number | null; height: number | null; mediaFrames: number | null; headHandle: number;
  pickSlot: number | null; key: string; // identity of the source within the beat (camera-change detection)
  procedural?: boolean; // a procedural fallback asset: a backdrop with no subject (bare for the dead-air rule)
}

export type ShotRole = "normal" | "clip" | "hold" | "montage";
export type TSource = "none" | "structural" | "explicit" | "cue" | "intent" | "quota" | "montage";

export interface Shot {
  id: string; beatId: string | null; chapterId: string; from: number; end: number; src: Src; role: ShotRole;
  change: boolean; // camera-change shot of the previous shot's source (reframe or layout flip)
  layout: ClipLayout; layoutParams: LayoutParams | null; forcedCard: boolean; maxCamScale: number; baseUpscale: number;
  camera: CameraMove | null; treatment: "none" | "bw" | "archival" | "duotone";
  transition: Transition; tkey: TransitionKey; tsource: TSource; explicitFlash: boolean;
  sourceLabel: string | null; snap: "none" | "beat" | "downbeat"; anchorWord: string | null; anchorOffset: number;
  zoomCut: boolean; // fill: the cut into this shot reads as a punch (tight reframe of the same asset)
}

export interface Ctx {
  I: DirectorInput; fps: number; N: number; seed: number; lang: "en" | "fr";
  R: (key: string) => () => number; F30: (f: number) => number; S: (sec: number) => number;
  layout: ProgramLayout; ix: AnchorIndex; style: StyleData; tok: StyleRenderTokens; shape: StoryShape;
  P: StyleData["cameraPolicy"]; T: StyleData["transitionPolicy"]; St: StyleData["stills"]; M: StyleData["musicPolicy"];
  X: StyleData["sfxPolicy"]; Bu: StyleData["budgets"];
  chapters: ChapterCtx[]; beats: BeatCtx[]; beatById: Map<string, BeatCtx>; words: LayoutWord[]; wordIndex: Map<string, number>;
  segById: Map<string, LayoutSegment>; scriptSegById: Map<string, ScriptSegment>; frozen: Record<string, FrozenAsset>;
  picksByBeat: Map<string, AssetPick[]>; portraitOf: Map<string, string>; clipBySeg: Map<string, ClipResolution>;
  facts: FactSheet; coldOpen: boolean; outline: Outline | null;
  issues: LintIssue[];
  warn: (rule: string, where: string, msg: string) => void;
  /** Frames of accepted explicit flashes (≤ explicitPerMin per 60 s across reveals and cue flashes). */
  explicitFlashes: number[];
}

const isAct = (shape: StoryShape, act: string) => shape.acts.some((a) => a.id === act);

/** The story shape whose acts cover the layout's chapters best (the project shape is not a direct input). */
function shapeFor(style: StyleData, acts: string[], outline: Outline | null): StoryShape {
  const prof = style.scriptProfile;
  if (outline) {
    const s = prof.storyShapes.find((x) => x.id === outline.storyShape);
    if (s) return s;
  }
  let best = prof.storyShapes.find((s) => s.id === prof.defaultShape) ?? prof.storyShapes[0]!;
  let bestScore = acts.filter((a) => isAct(best, a)).length;
  for (const s of prof.storyShapes) {
    const sc = acts.filter((a) => isAct(s, a)).length;
    if (sc > bestScore) { best = s; bestScore = sc; }
  }
  return best;
}

const NEUTRAL_PLAN = (lb: LayoutBeat): BeatPlan => ({
  id: lb.beatId, chapterId: lb.chapterId, segmentId: lb.segmentId, order: 0, origin: "fallback", purpose: "context", energy: 3,
  estSeconds: 3, visualKind: "stock_broll", visualQuery: "", personIds: [], quoteId: null, youtubeQuoteToFind: "", motionTemplate: "none",
  camera: "ken_burns", transitionIn: "cut", sfx: [], musicCue: "none", musicMood: "none", factIds: [], cueTags: [], planKey: "0000000000000000",
});

export function buildCtx(I: DirectorInput): Ctx {
  const layout = I.layout;
  const fps = layout.fps;
  const N = layout.durationInFrames;
  const style = I.style;
  const issues: LintIssue[] = [];
  const warn = (rule: string, where: string, msg: string) => { issues.push({ level: "warn", rule, where, msg }); };
  const outline = I.outline ?? null;
  const shape = shapeFor(style, layout.chapters.map((c) => c.act), outline);
  const planById = new Map(I.plans.map((p) => [p.id, p]));
  const textById = new Map(I.texts.map((t) => [t.beatId, t]));
  const segById = new Map(layout.segments.map((s) => [s.segmentId, s]));
  const scriptSegById = new Map<string, ScriptSegment>();
  for (const ch of I.script.chapters) for (const s of ch.segments) scriptSegById.set(s.id, s);
  const wordIndex = new Map(layout.words.map((w, k) => [w.id, k]));
  const outlineCh = new Map((outline?.chapters ?? []).map((c) => [c.id, c]));

  // CH1 is the cold open when its act is the shape's first act (or when CH1 is not in this program: by convention).
  const ch1 = layout.chapters.find((c) => c.chapterId === "CH1");
  const coldOpen = ch1 ? ch1.act === shape.acts[0]!.id : true;
  const firstIsShapeFirst = layout.chapters[0] ? layout.chapters[0].act === shape.acts[0]!.id : false;

  const chapters: ChapterCtx[] = layout.chapters.map((c, ci) => {
    const num = Number(c.chapterId.slice(2));
    return {
      id: c.chapterId, idx: ci, title: c.title, act: c.act, macro: c.macroAct, from: c.from, end: c.from + c.dur, firstWordFrame: c.firstWordFrame,
      beats: [], titleSting: ci === 1 && style.budgets.titleSting && firstIsShapeFirst,
      cardIndex: Math.max(1, coldOpen ? num - 1 : num), plan: outlineCh.get(c.chapterId) ?? null,
    };
  });
  const chById = new Map(chapters.map((c) => [c.id, c]));

  const beats: BeatCtx[] = [];
  for (const lb of layout.beats) {
    const ch = chById.get(lb.chapterId);
    const seg = segById.get(lb.segmentId);
    if (!ch || !seg) continue;
    let plan = planById.get(lb.beatId);
    if (!plan) { warn("BEAT_PLAN_MISSING", lb.beatId, "no beat plan for a layout beat; using a neutral plan"); plan = NEUTRAL_PLAN(lb); }
    const text = textById.get(lb.beatId) ?? { beatId: lb.beatId, lang: I.lang, text: "", onScreenText: "", cueAnchorIdx: plan.cueTags.map(() => -1), emphasisIdx: [], motionData: {} };
    const isClip = lb.beatId.endsWith("-CLIP");
    const isBreath = lb.beatId.endsWith("-BR");
    const cueTypes = new Set(plan.cueTags.map((c) => c.type));
    const b: BeatCtx = {
      id: lb.beatId, idx: beats.length, plan, text, lb, seg, sseg: scriptSegById.get(lb.segmentId) ?? null, ch, act: ch.act, macro: ch.macro,
      intensity: style.budgets.actIntensity[ch.act] ?? 1, hook: ch.act === shape.acts[0]!.id, energy: plan.energy,
      from: lb.from, end: lb.from + lb.dur, onset: lb.onsetFrame, wordStart: lb.wordStart, wordEnd: lb.wordEnd,
      cues: plan.cueTags, cueTypes, firstOfChapter: ch.beats.length === 0, isClip, isBreath,
      montage: isBreath || (cueTypes.has("MONTAGE") && seg.mode === "vo"),
    };
    ch.beats.push(b);
    beats.push(b);
  }

  const picksByBeat = new Map<string, AssetPick[]>();
  for (const p of [...I.picks.picks].sort((a, b) => (a.beatId < b.beatId ? -1 : a.beatId > b.beatId ? 1 : a.slot - b.slot))) {
    const plan = planById.get(p.beatId);
    if (!plan || p.planKey !== plan.planKey) continue; // orphaned picks are never applied
    const a = I.frozen[p.assetId];
    if (!a || (a.kind !== "image" && a.kind !== "video")) { warn("PICK_ASSET", p.beatId, `pick slot ${p.slot}: asset not frozen or not visual`); continue; }
    const arr = picksByBeat.get(p.beatId) ?? [];
    if (!arr.some((x) => x.slot === p.slot)) arr.push(p);
    picksByBeat.set(p.beatId, arr);
  }
  const portraitOf = new Map<string, string>();
  for (const pt of I.picks.portraits) if (I.frozen[pt.assetId]) portraitOf.set(pt.personId, pt.assetId);

  return {
    I, fps, N, seed: I.project.seed, lang: I.lang,
    R: (key: string) => rngFor(I.project.seed, key), F30: (f: number) => framesAt(fps, f), S: (sec: number) => secToFrames(sec, fps),
    layout, ix: buildAnchorIndex(layout, I.layoutHash), style, tok: I.renderTokens, shape,
    P: style.cameraPolicy, T: style.transitionPolicy, St: style.stills, M: style.musicPolicy, X: style.sfxPolicy, Bu: style.budgets,
    chapters, beats, beatById: new Map(beats.map((b) => [b.id, b])), words: layout.words, wordIndex, segById, scriptSegById,
    frozen: I.frozen, picksByBeat, portraitOf, clipBySeg: new Map(I.picks.clips.map((c) => [c.segmentId, c])),
    facts: I.facts, coldOpen, outline, issues, warn, explicitFlashes: [],
  };
}

// ------------------------------------------------------------------------------------------------ helpers
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
export const round3 = (x: number) => Math.round(x * 1000) / 1000;
export const round2 = (x: number) => Math.round(x * 100) / 100;

/** Frame of cue k of beat b (§9.3 step 0). */
export function cueFrame(ctx: Ctx, b: BeatCtx, k: number): number {
  const a = b.text.cueAnchorIdx[k] ?? -1;
  if (a < 0) return b.onset;
  const gi = b.wordStart + a;
  if (gi >= b.wordEnd || gi >= ctx.words.length) return b.onset;
  return ctx.words[gi]!.from;
}
/** Layout word a cue lands on (null for beat-start cues or clip/breath beats). */
export function cueWord(ctx: Ctx, b: BeatCtx, k: number): LayoutWord | null {
  const a = b.text.cueAnchorIdx[k] ?? -1;
  if (a < 0) return b.wordEnd > b.wordStart ? ctx.words[b.wordStart]! : null;
  const gi = b.wordStart + a;
  return gi < b.wordEnd ? ctx.words[gi] ?? null : null;
}
export const beatWords = (ctx: Ctx, b: BeatCtx): LayoutWord[] => ctx.words.slice(b.wordStart, b.wordEnd);

/** Index of the last word whose onset ≤ f (−1 if none). */
export function wordIdxAtOrBefore(ctx: Ctx, f: number): number {
  let lo = 0, hi = ctx.words.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.words[mid]!.from <= f) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
/** First word onset ≥ f within (f, f + maxDelta]; null if none. */
export function nextWordOnset(ctx: Ctx, f: number, maxDelta: number, strict = true): LayoutWord | null {
  const k = wordIdxAtOrBefore(ctx, strict ? f : f - 1) + 1;
  const w = ctx.words[k];
  return w && w.from - f <= maxDelta && (strict ? w.from > f : w.from >= f) ? w : null;
}
export function beatAt(ctx: Ctx, f: number): BeatCtx | null {
  let lo = 0, hi = ctx.beats.length - 1, ans: BeatCtx | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ctx.beats[mid]!.from <= f) { ans = ctx.beats[mid]!; lo = mid + 1; } else hi = mid - 1;
  }
  return ans && f < ans.end ? ans : null;
}
export function chapterAt(ctx: Ctx, f: number): ChapterCtx {
  let ans = ctx.chapters[0]!;
  for (const c of ctx.chapters) if (c.from <= f) ans = c;
  return ans;
}
export const intensityAt = (ctx: Ctx, f: number) => ctx.Bu.actIntensity[chapterAt(ctx, f).act] ?? 1;

/** Shot index containing f (shots sorted, contiguous). */
export function shotIdxAt(shots: readonly Shot[], f: number): number {
  let lo = 0, hi = shots.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (shots[mid]!.from <= f) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export interface AnchorHint { word?: string | null; beat?: string | null; segment?: string | null; chapter?: string | null }
/** An anchor that resolves EXACTLY to `frame` (word > beat > segment > chapter > containing beat > containing chapter > program). */
export function anchorAt(ctx: Ctx, frame: number, hint: AnchorHint = {}): Anchor {
  const f = Math.round(frame);
  if (hint.word) {
    const w = ctx.ix.words.get(hint.word);
    if (w) return { ref: "word", wordId: hint.word, edge: "start", offset: f - w.from, expectNorm: w.norm };
  }
  if (hint.beat) {
    const b = ctx.ix.beats.get(hint.beat);
    if (b) return { ref: "beat", beatId: hint.beat, edge: "start", offset: f - b.from };
  }
  if (hint.segment) {
    const s = ctx.ix.segments.get(hint.segment);
    if (s) return { ref: "segment", segmentId: hint.segment, edge: "start", offset: f - s.from };
  }
  if (hint.chapter) {
    const c = ctx.ix.chapters.get(hint.chapter);
    if (c) return { ref: "chapter", chapterId: hint.chapter, edge: "start", offset: f - c.from };
  }
  const b = beatAt(ctx, Math.min(f, ctx.N - 1));
  if (b) return { ref: "beat", beatId: b.id, edge: "start", offset: f - b.from };
  const c = chapterAt(ctx, f);
  return { ref: "chapter", chapterId: c.id, edge: "start", offset: f - c.from };
}

/** Word count of a string (display tokens). */
export const wordCount = (s: string) => tokenizeDisplay(s).length;

/** Truncates on a word boundary with "…" to ≤ max chars. */
export function truncate(s: string, max: number): string {
  const t = s.trim();
  if ([...t].length <= max) return t;
  const chars = [...t].slice(0, Math.max(1, max - 1)).join("");
  const cut = chars.lastIndexOf(" ");
  return (cut > max * 0.5 ? chars.slice(0, cut) : chars).replace(/[\s,;:.–—-]+$/u, "") + "…";
}

export const ZONES: readonly ZoneName[] = ["center", "lowerThird", "topLeft", "topRight", "full", "captionBand"];
export type CompId = OverlayComponentId;

/** A procedural fallback asset (assets §7.9): a synthetic texture with no subject, bare like a generated backdrop. */
export const isProceduralAsset = (a: FrozenAsset | undefined): boolean =>
  !!a && (a.candidate?.provider === "procedural" || a.conform.recipe.startsWith("proc-"));

export const isAiAsset = (a: FrozenAsset | undefined): boolean =>
  !!a && (a.candidate?.license.code === "AI-GENERATED" || a.declaration?.kind === "ai-generated" || a.candidate?.provider === "fal");

/**
 * A per-minute rate as a sliding-window cap: r ≥ 1 → ⌊r⌋ events per 60 s; 0 < r < 1 → 1 event per 60/r s; r ≤ 0 → none.
 */
export function rateCap(fps: number, perMin: number): { W: number; cap: number } {
  if (!(perMin > 0)) return { W: Math.round(60 * fps), cap: 0 };
  if (perMin >= 1) return { W: Math.round(60 * fps), cap: Math.floor(perMin + 1e-9) };
  return { W: Math.round((60 / perMin) * fps), cap: 1 };
}
export function rateOk(ctx: Ctx, frames: readonly number[], f: number, perMin: number): boolean {
  const { W, cap } = rateCap(ctx.fps, perMin);
  return windowCapOk(frames, f, W, cap);
}

/** Registers an explicit flash at f when the per-minute budget allows (else the caller falls back to a routine flash). */
export function takeExplicitFlash(ctx: Ctx, f: number): boolean {
  if (!rateOk(ctx, ctx.explicitFlashes, f, Math.min(ctx.T.flash.explicitPerMin, ctx.Bu.explicitFlashPerMin))) return false;
  ctx.explicitFlashes.push(f);
  return true;
}

/** Seconds between two frames. */
export const sec = (ctx: Ctx, frames: number) => frames / ctx.fps;

/**
 * True when adding an event at f keeps every window [s, s+W) that contains f at ≤ cap events.
 * The maximum over such windows is reached at s = f − W + 1 or where a later event enters (s = x − W + 1).
 */
export function windowCapOk(frames: readonly number[], f: number, W: number, cap: number): boolean {
  const near = frames.filter((x) => x > f - W && x < f + W);
  const starts = [f - W + 1, ...near.filter((x) => x > f).map((x) => x - W + 1)];
  for (const s of starts) {
    const n = near.filter((x) => x >= s && x < s + W).length + 1;
    if (n > cap) return false;
  }
  return true;
}
