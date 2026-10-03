// Step 7 (b)–(f), (h)–(j): person intros, date stamps, keyword slams, clip cards/labels, disclosure labels, chapter cards,
// title sting, safe-messaging card, letterbox.
import { isFunctionWord, lerp, spokenText, tokenizeDisplay, type Person } from "@docmaker/core";
import { cueFrame, cueWord, isAiAsset, rateOk, round2, shotIdxAt, truncate, wordCount, type BeatCtx, type Ctx, type Shot } from "../ctx";
import { dateLabel } from "../dates";
import { CHAPTER_KICKER, LABEL_TEXT, SAFE_MESSAGING_CARD } from "../resources";
import { backdropRecipe } from "../shots";
import { holdOf } from "./hold";
import { CLS, addOv, cooldownOk, enterOf, personRule, policyOf, portraitFor, type OvState } from "./state";
import { fillAts, syncWords } from "./sync";

const norm = (s: string) => tokenizeDisplay(s).map((w) => w.norm).join(" ");

/** The person a PERSON_INTRO cue names (cue value ↔ name/aliases), else the beat's single person. */
export function personForCue(ctx: Ctx, b: BeatCtx, value: string): Person | undefined {
  const v = norm(value);
  if (v) {
    const exact = ctx.facts.people.find((p) => norm(p.name) === v || p.aliases.some((a) => norm(a) === v));
    if (exact) return exact;
    const part = ctx.facts.people.find((p) => {
      const n = norm(p.name);
      return n.includes(v) || v.includes(n) || p.aliases.some((a) => { const x = norm(a); return x.length > 2 && (v.includes(x) || x.includes(v)); });
    });
    if (part) return part;
  }
  if (b.plan.personIds.length === 1) return ctx.facts.people.find((p) => p.id === b.plan.personIds[0]);
  return undefined;
}

/** "Name — role" | "Name - role" | "Name: role" → {name, role}. */
export function splitNameRole(s: string): { name: string; role: string } | null {
  const t = s.trim();
  if (!t) return null;
  for (const sep of [" — ", " – ", " - ", ": "]) {
    const k = t.indexOf(sep);
    if (k > 0) return { name: t.slice(0, k).trim(), role: t.slice(k + sep.length).trim() };
  }
  return { name: t, role: "" };
}


/** (b) PERSON_INTRO → FreezeLabel (video under the anchor, seeded) or LowerThird. Returns the served cue keys. */
export function personIntros(ctx: Ctx, st: OvState, shots: readonly Shot[]): void {
  let lastLower = -Infinity;
  for (const b of ctx.beats) {
    b.cues.forEach((c, k) => {
      if (c.type !== "PERSON_INTRO") return;
      st.served.add(`${b.id}:${k}`);
      const p = personForCue(ctx, b, c.value);
      if (!p || personRule(ctx, p) !== "name") return; // minors/private victims never; non-public persons only after person-ack
      if (st.mentioned.has(p.id)) return;
      const a = cueFrame(ctx, b, k);
      if (a - lastLower < ctx.S(ctx.Bu.lowerThirdMinGapSec)) return;
      const nr = splitNameRole(b.text.onScreenText) ?? { name: p.name, role: "" };
      const name = truncate(nr.name || p.name, 48);
      const role = truncate(nr.role, 72);
      const shot = shots[shotIdxAt(shots, a)]!;
      const w = cueWord(ctx, b, k);
      const frz = policyOf(ctx, "FreezeLabel");
      if (shot.src.kind === "video" && shot.src.assetId && frz && cooldownOk(ctx, st, "FreezeLabel", a) && ctx.R(`frz:${b.id}`)() < frz.weight) {
        const props = { assetId: shot.src.assetId, sourceFrame: Math.max(0, shot.src.sourceIn + (a - shot.from)), name, role, desaturate: 0.8, darken: 0.25 };
        const h = holdOf("FreezeLabel", props, ctx.fps);
        const ov = addOv(ctx, st, { component: "FreezeLabel", ref: b.id, beatId: b.id, from: a, dur: Math.min(h.dur, ctx.F30(90)), props, cls: CLS.cue, origin: "cue", anchorWord: w?.id ?? null, readHold: h.readHold });
        if (ov) { st.mentioned.add(p.id); lastLower = a; }
        return;
      }
      if (!policyOf(ctx, "LowerThird") || !cooldownOk(ctx, st, "LowerThird", a)) return;
      const props = { name, role, align: "left" };
      const h = holdOf("LowerThird", props, ctx.fps);
      const ov = addOv(ctx, st, { component: "LowerThird", ref: b.id, beatId: b.id, from: a, dur: h.dur, props, cls: CLS.cue, origin: "cue", anchorWord: w?.id ?? null, readHold: h.readHold });
      if (ov) { st.mentioned.add(p.id); lastLower = a; }
    });
  }
}

