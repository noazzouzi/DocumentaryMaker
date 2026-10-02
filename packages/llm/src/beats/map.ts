// ChapterBeatsWire → BeatPlan[] + BeatLang[] (ids assigned in code), plus the deterministic fallback re-split.
import {
  ids, tokenizeDisplay, type BeatLang, type BeatPlan, type ChapterScript, type FactSheet, type Lang, type LintIssue, type ScriptSegment,
} from "@docmaker/core";
import { clamp, resolveAnchors, resolveEmphasis } from "../wire/map";
import { normRef, normRefsLenient, normSegmentId } from "../wire/ids";
import type { ChapterBeatsWire } from "../wire/schemas";
import { splitBeatsFallback, fallbackShares } from "./split";
import { computePlanKey } from "./synthetic";

const QUOTE_TEMPLATES = new Set(["quote_card", "tweet_card", "document_highlight"]);

function knownSets(fs: FactSheet) {
  const facts = new Set<string>([
    ...fs.sources.map((x) => x.id), ...fs.people.map((x) => x.id), ...fs.timeline.map((x) => x.id),
    ...fs.figures.map((x) => x.id), ...fs.claims.map((x) => x.id), ...fs.quotes.map((x) => x.id),
  ]);
  return { facts, people: new Set(fs.people.map((p) => p.id)), quotes: new Set(fs.quotes.map((q) => q.id)) };
}

/** Maps the model's beats. Beats on unknown/non-narration segments are dropped (V_SEGMENT). Ids: `${chapterId}-B${seq3}`. */
export function beatsFromWire(
  w: ChapterBeatsWire,
  o: { chapter: ChapterScript; factSheet: FactSheet; lang: Lang; startOrder: number },
): { plans: BeatPlan[]; texts: BeatLang[]; issues: LintIssue[] } {
  const { chapter, lang } = o;
  const issues: LintIssue[] = [];
  const known = knownSets(o.factSheet);
  const narr = new Map(chapter.segments.filter((s) => s.type === "narration").map((s) => [s.id, s]));
  const plans: BeatPlan[] = [];
  const texts: BeatLang[] = [];
  let seq = 1;
  w.beats.forEach((b, k) => {
    const segId = normSegmentId(b.segment_id);
    if (!segId || !narr.has(segId)) {
      issues.push({ level: "error", rule: "V_SEGMENT", where: chapter.chapterId, msg: `beat ${k} references "${b.segment_id}", not a narration segment of ${chapter.chapterId} (dropped)` });
      return;
    }
    const id = ids.beat(chapter.chapterId, seq++);
    const text = b.text.trim();
    let motionData: Record<string, unknown> = {};
    if (b.motion_template !== "none" && b.motion_data_json.trim() !== "") {
      try {
        const v: unknown = JSON.parse(b.motion_data_json);
        if (v && typeof v === "object" && !Array.isArray(v)) motionData = v as Record<string, unknown>;
        else issues.push({ level: "warn", rule: "V_MOTION_JSON", where: id, msg: "motion_data_json is not an object" });
      } catch {
        issues.push({ level: "warn", rule: "V_MOTION_JSON", where: id, msg: "motion_data_json is not valid JSON" });
      }
    }
    let quoteId: string | null = null;
    if (QUOTE_TEMPLATES.has(b.motion_template) && typeof motionData.quote_id === "string") {
      try {
        const q = normRef(motionData.quote_id, "quote_id", "Q");
        if (q && known.quotes.has(q)) quoteId = q;
      } catch {
        /* reported by validateBeats (fact refs) */
      }
    }
    const people = normRefsLenient(b.person_ids, "P").ids.filter((p) => known.people.has(p));
    const factIds = normRefsLenient(b.fact_ids).ids.filter((f) => known.facts.has(f));
    const cue = resolveAnchors(text, b.cue_tags.map((c) => c.word), id);
    issues.push(...cue.issues);
    const base = { visualKind: b.visual_kind, visualQuery: b.visual_query.trim(), personIds: people, motionTemplate: b.motion_template, quoteId };
    plans.push({
      id, chapterId: chapter.chapterId, segmentId: segId, order: o.startOrder + plans.length, origin: "llm", purpose: b.purpose,
      energy: Math.round(clamp(b.energy, 1, 5)), estSeconds: Math.max(0.5, Number.isFinite(b.est_seconds) ? b.est_seconds : 0.5), ...base,
      youtubeQuoteToFind: b.youtube_quote_to_find.trim(), camera: b.camera, transitionIn: b.transition_in, sfx: [...new Set(b.sfx)],
      musicCue: b.music_cue, musicMood: b.music_mood, factIds, cueTags: b.cue_tags.map((c) => ({ type: c.type, value: c.value.trim() })),
      planKey: computePlanKey(base),
    });
    texts.push({
      beatId: id, lang, text, onScreenText: b.on_screen_text.trim(), cueAnchorIdx: cue.idx, emphasisIdx: resolveEmphasis(text, b.emphasis_words), motionData,
    });
  });
  return { plans, texts, issues };
}

