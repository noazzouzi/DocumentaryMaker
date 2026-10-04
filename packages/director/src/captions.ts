// Step 10 — CAPTIONS (§9.3, §9.4): SRT groups (always), burned keyword phrases (drama default) or pop/karaoke/rail groups,
// clip and translation subtitles; suppression under text cards and around keyword slams.
import {
  COMPONENT_META, FUNCTION_WORDS, ids, lerp, msToFrame, tokenizeDisplay, type CaptionDNA, type CaptionGroup, type LayoutWord, type WordTiming,
} from "@docmaker/core";
import { anchorAt, wordCount, type BeatCtx, type Ctx } from "./ctx";
import type { Ov, OvState } from "./overlays";
import { readText } from "./overlays/hold";

const endsSentence = (t: string) => /[.?!…]["»”’)]?$/u.test(t.trim());
const endsComma = (t: string) => /[,;:]["»”’)]?$/u.test(t.trim());
const joinedLen = (ws: readonly { text: string }[]) => ws.map((w) => w.text).join(" ").length;

/** §9.4 burned-caption grouping for the words of ONE segment (ms + frames). */
export function groupCaptions(words: readonly LayoutWord[], g: CaptionDNA["grouping"], fps: number): { words: LayoutWord[]; from: number; dur: number }[] {
  if (words.length === 0) return [];
  let groups: LayoutWord[][] = [];
  let cur: LayoutWord[] = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const gap = w.startMs - prev.endMs;
      if (gap >= g.pauseBreakMs || endsSentence(prev.text) || (endsComma(prev.text) && gap >= g.commaPauseMs) || cur.length >= g.maxWords
        || w.endMs - cur[0]!.startMs > g.maxSec * 1000 || joinedLen([...cur, w]) > g.maxChars) {
        groups.push(cur);
        cur = [];
      }
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  // merge short groups into the neighbour with the smaller gap (1-word groups stay only when the word ends with ! or ?)
  const maxMerged = Math.round((g.maxChars * 78) / 70); // fitText may shrink 78 → 70 px
  const short = (grp: LayoutWord[]) => {
    const exclam = grp.length === 1 && /[!?]["»”’)]?$/u.test(grp[0]!.text.trim());
    if (exclam) return false;
    return grp.length < g.minWords || grp[grp.length - 1]!.endMs - grp[0]!.startMs < g.minSec * 1000;
  };
  /** Splits an over-long merged group in two (each ≥ minWords words) at the most balanced point. */
  const rebalance = (ws: LayoutWord[]): LayoutWord[][] => {
    let best: LayoutWord[][] | null = null, bestLen = Infinity;
    for (let k = g.minWords; k <= ws.length - g.minWords; k++) {
      const a = ws.slice(0, k), b = ws.slice(k);
      const m = Math.max(joinedLen(a), joinedLen(b));
      if (m < bestLen) { best = [a, b]; bestLen = m; }
    }
    return best && bestLen <= maxMerged ? best : [ws];
  };
  const stuck = new Set<LayoutWord[]>();
  for (let guard = 0; guard < 1000 && groups.length > 1; guard++) {
    const k = groups.findIndex((grp) => short(grp) && !stuck.has(grp));
    if (k < 0) break;
    const grp = groups[k]!;
    const L = groups[k - 1], R = groups[k + 1];
    const gapL = L ? grp[0]!.startMs - L[L.length - 1]!.endMs : Infinity;
    const gapR = R ? R[0]!.startMs - grp[grp.length - 1]!.endMs : Infinity;
    const useL = L !== undefined && (R === undefined || gapL <= gapR);
    const merged = useL ? [...L!, ...grp] : [...grp, ...R!];
    const parts = joinedLen(merged) <= maxMerged ? [merged] : rebalance(merged);
    if (parts.length === 1 && joinedLen(parts[0]!) > maxMerged) { stuck.add(grp); continue; }
    if (parts.length > 1) for (const p of parts) if (short(p)) stuck.add(p);
    groups = useL ? [...groups.slice(0, k - 1), ...parts, ...groups.slice(k + 1)] : [...groups.slice(0, k), ...parts, ...groups.slice(k + 2)];
  }
  // §9.4 timing. On contiguous TTS alignments `nextIn − gapMs` falls inside the last word, so the last word would
  // flash for a frame or two: it keeps ≥ min(its duration, 6 f @30) on screen, and the lead-in/gap is taken from the
  // next group instead (which still appears no later than its first word's onset).
  const out: { words: LayoutWord[]; from: number; dur: number }[] = [];
  const minVis = Math.max(1, Math.round((6 * fps) / 30));
  const gapF = msToFrame(g.gapMs, fps);
  let prevEnd = -Infinity;
  groups.forEach((grp, k) => {
    const first = grp[0]!, last = grp[grp.length - 1]!;
    const next = groups[k + 1]?.[0];
    const nextIn = next ? next.startMs - g.leadMs : Infinity;
    const inMs = Math.max(0, first.startMs - g.leadMs);
    const outMs = Math.min(nextIn - g.gapMs, last.endMs + g.tailMs);
    const from = Math.min(first.from, Math.max(msToFrame(inMs, fps), prevEnd + gapF));
    let end = Math.max(from + 1, msToFrame(outMs, fps), last.from + Math.min(Math.max(1, last.dur), minVis));
    if (next) end = Math.max(from + 1, Math.min(end, next.from));
    out.push({ words: grp, from, dur: end - from });
    prevEnd = end;
  });
  for (let k = 0; k + 1 < out.length; k++) out[k]!.dur = Math.max(1, Math.min(out[k]!.dur, out[k + 1]!.from - out[k]!.from));
  return out;
}

/** SRT grouping: ≤ maxChars × maxLines (word-wrapped), ≤ maxSec, sentence-aware, short groups merged. */
export function srtGroups(words: readonly LayoutWord[], s: CaptionDNA["srtGrouping"]): LayoutWord[][] {
  const fits = (ws: readonly LayoutWord[]) => {
    let lines = 1, len = 0;
    for (const w of ws) {
      const add = len === 0 ? w.text.length : len + 1 + w.text.length;
      if (add > s.maxChars) { lines++; len = w.text.length; } else len = add;
    }
    return lines <= s.maxLines;
  };
  const groups: LayoutWord[][] = [];
  let cur: LayoutWord[] = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const durMs = w.endMs - cur[0]!.startMs;
      const brk = !fits([...cur, w]) || durMs > s.maxSec * 1000 || (endsSentence(prev.text) && prev.endMs - cur[0]!.startMs >= s.minSec * 1000) || w.startMs - prev.endMs >= 1500;
      if (brk) { groups.push(cur); cur = []; }
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  for (let k = groups.length - 1; k > 0; k--) {
    const g = groups[k]!;
    if (g[g.length - 1]!.endMs - g[0]!.startMs < s.minSec * 1000 && fits([...groups[k - 1]!, ...g]) && g[g.length - 1]!.endMs - groups[k - 1]![0]!.startMs <= s.maxSec * 1000) {
      groups.splice(k - 1, 2, [...groups[k - 1]!, ...g]);
    }
  }
  return rebalanceTails(groups, s, fits);
}

/** An SRT cue shorter than this many words or seconds after a size break reads as a stray word ("guilders.", 0.87 s). */
export const SRT_MIN_WORDS = 3;
export const SRT_MIN_SEC = 1.2;
const spanMs = (ws: readonly LayoutWord[]) => ws[ws.length - 1]!.endMs - ws[0]!.startMs;

/**
 * A cue split off its sentence by the size or duration limit (the previous cue does not end a sentence and no pause
 * separates them) that is shorter than SRT_MIN_WORDS words or SRT_MIN_SEC: merged back when the whole fits, else the two
 * cues are re-split where both fit and neither is short — at a comma when one is near, else where they are most even.
 */
function rebalanceTails(groups: LayoutWord[][], s: CaptionDNA["srtGrouping"], fits: (ws: readonly LayoutWord[]) => boolean): LayoutWord[][] {
  const short = (ws: readonly LayoutWord[]) => ws.length < SRT_MIN_WORDS || spanMs(ws) < SRT_MIN_SEC * 1000;
  const ok = (ws: readonly LayoutWord[]) => fits(ws) && spanMs(ws) <= s.maxSec * 1000;
  for (let k = 1; k < groups.length; k++) {
    const p = groups[k - 1]!, g = groups[k]!;
    const last = p[p.length - 1]!;
    if (!short(g) || endsSentence(last.text) || g[0]!.startMs - last.endMs >= 1500) continue;
    const all = [...p, ...g];
    if (ok(all)) { groups.splice(k - 1, 2, all); k--; continue; }
    let best = -1, bestCost = Number.POSITIVE_INFINITY;
    for (let i = 1; i < all.length; i++) {
      const a = all.slice(0, i), b = all.slice(i);
      if (!ok(a) || !ok(b) || short(a) || short(b)) continue;
      const cost = Math.abs(joinedLen(a) - joinedLen(b)) - (endsComma(all[i - 1]!.text) ? 24 : 0);
      if (cost < bestCost) { best = i; bestCost = cost; }
    }
    if (best > 0) groups.splice(k - 1, 2, all.slice(0, best), all.slice(best));
  }
  return groups;
}

const DANGER: Record<"en" | "fr", ReadonlySet<string>> = {
  en: new Set(["dead", "died", "death", "killed", "kill", "fraud", "crash", "crashed", "collapsed", "collapse", "bankrupt", "ruined", "ruin", "panic", "arrested", "guilty", "prison", "scam", "lie", "lies", "lied", "destroyed", "disaster", "fear", "worthless", "gone"]),
  fr: new Set(["mort", "morts", "tue", "fraude", "krach", "effondre", "effondrement", "faillite", "ruine", "ruines", "panique", "arrete", "coupable", "prison", "arnaque", "mensonge", "mensonges", "detruit", "desastre", "peur", "disparu"]),
};
const CURRENCY_RE = /[$€£ƒ]|\b(guilders?|florins?|dollars?|euros?|pounds?)\b/iu;

interface ToneCtx { emphasis: Set<string>; number: Set<string>; danger: Set<string> }

function toneOf(ctx: Ctx, w: LayoutWord, t: ToneCtx, next: LayoutWord | undefined): CaptionGroup["words"][number]["tone"] {
  if (t.number.has(w.id) || (/\p{N}/u.test(w.norm) && (CURRENCY_RE.test(w.text) || (next && CURRENCY_RE.test(next.text))))) return "money";
  if (t.danger.has(w.id) || DANGER[ctx.lang].has(w.norm)) return "danger";
  if (t.emphasis.has(w.id)) return "keyword";
  return "normal";
}

function toneContext(ctx: Ctx): ToneCtx {
  const t: ToneCtx = { emphasis: new Set(), number: new Set(), danger: new Set() };
  for (const b of ctx.beats) {
    b.cues.forEach((c, k) => {
      const a = b.text.cueAnchorIdx[k] ?? -1;
      const gi = a < 0 ? b.wordStart : b.wordStart + a;
      if (gi >= b.wordEnd) return;
      const id = ctx.words[gi]!.id;
      if (c.type === "EMPHASIS") t.emphasis.add(id);
      if (c.type === "NUMBER") t.number.add(id);
      if (c.type === "SHOCK" || c.type === "SENSITIVE") t.danger.add(id);
    });
    for (const i of b.text.emphasisIdx) if (b.wordStart + i < b.wordEnd) t.emphasis.add(ctx.words[b.wordStart + i]!.id);
  }
  return t;
}

/** Overlays that suppress burned captions (component list or ≥ suppressMinWords words of text). */
function suppressors(ctx: Ctx, st: OvState): Ov[] {
  const dna = ctx.tok.captionDNA;
  return st.items.filter((o) => !o.dropped && COMPONENT_META[o.component].band !== "hud"
    && (dna.suppressUnder.includes(o.component) || wordCount(readText(o.component, o.props).join(" ")) >= dna.suppressMinWords));
}
const intersects = (o: { from: number; dur: number }, f: number, e: number) => o.from < e && f < o.from + o.dur;

export interface CaptionResult { groups: CaptionGroup[]; keywordCount: number }

export function buildCaptions(ctx: Ctx, st: OvState): CaptionResult {
  const dna = ctx.tok.captionDNA;
  const mode = ctx.I.project.captions;
  const burnMode = mode === "burn";
  const sup = suppressors(ctx, st);
  const slams = st.items.filter((o) => !o.dropped && o.component === "KeywordSlam");
  const tone = toneContext(ctx);
  const out: CaptionGroup[] = [];
  const wordsOf = (segId: string) => {
    const s = ctx.segById.get(segId)!;
    return ctx.words.slice(s.wordStart, s.wordEnd);
  };
  const capWord = (w: LayoutWord, k: number, arr: readonly LayoutWord[], hero: boolean) => ({
    wordId: w.id, text: w.text, from: w.from, dur: w.dur, tone: hero && toneOf(ctx, w, tone, arr[k + 1]) === "normal" ? "keyword" as const : toneOf(ctx, w, tone, arr[k + 1]), hero,
  });
  const group = (id: string, segId: string, ws: LayoutWord[], from: number, dur: number, variant: CaptionGroup["variant"], burn: boolean, heroIds: ReadonlySet<string>): CaptionGroup => {
    const f = Math.max(0, Math.min(ctx.N - 1, from));
    const d = Math.max(1, Math.min(ctx.N - f, dur));
    const first = ws[0]!, last = ws[ws.length - 1]!;
    return {
      id, start: anchorAt(ctx, f, { word: first.id }), end: anchorAt(ctx, f + d, { word: last.id }), from: f, dur: d, segmentId: segId, variant, burn,
      words: ws.map((w, k) => capWord(w, k, ws, heroIds.has(w.id))),
    };
  };
  const counters = new Map<string, number>();
  const nextCap = (seg: string) => { const n = counters.get(seg) ?? 0; counters.set(seg, n + 1); return ids.caption(seg, n); };
  const spoken = ctx.layout.segments.filter((s) => s.mode === "vo" || s.mode === "clip-narrated");

  // SRT groups (always)
  const srt: CaptionGroup[] = [];
  for (const seg of spoken) {
    for (const ws of srtGroups(wordsOf(seg.segmentId), dna.srtGrouping)) {
      const first = ws[0]!, last = ws[ws.length - 1]!;
      srt.push(group(nextCap(seg.segmentId), seg.segmentId, ws, first.from, last.from + last.dur - first.from + ctx.S(0.3), "srt", false, new Set()));
    }
  }
  for (let k = 0; k + 1 < srt.length; k++) {
    const g = srt[k]!, n = srt[k + 1]!;
    if (g.from + g.dur > n.from) { g.dur = Math.max(1, n.from - g.from); g.end = anchorAt(ctx, g.from + g.dur, { word: g.words[g.words.length - 1]!.wordId }); }
  }
  out.push(...srt);

  // burned groups
  let keywordCount = 0;
  if (burnMode && dna.variant === "keywords") {
    const kw = keywordPhrases(ctx, tone, sup, slams);
    keywordCount = kw.length;
    const perSeg = new Map<string, number>();
    for (const p of kw) {
      const n = perSeg.get(p.seg) ?? 0;
      perSeg.set(p.seg, n + 1);
      out.push(group(ids.keywordCaption(p.seg, n), p.seg, p.words, p.from, p.dur, "keywords", true, new Set([p.words[0]!.id])));
    }
  } else if (dna.variant !== "keywords") {
    const variant = dna.variant;
    const pop: CaptionGroup[] = [];
    let lastHero = -Infinity;
    const heroBeats = new Set<string>();
    for (const seg of spoken) {
      for (const g of groupCaptions(wordsOf(seg.segmentId), dna.grouping, ctx.fps)) {
        const burn = burnMode && !sup.some((o) => intersects(o, g.from, g.from + g.dur));
        const heroes = new Set<string>();
        for (const w of g.words) {
          const b = ctx.beats.find((x) => ctx.wordIndex.get(w.id)! >= x.wordStart && ctx.wordIndex.get(w.id)! < x.wordEnd);
          if (!b || heroBeats.has(b.id) || !tone.emphasis.has(w.id) || w.from - lastHero < ctx.S(dna.heroWordMinGapSec)) continue;
          heroes.add(w.id); heroBeats.add(b.id); lastHero = w.from;
        }
        pop.push(group(nextCap(seg.segmentId), seg.segmentId, g.words, g.from, g.dur, variant, burn, heroes));
      }
    }
    for (let k = 0; k + 1 < pop.length; k++) {
      const g = pop[k]!, n = pop[k + 1]!;
      if (g.from + g.dur <= n.from) continue;
      // take the overlap from the next group's lead-in first (its first word still appears at its onset), then shorten
      const nFirst = n.words[0]!.from;
      const moveTo = Math.min(nFirst, g.from + g.dur, n.from + n.dur - 1);
      if (moveTo > n.from) { n.dur -= moveTo - n.from; n.from = moveTo; n.start = anchorAt(ctx, n.from, { word: n.words[0]!.wordId }); }
      if (g.from + g.dur > n.from) { g.dur = Math.max(1, n.from - g.from); g.end = anchorAt(ctx, g.from + g.dur, { word: g.words[g.words.length - 1]!.wordId }); }
    }
    out.push(...pop);
  }

  // clip subtitles and translations
  for (const seg of ctx.layout.segments) {
    if (seg.mode !== "clip") continue;
    out.push(...clipCaptions(ctx, seg.segmentId, burnMode, nextCap));
  }
  return { groups: out.sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1)), keywordCount };
}

/** Function words a keyword phrase never ends on. */
const TRAIL_STOP = FUNCTION_WORDS;

interface Phrase { seg: string; words: LayoutWord[]; from: number; dur: number; prio: number; gap: number }

/** Keyword phrases (drama default): anchors + following words of the same sentence; spaced; suppressed under cards/slams. */
function keywordPhrases(ctx: Ctx, tone: ToneCtx, sup: Ov[], slams: Ov[]): Phrase[] {
  const k = ctx.tok.captionDNA.keywords;
  const cands: { w: LayoutWord; prio: number }[] = [];
  const seen = new Set<string>();
  const add = (w: LayoutWord | undefined, prio: number) => { if (w && !seen.has(w.id)) { seen.add(w.id); cands.push({ w, prio }); } };
  for (const id of [...tone.emphasis].sort()) add(ctx.words[ctx.wordIndex.get(id)!], tone.number.has(id) ? 3 : 4);
  for (const id of [...tone.number].sort()) add(ctx.words[ctx.wordIndex.get(id)!], 3);
  for (const w of ctx.words) {
    const seg = ctx.segById.get(w.segmentId);
    if (!seg || (seg.mode !== "vo" && seg.mode !== "clip-narrated")) continue;
    const t = toneOf(ctx, w, tone, ctx.words[ctx.wordIndex.get(w.id)! + 1]);
    if (t === "money" || t === "danger") add(w, 1);
  }
  const phrases: Phrase[] = [];
  const stop = TRAIL_STOP[ctx.lang];
  for (const c0 of cands) {
    // the hero is a content word: an anchor on a function word moves to the next word of the sentence
    let gi = ctx.wordIndex.get(c0.w.id)!;
    for (let j = 0; j < 3 && stop.has(ctx.words[gi]!.norm) && !endsSentence(ctx.words[gi]!.text); j++) {
      const nx = ctx.words[gi + 1];
      if (!nx || nx.segmentId !== c0.w.segmentId) break;
      gi++;
    }
    if (stop.has(ctx.words[gi]!.norm)) continue;
    const c = { w: ctx.words[gi]!, prio: c0.prio };
    const ws = [c.w];
    for (let j = gi + 1; j < ctx.words.length && ws.length < k.maxWords; j++) {
      const prev = ws[ws.length - 1]!, w = ctx.words[j]!;
      if (w.segmentId !== c.w.segmentId || endsSentence(prev.text) || w.startMs - prev.endMs >= 250) break;
      ws.push(w);
    }
    while (ws.length > 1 && TRAIL_STOP[ctx.lang].has(ws[ws.length - 1]!.norm)) ws.pop();
    const last = ws[ws.length - 1]!;
    const speechMs = last.endMs - ws[0]!.startMs;
    const dur = ctx.S(Math.max(k.holdMinSec, speechMs / 1000 + 0.4));
    phrases.push({ seg: c.w.segmentId, words: ws, from: c.w.from, dur: Math.min(dur, ctx.N - c.w.from), prio: c.prio, gap: ctx.S(lerp(k.minGapSec, ctx.R(`kwg:${c.w.id}`)())) });
  }
  phrases.sort((a, b) => b.prio - a.prio || a.from - b.from);
  const accepted: Phrase[] = [];
  const slamPad = ctx.S(1);
  for (const p of phrases) {
    const end = p.from + p.dur;
    if (sup.some((o) => intersects(o, p.from, end))) continue;
    if (slams.some((o) => p.from < o.from + o.dur + slamPad && o.from - slamPad < end)) continue;
    if (accepted.some((q) => {
      const g = Math.max(p.gap, q.gap);
      return p.from < q.from ? q.from - end < g : p.from - (q.from + q.dur) < g;
    })) continue;
    accepted.push(p);
  }
  return accepted.sort((a, b) => a.from - b.from);
}

/** Clip transcript groups ("clip") and translation pages ("translation") over a clip segment. */
function clipCaptions(ctx: Ctx, segId: string, burnMode: boolean, nextCap: (seg: string) => string): CaptionGroup[] {
  const seg = ctx.segById.get(segId)!;
  const clip = ctx.clipBySeg.get(segId);
  const sseg = ctx.scriptSegById.get(segId);
  if (!clip || clip.passageInMs === null || clip.passageOutMs === null) return [];
  const dna = ctx.tok.captionDNA;
  const quote = sseg?.quoteId ? ctx.facts.quotes.find((q) => q.id === sseg.quoteId) : undefined;
  const foreign = quote ? quote.language.slice(0, 2).toLowerCase() !== ctx.lang : false;
  const minHold = (speechSec: number) => ctx.S(Math.max(dna.clipStyle.minHoldSec, speechSec + 0.6));
  const out: CaptionGroup[] = [];
  const segEnd = seg.from + seg.dur;
  const raw: WordTiming[] = (ctx.I.clipWords[segId] ?? []).filter((w) => w.startMs >= clip.passageInMs! && w.startMs < clip.passageOutMs!);
  const cw = raw.map((w, n) => {
    const from = Math.min(segEnd - 1, seg.from + msToFrame(w.startMs - clip.passageInMs!, ctx.fps));
    return { id: ids.clipWord(segId, n), text: w.text, from, dur: Math.max(1, msToFrame(w.endMs - w.startMs, ctx.fps)), startMs: w.startMs, endMs: w.endMs };
  });
  // clip transcript groups (sentence case, ≤ 42 chars × 2 lines)
  let cur: typeof cw = [];
  const flush = () => {
    if (!cur.length) return;
    const first = cur[0]!, last = cur[cur.length - 1]!;
    const dur = Math.min(ctx.N - first.from, Math.max(minHold((last.endMs - first.startMs) / 1000), last.from + last.dur - first.from));
    out.push({
      id: nextCap(segId), start: anchorAt(ctx, first.from, { segment: segId }), end: anchorAt(ctx, first.from + dur, { segment: segId }), from: first.from, dur,
      segmentId: segId, variant: "clip", burn: burnMode && !foreign,
      words: cur.map((w) => ({ wordId: w.id, text: w.text, from: w.from, dur: w.dur, tone: "normal" as const, hero: false })),
    });
    cur = [];
  };
  for (const w of cw) {
    if (cur.length && (joinedLen([...cur, w]) > 84 || endsSentence(cur[cur.length - 1]!.text))) flush();
    cur.push(w);
  }
  flush();
  for (let k = 0; k + 1 < out.length; k++) {
    const g = out[k]!, n = out[k + 1]!;
    if (g.from + g.dur > n.from) { g.dur = Math.max(1, n.from - g.from); g.end = anchorAt(ctx, g.from + g.dur, { segment: segId }); }
  }
  // translation pages, time-proportional over the clip span
  const tr = sseg?.subtitleTranslation ?? "";
  if (foreign && tr.trim()) {
    const pages: string[][] = [];
    let page: string[] = [];
    for (const t of tokenizeDisplay(tr).map((x) => x.text)) {
      if (page.length && [...page, t].join(" ").length > 42) { pages.push(page); page = []; }
      page.push(t);
    }
    if (page.length) pages.push(page);
    const total = pages.reduce((a, p) => a + p.join(" ").length, 0) || 1;
    const starts: number[] = [];
    let acc = 0;
    for (const p of pages) { starts.push(seg.from + Math.round((seg.dur * acc) / total)); acc += p.join(" ").length; }
    pages.forEach((p, pi) => {
      const from = Math.min(ctx.N - 1, starts[pi]!);
      const nextFrom = pi + 1 < pages.length ? starts[pi + 1]! : null;
      const share = (nextFrom ?? segEnd) - from;
      const want = nextFrom === null ? Math.max(share, minHold(Math.max(0, share / ctx.fps - 0.6))) : share;
      const dur = Math.max(1, Math.min(ctx.N - from, want));
      const step = Math.max(1, Math.floor(dur / p.length));
      out.push({
        id: ids.translationCaption(segId, pi), start: anchorAt(ctx, from, { segment: segId }), end: anchorAt(ctx, from + dur, { segment: segId }), from, dur,
        segmentId: segId, variant: "translation", burn: burnMode,
        words: p.map((t, n) => {
          const wf = Math.min(from + dur - 1, from + n * step);
          return { wordId: ids.trWord(segId, pi, n), text: t, from: wf, dur: Math.max(1, Math.min(step, from + dur - wf)), tone: "normal" as const, hero: false };
        }),
      });
    });
  }
  return out;
}

export type { BeatCtx };