/** (c) TIME_JUMP → DateStamp; (d) SHOCK (energy 5, 1–3 words) → KeywordSlam. */
export function dateStampsAndSlams(ctx: Ctx, st: OvState): void {
  for (const b of ctx.beats) {
    b.cues.forEach((c, k) => {
      const a = cueFrame(ctx, b, k);
      const w = cueWord(ctx, b, k);
      if (c.type === "TIME_JUMP" && policyOf(ctx, "DateStamp")) {
        const raw = dateLabel(/\p{N}/u.test(b.text.onScreenText) ? b.text.onScreenText : c.value, ctx.lang);
        const text = truncate(raw.toLocaleUpperCase(ctx.lang), 48);
        if (!text) return;
        const typeFrames = 2 * [...text].length;
        const props = { text, zone: "topLeft" };
        const h = holdOf("DateStamp", props, ctx.fps, { typeFrames: ctx.F30(typeFrames) });
        if (addOv(ctx, st, { component: "DateStamp", ref: b.id, beatId: b.id, from: a, dur: h.dur, props, cls: CLS.cue, origin: "cue", zone: "topLeft", anchorWord: w?.id ?? null, readHold: h.readHold })) st.served.add(`${b.id}:${k}`);
      }
      if (c.type === "SHOCK") {
        const ov = keywordSlam(ctx, st, b, a, w?.id ?? null);
        if (ov) st.served.add(`${b.id}:${k}`);
      }
    });
  }
}

/**
 * Slam / kinetic text that never reads as a lone function word: trailing function words are dropped ("PRICES FELL AND"
 * → "PRICES FELL"); null when no content word is left ("THE", "OF THE").
 */
export function contentText(text: string, lang: "en" | "fr"): string | null {
  const ws = text.trim().split(/\s+/).filter(Boolean);
  while (ws.length > 0 && isFunctionWord(ws[ws.length - 1]!, lang)) ws.pop();
  if (!ws.some((w) => !isFunctionWord(w, lang))) return null;
  return ws.join(" ");
}

/** KeywordSlam for a SHOCK beat (energy 5, 1–3 words of onScreenText, at least one content word), within keywordSlamPerMin and its cooldown. */
export function keywordSlam(ctx: Ctx, st: OvState, b: BeatCtx, a: number, wordId: string | null) {
  if (!policyOf(ctx, "KeywordSlam") || b.energy < 5) return null;
  const n = wordCount(b.text.onScreenText);
  if (n < 1 || n > 3) return null;
  const slam = contentText(b.text.onScreenText, ctx.lang);
  if (slam === null) { ctx.warn("SLAM_TEXT", b.id, `KeywordSlam skipped: "${b.text.onScreenText}" has no content word`); return null; }
  if (!cooldownOk(ctx, st, "KeywordSlam", a)) return null;
  if (!rateOk(ctx, st.items.filter((o) => !o.dropped && o.component === "KeywordSlam").map((o) => o.from), a, ctx.Bu.keywordSlamPerMin * b.intensity)) return null;
  const text = truncate(slam.toLocaleUpperCase(ctx.lang), 28);
  const props = { text, color: ctx.tok.tokens.palette.danger, background: "black" };
  const h = holdOf("KeywordSlam", props, ctx.fps);
  return addOv(ctx, st, { component: "KeywordSlam", ref: b.id, beatId: b.id, from: a, dur: h.dur, props, cls: CLS.cue, origin: "cue", anchorWord: wordId, readHold: h.readHold });
}