/** Generic plan for a segment the model did not cover. */
function defaultPlan(chapter: ChapterScript, seg: ScriptSegment): Omit<BeatPlan, "id" | "order" | "planKey"> {
  const kw = tokenizeDisplay(chapter.title).map((w) => w.norm).filter((w) => w.length > 2).join(" ") || "documentary archive";
  return {
    chapterId: chapter.chapterId, segmentId: seg.id, origin: "fallback", purpose: "context", energy: 3, estSeconds: 3, visualKind: "stock_broll",
    visualQuery: kw, personIds: [], quoteId: null, youtubeQuoteToFind: "", motionTemplate: "none", camera: "ken_burns", transitionIn: "cut",
    sfx: [], musicCue: "none", musicMood: "none", factIds: seg.factIds, cueTags: [],
  };
}

/**
 * Re-splits the given segments deterministically (sentence ends, then `, ; : —`), re-attaching the model's annotations
 * by index; then renumbers every beat of the chapter in script order. Annotations whose anchor word left the slice
 * fall back to the beat start.
 */
export function resplitSegments(
  plans: BeatPlan[], texts: BeatLang[],
  o: { chapter: ChapterScript; segmentIds: ReadonlySet<string>; lang: Lang; cps: number; avgBody: number; startOrder: number },
): { plans: BeatPlan[]; texts: BeatLang[] } {
  const { chapter, lang } = o;
  const textOf = new Map(texts.filter((t) => t.lang === lang).map((t) => [t.beatId, t]));
  const outPlans: BeatPlan[] = [];
  const outTexts: BeatLang[] = [];
  let seq = 1;
  for (const seg of chapter.segments) {
    if (seg.type !== "narration") continue;
    const segPlans = plans.filter((p) => p.segmentId === seg.id && p.chapterId === chapter.chapterId);
    const push = (p: Omit<BeatPlan, "id" | "order" | "planKey">, t: Omit<BeatLang, "beatId" | "lang">) => {
      const id = ids.beat(chapter.chapterId, seq++);
      const plan = { ...p, id, order: o.startOrder + outPlans.length, planKey: "" } as BeatPlan;
      plan.planKey = computePlanKey(plan);
      outPlans.push(plan);
      outTexts.push({ ...t, beatId: id, lang });
    };
    if (!o.segmentIds.has(seg.id)) {
      for (const p of segPlans) {
        const t = textOf.get(p.id);
        push(p, t ?? { text: "", onScreenText: "", cueAnchorIdx: p.cueTags.map(() => -1), emphasisIdx: [], motionData: {} });
      }
      continue;
    }
    const llmTexts = segPlans.map((p) => textOf.get(p.id)?.text ?? "");
    const shares = segPlans.length > 0 && llmTexts.some((t) => t.length > 0)
      ? llmTexts.map((t) => Math.max(1, t.length))
      : fallbackShares(seg.displayText, o.cps, o.avgBody);
    const slices = splitBeatsFallback(seg.displayText, shares);
    slices.forEach((slice, k) => {
      const reuse = k < segPlans.length;
      const src = segPlans[Math.min(k, segPlans.length - 1)];
      const srcText = reuse && src ? textOf.get(src.id) : undefined;
      const base = src
        ? reuse ? { ...src, origin: "fallback" as const } : { ...src, origin: "fallback" as const, motionTemplate: "none" as const, quoteId: null, cueTags: [] }
        : defaultPlan(chapter, seg);
      // keep the annotations whose anchor word is still in this slice
      const oldWords = tokenizeDisplay(srcText?.text ?? "");
      const newWords = tokenizeDisplay(slice);
      const cueTags: BeatPlan["cueTags"] = [];
      const cueAnchorIdx: number[] = [];
      (reuse ? base.cueTags : []).forEach((c, ci) => {
        const a = srcText?.cueAnchorIdx[ci] ?? -1;
        if (a < 0) {
          cueTags.push(c);
          cueAnchorIdx.push(-1);
          return;
        }
        const norm = oldWords[a]?.norm;
        const at = norm ? newWords.findIndex((w) => w.norm === norm) : -1;
        if (at >= 0) {
          cueTags.push(c);
          cueAnchorIdx.push(at);
        }
      });
      const emphasisIdx = (srcText?.emphasisIdx ?? [])
        .map((e) => newWords.findIndex((w) => w.norm === oldWords[e]?.norm))
        .filter((e) => e >= 0);
      push(
        { ...base, cueTags, estSeconds: Math.max(0.5, Math.round((slice.length / o.cps) * 10) / 10) },
        { text: slice, onScreenText: srcText?.onScreenText ?? "", cueAnchorIdx, emphasisIdx: [...new Set(emphasisIdx)].slice(0, 3), motionData: srcText?.motionData ?? {} },
      );
    });
  }
  return { plans: outPlans, texts: outTexts };
}