/** (e) clips: SourceLabel over clip media; QuoteCard for clip-card (static) and clip-narrated (VO-synced) segments. */
export function clipOverlays(ctx: Ctx, st: OvState, shots: readonly Shot[]): void {
  for (const b of ctx.beats) {
    if (!b.isClip) continue;
    b.cues.forEach((c, k) => { if (c.type === "CLIP_REF") st.served.add(`${b.id}:${k}`); });
    const mode = b.seg.mode;
    if (mode === "clip") {
      const cs = shots.filter((s) => s.beatId === b.id && s.role === "clip");
      const label = cs[0]?.sourceLabel;
      if (!cs.length || !label || !policyOf(ctx, "SourceLabel")) continue;
      const from = cs[0]!.from, end = cs[cs.length - 1]!.end;
      addOv(ctx, st, { component: "SourceLabel", ref: b.id, beatId: b.id, from, dur: end - from, props: { text: label, kind: "source", zone: "topLeft" }, cls: CLS.structural, origin: "clip", zone: "topLeft", anchorSegment: b.seg.segmentId });
      continue;
    }
    if (mode !== "clip-card" && mode !== "clip-narrated") continue;
    if (!policyOf(ctx, "QuoteCard") || !b.sseg) continue;
    const quote = ctx.facts.quotes.find((q) => q.id === b.sseg!.quoteId);
    const speaker = quote ? ctx.facts.people.find((p) => p.id === quote.speakerId) : undefined;
    const showName = speaker && personRule(ctx, speaker) === "name";
    const src = quote ? ctx.facts.sources.find((s) => s.id === quote.sourceId) : undefined;
    const text = truncate(spokenText(b.sseg, "clip-narrated"), 400);
    if (!text) continue;
    const from = b.firstOfChapter ? b.seg.from : b.from;
    const enter = enterOf(ctx, "QuoteCard");
    let words: { text: string; at: number; emphasis: boolean }[] = [];
    let narratedEnd: number | null = null;
    if (mode === "clip-narrated") {
      const lw = ctx.words.slice(b.seg.wordStart, b.seg.wordEnd);
      const synced = syncWords(text, lw, from);
      const ats = fillAts(synced.map((w) => w.at), enter, ctx.F30(6));
      words = synced.map((w, j) => ({ text: w.text, at: ats[j]!, emphasis: false }));
      const last = lw[lw.length - 1];
      narratedEnd = last ? last.from + last.dur - from : null;
    }
    const props = {
      text, speaker: showName ? truncate(speaker.name, 60) : "", sourceLabel: truncate([src?.publisher ?? "", dateLabel(quote?.date ?? "", ctx.lang)].filter(Boolean).join(", "), 80),
      portraitAssetId: showName ? portraitFor(ctx, speaker.id) : null, translated: b.sseg.subtitleTranslation !== "", words,
    };
    const h = holdOf("QuoteCard", props, ctx.fps, { narratedEnd });
    const dur = Math.max(Math.min(h.maxHold, b.end - from), Math.min(h.dur, b.end - from));
    addOv(ctx, st, { component: "QuoteCard", ref: b.id, beatId: b.id, from, dur, props, cls: CLS.template, origin: "clip", anchorSegment: b.seg.segmentId, readHold: h.readHold, subBeats: words.length ? [from + words[0]!.at] : [] });
  }
}

/** Downgraded (reconstruction) beats: a quote/post/document beat rendered as kinetic text that still references people. */
export function isReconstruction(b: BeatCtx): boolean {
  return b.plan.motionTemplate === "kinetic_text" && b.plan.personIds.length > 0
    && (b.plan.quoteId !== null || ["QUOTE", "TWEET", "DOCUMENT", "ARTICLE"].some((c) => b.cueTypes.has(c as never)));
}

/** (f) disclosure labels: AI illustrations, synthetic / scratch voice, pickup TTS, reconstructions. */
export function labelOverlays(ctx: Ctx, st: OvState, shots: readonly Shot[]): void {
  if (!policyOf(ctx, "SourceLabel")) return;
  const L = LABEL_TEXT[ctx.lang];
  // AI assets on screen (runs of consecutive shots)
  for (let i = 0; i < shots.length; i++) {
    const a = shots[i]!.src.assetId ? ctx.frozen[shots[i]!.src.assetId!] : undefined;
    if (!isAiAsset(a)) continue;
    let j = i;
    while (j + 1 < shots.length && shots[j + 1]!.src.assetId === shots[i]!.src.assetId) j++;
    const s = shots[i]!;
    addOv(ctx, st, { component: "SourceLabel", ref: s.beatId ?? s.chapterId, beatId: s.beatId, from: s.from, dur: shots[j]!.end - s.from, props: { text: L.illustration, kind: "illustration", zone: "topLeft" }, cls: CLS.structural, origin: "label", zone: "topLeft" });
    i = j;
  }
  // voice disclosure for the whole program
  if (ctx.I.voiceProvider !== "recording") {
    const kind = ctx.I.takeKind === "scratch" ? "scratch-voice" : "synthetic-voice";
    addOv(ctx, st, { component: "SourceLabel", ref: ctx.chapters[0]!.id, beatId: null, from: 0, dur: ctx.N, props: { text: L[kind], kind, zone: "topRight" }, cls: CLS.structural, origin: "label", zone: "topRight", anchorChapter: ctx.chapters[0]!.id });
  }
  for (const segId of [...ctx.I.pickupSegments].sort()) {
    const seg = ctx.segById.get(segId);
    if (!seg) continue;
    const b = ctx.beats.find((x) => x.seg.segmentId === segId);
    addOv(ctx, st, { component: "SourceLabel", ref: b?.id ?? seg.chapterId, beatId: b?.id ?? null, from: seg.from, dur: seg.dur, props: { text: L["pickup-tts"], kind: "pickup-tts", zone: "topRight" }, cls: CLS.structural, origin: "label", zone: "topRight", anchorSegment: segId });
  }
  for (const b of ctx.beats) {
    if (!isReconstruction(b)) continue;
    const from = b.firstOfChapter ? b.onset : b.from;
    addOv(ctx, st, { component: "SourceLabel", ref: b.id, beatId: b.id, from, dur: b.end - from, props: { text: L.reconstruction, kind: "reconstruction", zone: "topLeft" }, cls: CLS.structural, origin: "label", zone: "topLeft" });
  }
}

/** (h) chapter cards, (i) title sting, (j) safe-messaging card, letterbox. */
export function structuralOverlays(ctx: Ctx, st: OvState): void {
  const kicker = CHAPTER_KICKER[ctx.lang];
  const total = Math.max(1, ctx.outline ? ctx.outline.chapters.length - (ctx.coldOpen ? 1 : 0) : Math.max(...ctx.chapters.map((c) => c.cardIndex)));
  const backdrop = backdropRecipe(ctx);
  for (const ch of ctx.chapters) {
    if (ch.idx === 0) continue;
    const limit = (ch.firstWordFrame ?? ch.end) + ctx.F30(6) - ch.from;
    if (ch.titleSting) {
      if (!ctx.Bu.titleSting || !policyOf(ctx, "TitleSting")) continue;
      const props = { title: truncate(ctx.I.script.title, 80), kicker: truncate(`${kicker} ${ch.cardIndex} · ${ch.title}`, 60), mode: "slam", backdrop };
      const want = ctx.F30(Math.round(lerp([90, 120], ctx.R(`ts:${ch.id}`)())));
      const dur = Math.min(want, limit, ch.end - ch.from);
      const h = holdOf("TitleSting", props, ctx.fps);
      if (dur < h.minHold) ctx.warn("READABILITY", ch.id, `title sting held ${dur} f (< ${h.minHold} f) to end before the narrator resumes`);
      addOv(ctx, st, { component: "TitleSting", ref: ch.id, beatId: null, from: ch.from, dur, props, cls: CLS.structural, origin: "structural", anchorChapter: ch.id, readHold: h.readHold });
      continue;
    }
    if (!policyOf(ctx, "ChapterCard")) continue;
    const props = { index: Math.min(ch.cardIndex, Math.max(total, ch.cardIndex)), total: Math.max(total, ch.cardIndex), title: truncate(ch.title || `${kicker} ${ch.cardIndex}`, 60), kicker: truncate(`${kicker} ${ch.cardIndex}`, 40), letterbox: true, backdrop };
    const h = holdOf("ChapterCard", props, ctx.fps);
    const [lo, hi] = ctx.Bu.chapterCardFrames;
    const dur = Math.min(Math.max(lo, Math.min(hi, h.readHold)), limit, ch.end - ch.from);
    if (dur < Math.min(lo, h.readHold)) ctx.warn("READABILITY", ch.id, `chapter card held ${dur} f to end ≤ 6 f after the first word`);
    addOv(ctx, st, { component: "ChapterCard", ref: ch.id, beatId: null, from: ch.from, dur, props, cls: CLS.structural, origin: "structural", anchorChapter: ch.id, readHold: h.readHold });
  }
  if (ctx.I.riskFlags.includes("suicide_self_harm")) {
    const dur = Math.min(ctx.N, ctx.S(5));
    addOv(ctx, st, {
      component: "KineticText", ref: ctx.chapters[ctx.chapters.length - 1]!.id, beatId: null, from: ctx.N - dur, dur,
      props: { lines: [...SAFE_MESSAGING_CARD[ctx.lang]], emphasis: [], align: "center" }, cls: CLS.structural, origin: "resource", zone: "center",
    });
  }
  if (ctx.style.grade.letterbox !== null) {
    addOv(ctx, st, { component: "Letterbox", ref: ctx.chapters[0]!.id, beatId: null, from: 0, dur: ctx.N, props: { ratio: Math.min(2.76, Math.max(1.85, ctx.style.grade.letterbox)) }, cls: CLS.structural, origin: "structural", anchorChapter: ctx.chapters[0]!.id });
  }
}

export { round2 };
