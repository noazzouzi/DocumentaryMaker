// Wire (snake_case) → core (camelCase) mappers with the normative coercion table (§6.4).
import {
  Color, FactSheet, Outline, StyleSuggestion, ids, normWord, tokenizeDisplay,
  type Budget, type ChapterScript, type FactCheckItem, type Lang, type LintIssue, type RegistryEntry, type RiskFlag,
  type ScriptSegment, type Source, type ThemeOverride,
} from "@docmaker/core";
import { maskPersons, sharedNameTokens } from "../text";
import { applyFrTypography } from "./typography";
import { normChapterId, normLoopId, normRef, normRefs, normRefsLenient, normSegmentId } from "./ids";
import type {
  ChapterScriptWire, FactCheckWire, FactSheetWire, OutlineWire, PassageWire, RerankWire, StyleSuggestionWire, TranscreateWire,
} from "./schemas";

export const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const round1 = (v: number) => Math.round(v * 10) / 10;
const nullIfEmpty = (s: string): string | null => (s.trim() === "" ? null : s.trim());
const warn = (rule: string, where: string, msg: string): LintIssue => ({ level: "warn", rule, where, msg });

// ---------------------------------------------------------------- fact sheet
function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export interface FactSheetMapResult { factSheet: FactSheet; invalidRefs: string[]; issues: LintIssue[] }

/**
 * Sources come from the REGISTRY (url/title/fetched/cited/snippets); only publisher/source_type/reliability/language/
 * published_at come from the model. Items citing unknown (or no) sources move to `gaps` and into `invalidRefs`.
 */
export function factSheetFromWire(w: FactSheetWireLike, o: { registry: readonly RegistryEntry[]; asOf: string; topic: string }): FactSheetMapResult {
  const issues: LintIssue[] = [];
  const invalidRefs: string[] = [];
  const gaps = w.gaps.map((g) => g.trim()).filter((g) => g !== "");
  const wireSources = new Map<string, FactSheetWire["sources"][number]>();
  w.sources.forEach((s, i) => {
    const id = normRef(s.id, `sources[${i}].id`, "S");
    if (id === null) return;
    if (!o.registry.some((r) => r.id === id)) {
      invalidRefs.push(id);
      issues.push(warn("FS_UNKNOWN_SOURCE", id, `the model described source ${id}, which is not in the registry (ignored)`));
      return;
    }
    if (!wireSources.has(id)) wireSources.set(id, s);
  });
  const sources: Source[] = o.registry.map((r) => {
    const s = wireSources.get(r.id);
    return {
      id: r.id, url: r.url, title: r.title || s?.title || r.url, publisher: s?.publisher.trim() || hostOf(r.url),
      publishedAt: s?.published_at.trim() ?? "", sourceType: s?.source_type ?? "other", reliability: s?.reliability ?? "medium",
      language: s?.language ?? "", fetched: r.fetched, cited: r.cited, snippets: r.snippets.slice(0, 5),
    };
  });
  const known = new Set(sources.map((s) => s.id));
  const sourcesOk = (refs: string[]) => refs.length > 0 && refs.every((r) => known.has(r));
  const seen = new Set<string>();
  const firstTime = (id: string, where: string): boolean => {
    if (seen.has(id)) {
      issues.push(warn("FS_DUPLICATE_ID", id, `duplicate ${where} id ${id} (second item dropped)`));
      return false;
    }
    seen.add(id);
    return true;
  };

  const people = w.people.flatMap((p, i) => {
    const id = normRef(p.id, `people[${i}].id`, "P")!;
    if (!id || !firstTime(id, "person")) return [];
    return [{
      id, name: p.name.trim(), roleInStory: p.role_in_story.trim(), publicFigure: p.public_figure, isMinorOrPrivateVictim: p.is_minor_or_private_victim,
      imageQueries: p.is_minor_or_private_victim ? [] : p.image_queries.map((q) => q.trim()).filter((q) => q !== ""), wikidataQid: null, aliases: [],
    }];
  });
  const personIds = new Set(people.map((p) => p.id));

  const timeline = w.timeline.flatMap((e, i) => {
    const id = normRef(e.id, `timeline[${i}].id`, "E");
    if (!id || !firstTime(id, "event")) return [];
    const sourceIds = normRefs(e.source_ids, `timeline[${i}].source_ids`, "S");
    if (!sourcesOk(sourceIds)) {
      invalidRefs.push(id);
      gaps.push(`${e.date} — ${e.title}: ${e.what_happened}`.trim());
      return [];
    }
    return [{
      id, date: e.date.trim(), title: e.title.trim(), whatHappened: e.what_happened.trim(),
      personIds: normRefs(e.person_ids, `timeline[${i}].person_ids`, "P").filter((p) => personIds.has(p)),
      status: e.status, sourceIds, dramaValue: clamp(e.drama_value, 0, 10),
    }];
  });

  const quotes = w.quotes.flatMap((q, i) => {
    const id = normRef(q.id, `quotes[${i}].id`, "Q");
    if (!id || !firstTime(id, "quote")) return [];
    const sourceId = normRef(q.source_id, `quotes[${i}].source_id`, "S");
    const speakerId = normRef(q.speaker_id, `quotes[${i}].speaker_id`, "P");
    if (!sourceId || !known.has(sourceId) || !speakerId || !personIds.has(speakerId)) {
      invalidRefs.push(id);
      gaps.push(`Unverified quote: "${q.verbatim.trim()}"`);
      return [];
    }
    return [{
      id, speakerId, verbatim: q.verbatim.trim(), language: q.language, date: q.date.trim(), context: q.context.trim(), medium: q.medium,
      sourceId, youtubeSearchQuery: q.youtube_search_query.trim(), verification: "unchecked" as const, verifiedBy: "none" as const,
    }];
  });

  const figures = w.figures.flatMap((f, i) => {
    const id = normRef(f.id, `figures[${i}].id`, "N");
    if (!id || !firstTime(id, "figure")) return [];
    const sourceIds = normRefs(f.source_ids, `figures[${i}].source_ids`, "S");
    if (!sourcesOk(sourceIds) || !Number.isFinite(f.value)) {
      invalidRefs.push(id);
      gaps.push(`${f.label}: ${f.value} ${f.unit}`.trim());
      return [];
    }
    return [{ id, label: f.label.trim(), value: f.value, unit: f.unit.trim(), asOf: f.as_of.trim(), sourceIds, chartable: f.chartable }];
  });

  const claims = w.claims.flatMap((c, i) => {
    const id = normRef(c.id, `claims[${i}].id`, "C");
    if (!id || !firstTime(id, "claim")) return [];
    const sourceIds = normRefs(c.source_ids, `claims[${i}].source_ids`, "S");
    if (!sourcesOk(sourceIds)) {
      invalidRefs.push(id);
      gaps.push(c.summary.trim());
      return [];
    }
    return [{
      id, summary: c.summary.trim(), madeBy: c.made_by.trim(), against: c.against.trim(), status: c.status, jurisdiction: c.jurisdiction.trim(),
      decisionDate: c.decision_date.trim(), subjectResponse: c.subject_response.trim(), asOf: o.asOf, sensitivity: c.sensitivity, sourceIds,
    }];
  });

  const factSheet = FactSheet.parse({
    schemaVersion: 1, topic: w.topic.trim() || o.topic, asOf: o.asOf, oneLinePremise: w.one_line_premise.trim(),
    centralQuestion: w.central_question.trim(), sources, people, timeline, quotes, figures, claims,
    angles: w.angles.map((a) => a.trim()).filter((a) => a !== ""), gaps: [...new Set(gaps)],
  });
  return { factSheet, invalidRefs: [...new Set(invalidRefs)], issues };
}
type FactSheetWireLike = FactSheetWire;

/**
 * Core → wire (prompts): stable, snake_case, ids kept. The names of minors and private victims never reach a prompt:
 * people[].name is replaced, and every free-text field (titles, summaries, made_by/against, quotes, sources, …) has
 * their name tokens replaced with "[private person P<n>]".
 */
export function factSheetToWire(f: FactSheet): FactSheetWire & { quotes: (FactSheetWire["quotes"][number] & { verification: string })[] } {
  const blocked = f.people.filter((p) => p.isMinorOrPrivateVictim);
  const shared = sharedNameTokens(f.people, blocked);
  const m = (s: string): string => maskPersons(s, blocked, shared);
  return {
    topic: m(f.topic), as_of: f.asOf, one_line_premise: m(f.oneLinePremise), central_question: m(f.centralQuestion),
    sources: f.sources.map((s) => ({
      id: s.id, url: m(s.url), title: m(s.title), publisher: s.publisher, published_at: s.publishedAt, source_type: s.sourceType,
      reliability: s.reliability, language: (["fr", "en", "es", "de", "it", "pt", "nl"].includes(s.language) ? s.language : "en") as "en",
    })),
    people: f.people.map((p) => ({
      id: p.id, name: p.isMinorOrPrivateVictim ? "[private person — never name]" : p.name, role_in_story: m(p.roleInStory), public_figure: p.publicFigure,
      is_minor_or_private_victim: p.isMinorOrPrivateVictim, image_queries: p.isMinorOrPrivateVictim ? [] : p.imageQueries.map(m),
    })),
    timeline: f.timeline.map((e) => ({
      id: e.id, date: e.date, title: m(e.title), what_happened: m(e.whatHappened), person_ids: e.personIds, status: e.status, source_ids: e.sourceIds, drama_value: e.dramaValue,
    })),
    quotes: f.quotes.map((q) => ({
      id: q.id, speaker_id: q.speakerId, verbatim: m(q.verbatim), language: (["fr", "en", "es", "de", "it", "pt", "nl"].includes(q.language) ? q.language : "en") as "en",
      date: q.date, context: m(q.context), medium: q.medium, source_id: q.sourceId, youtube_search_query: m(q.youtubeSearchQuery), verification: q.verification,
    })),
    figures: f.figures.map((n) => ({ id: n.id, label: m(n.label), value: n.value, unit: n.unit, as_of: n.asOf, source_ids: n.sourceIds, chartable: n.chartable })),
    claims: f.claims.map((c) => ({
      id: c.id, summary: m(c.summary), made_by: m(c.madeBy), against: m(c.against), status: c.status, jurisdiction: c.jurisdiction, decision_date: c.decisionDate,
      subject_response: m(c.subjectResponse), sensitivity: c.sensitivity, source_ids: c.sourceIds,
    })),
    angles: f.angles.map(m), gaps: f.gaps.map(m),
  };
}

// ---------------------------------------------------------------- style suggestion
export function styleSuggestionFromWire(
  w: StyleSuggestionWire,
  o: { styleIds: readonly string[]; stage: "idea" | "research"; source: "llm" | "fixture" },
): StyleSuggestion {
  const known = new Set(o.styleIds);
  const ranked = w.ranked
    .map((r) => ({ styleId: r.style_id.trim(), score: clamp(r.score > 1 ? r.score / 10 : r.score, 0, 1), why: r.why.trim() }))
    .filter((r, i, a) => (known.size === 0 || known.has(r.styleId)) && a.findIndex((x) => x.styleId === r.styleId) === i)
    .sort((a, b) => b.score - a.score);
  let recommended = w.recommended_style_id.trim();
  if (known.size > 0 && !known.has(recommended)) recommended = ranked[0]?.styleId ?? o.styleIds[0] ?? recommended;
  const flags = [...new Set(w.risk_flags)];
  const riskFlags: RiskFlag[] = flags.length > 1 ? flags.filter((f) => f !== "none") : flags;
  const accent = Color.safeParse(w.theme_override.accent.trim());
  const theme: ThemeOverride = {
    accent: accent.success ? accent.data : null,
    backdropRecipe: w.theme_override.backdrop_recipe === "" ? null : w.theme_override.backdrop_recipe,
    texture: w.theme_override.texture === "" ? null : w.theme_override.texture,
    fontHeadline: null,
  };
  const hasTheme = theme.accent !== null || theme.backdropRecipe !== null || theme.texture !== null;
  return StyleSuggestion.parse({
    schemaVersion: 1, topicType: w.topic_type, ranked, recommendedStyleId: recommended,
    recommendedMinutes: clamp(Math.round(w.recommended_minutes), 1, 60),
    titleOptions: w.title_options.map((t) => t.trim()).filter((t) => t !== ""),
    thumbnailTextOptions: w.thumbnail_text_options.map((t) => t.trim()).filter((t) => t !== ""),
    riskFlags, themeOverride: hasTheme ? theme : null, source: o.source, stage: o.stage,
  });
}

// ---------------------------------------------------------------- outline
/**
 * Placeholder for a chapter reference the model got wrong ("Act 3", "the end"): a valid id that is never a chapter of
 * the outline, so validateOutline reports teaser-unpaid / loop-unpaid and the repair round fixes it (no throw after a
 * paid call — a throw would replay identically on a plain retry, the parsed output being reused from its receipt).
 */
export const UNKNOWN_CHAPTER = "CH99";

export function outlineFromWire(
  w: OutlineWire,
  o: {
    lang: Lang; budget: Budget; budgets: Partial<Record<Lang, Budget>>; shapeId: string; avgCharsPerWord: number; generatedBy: "llm" | "fixture"; now: string;
    /** Receives a warning per dropped or unresolved reference. */
    issues?: LintIssue[];
  },
): Outline {
  const issues = o.issues ?? [];
  // chapter ids are positional (CH1..CHn); the model's ids only serve to remap its own references
  const remap = new Map<string, string>();
  w.chapters.forEach((c, i) => {
    const id = ids.chapter(i + 1);
    const n = normChapterId(c.id);
    if (n && !remap.has(n)) remap.set(n, id);
    if (!remap.has(c.id.trim())) remap.set(c.id.trim(), id);
  });
  const ch = (raw: string, path: string): string => {
    const v = remap.get(raw.trim()) ?? remap.get(normChapterId(raw) ?? "\u0000");
    if (v) return v;
    issues.push(warn("OUTLINE_UNKNOWN_CHAPTER", path, `unknown chapter "${raw}" (left unresolved for the repair round)`));
    return UNKNOWN_CHAPTER;
  };
  const cps = o.budget.charsPerSec;
  const refs = (raw: readonly string[], path: string, prefix: string): string[] => {
    const r = normRefsLenient(raw, prefix);
    if (r.dropped.length > 0) issues.push(warn("OUTLINE_BAD_REF", path, `dropped invalid ids ${r.dropped.map((d) => JSON.stringify(d)).join(", ")} (expected ${prefix}<n>)`));
    return r.ids;
  };
  const loops = (raw: readonly string[], path: string): string[] => {
    const out: string[] = [];
    for (const l of raw) {
      const v = normLoopId(l);
      if (v) {
        if (!out.includes(v)) out.push(v);
      } else if (l.trim() !== "") {
        issues.push(warn("OUTLINE_BAD_REF", path, `dropped invalid loop id "${l}"`));
      }
    }
    return out;
  };
  const chapters = w.chapters.map((c, i) => {
    const targetWords = Math.max(1, Math.round(c.target_words));
    return {
      id: ids.chapter(i + 1), act: c.act, title: c.title.trim(), targetSec: Math.max(0.1, round1((targetWords * o.avgCharsPerWord) / cps)), targetWords,
      purpose: c.purpose.trim(), eventIds: refs(c.event_ids, `chapters[${i}].event_ids`, "E"), claimIds: refs(c.claim_ids, `chapters[${i}].claim_ids`, "C"),
      quoteIds: refs(c.quote_ids, `chapters[${i}].quote_ids`, "Q"),
      opensLoops: loops(c.opens_loops, `chapters[${i}].opens_loops`), closesLoops: loops(c.closes_loops, `chapters[${i}].closes_loops`),
      exitHook: c.exit_hook.trim(), adBreakAfter: c.ad_break_after,
    };
  });
  const loopDefs = w.loops.flatMap((l, i) => {
    const id = normLoopId(l.id);
    if (!id) {
      issues.push(warn("OUTLINE_BAD_REF", `loops[${i}].id`, `dropped loop with invalid id "${l.id}"`));
      return [];
    }
    return [{ id, question: l.question.trim(), openedIn: ch(l.opened_in, `loops[${i}].opened_in`), closedIn: ch(l.closed_in, `loops[${i}].closed_in`) }];
  });
  return Outline.parse({
    schemaVersion: 1, lang: o.lang, title: w.title.trim(), thesis: w.thesis.trim(), thesisConfirmed: false, storyShape: o.shapeId,
    hookTeasers: w.hook_teasers.map((h, i) => ({ id: h.id.trim() || `T${i + 1}`, teaser: h.teaser.trim(), paidOffIn: ch(h.paid_off_in, `hook_teasers[${i}].paid_off_in`) })),
    loops: loopDefs,
    chapters, callbackPlan: w.callback_plan.map((c) => c.trim()).filter((c) => c !== ""), nextVideoBridge: w.next_video_bridge.trim(),
    budget: o.budget, budgets: o.budgets, generatedBy: o.generatedBy, updatedAt: o.now,
  });
}

/** Core outline → wire-like JSON for prompts (stable). */
export function outlineToWire(o: Outline): Record<string, unknown> {
  return {
    language: o.lang, story_shape: o.storyShape, title: o.title, thesis: o.thesis,
    hook_teasers: o.hookTeasers.map((h) => ({ id: h.id, teaser: h.teaser, paid_off_in: h.paidOffIn })),
    loops: o.loops.map((l) => ({ id: l.id, question: l.question, opened_in: l.openedIn, closed_in: l.closedIn })),
    chapters: o.chapters.map((c) => ({
      id: c.id, act: c.act, title: c.title, target_words: c.targetWords, target_sec: c.targetSec, purpose: c.purpose, event_ids: c.eventIds,
      claim_ids: c.claimIds, quote_ids: c.quoteIds, opens_loops: c.opensLoops, closes_loops: c.closesLoops, exit_hook: c.exitHook, ad_break_after: c.adBreakAfter,
    })),
    callback_plan: o.callbackPlan, next_video_bridge: o.nextVideoBridge,
  };
}

// ---------------------------------------------------------------- chapter script
export interface SkeletonLike { id: string; primaryHash?: string | null }

export function chapterFromWire(
  w: ChapterScriptWire,
  o: { chapterId: string; lang: Lang; primaryLang: Lang; knownFacts: ReadonlySet<string> | null; skeleton: readonly SkeletonLike[] | null; fallbackTitle: string },
): { chapter: ChapterScript; videoTitle: string | null; issues: LintIssue[] } {
  const issues: LintIssue[] = [];
  const secondary = o.lang !== o.primaryLang;
  // segment ids: skeleton (secondary) > valid unique ids of this chapter > positional assignment
  let segIds: string[];
  if (o.skeleton && o.skeleton.length === w.segments.length) {
    segIds = o.skeleton.map((s) => s.id);
  } else {
    const norm = w.segments.map((s) => normSegmentId(s.id));
    const ok = norm.every((n, i) => n !== null && n.startsWith(`${o.chapterId}-`) && norm.indexOf(n) === i);
    segIds = ok ? (norm as string[]) : w.segments.map((_, i) => ids.segment(o.chapterId, i + 1));
    if (!ok) issues.push(warn("SEG_IDS_ASSIGNED", o.chapterId, "segment ids were missing or invalid; assigned in order"));
  }
  const segments: ScriptSegment[] = w.segments.map((s, i) => {
    const id = segIds[i]!;
    const isNarr = s.type === "narration";
    const isClip = s.type === "clip";
    let text = isNarr || isClip ? s.text.trim().replace(/[ \t]+/g, " ") : "";
    if (isNarr && o.lang === "fr") text = applyFrTypography(text);
    const lenient = normRefsLenient(s.fact_ids);
    if (lenient.dropped.length > 0) issues.push(warn("UNKNOWN_FACT_REF", id, `dropped invalid fact ids ${lenient.dropped.map((d) => JSON.stringify(d)).join(", ")}`));
    const facts = lenient.ids;
    const factIds = o.knownFacts ? facts.filter((f) => o.knownFacts!.has(f)) : facts;
    if (factIds.length !== facts.length) {
      issues.push(warn("UNKNOWN_FACT_REF", id, `dropped unknown fact ids ${facts.filter((f) => !factIds.includes(f)).join(", ")}`));
    }
    const quoteRef = isClip ? normRefsLenient([s.quote_id], "Q") : { ids: [], dropped: [] };
    if (quoteRef.dropped.length > 0) issues.push(warn("UNKNOWN_FACT_REF", id, `invalid clip quote id ${JSON.stringify(s.quote_id)}`));
    const quoteId = quoteRef.ids[0] ?? null;
    if (isClip && quoteId && !factIds.includes(quoteId)) factIds.push(quoteId);
    const skel = secondary && o.skeleton && o.skeleton.length === w.segments.length ? o.skeleton[i] : undefined;
    return {
      id, type: s.type, displayText: text, ttsText: "", ttsTextEdited: false, quoteId,
      subtitleTranslation: isClip ? s.subtitle_translation.trim() : "", factIds, device: s.device,
      breathMs: s.type === "music_breath" ? 2000 : 0, primaryHash: skel?.primaryHash ?? null,
    };
  });
  const loops = (xs: string[]) => [...new Set(xs.map((l) => normLoopId(l)).filter((l): l is string => l !== null))];
  return {
    chapter: {
      chapterId: o.chapterId, title: w.title.trim() || o.fallbackTitle, segments, loopsOpened: loops(w.loops_opened), loopsClosed: loops(w.loops_closed),
      summaryForNext: w.summary_for_next.trim(), userEdited: false, locked: false,
    },
    videoTitle: nullIfEmpty(w.video_title),
    issues,
  };
}

// ---------------------------------------------------------------- word anchors (§4.6)
/**
 * Resolves wire words to display-word indexes within `text`: first occurrence at or after the previous anchor
 * (then anywhere); "" → -1 (beat start); not found → -1 and a warning.
 */
export function resolveAnchors(text: string, words: readonly string[], where: string): { idx: number[]; issues: LintIssue[] } {
  const toks = tokenizeDisplay(text);
  const issues: LintIssue[] = [];
  let prev = 0;
  const idx = words.map((w) => {
    if (w.trim() === "") return -1;
    const first = tokenizeDisplay(w)[0]?.norm ?? normWord(w);
    let at = toks.findIndex((t, i) => i >= prev && t.norm === first);
    if (at < 0) at = toks.findIndex((t) => t.norm === first);
    if (at < 0) {
      issues.push(warn("CUE_ANCHOR", where, `anchor word "${w}" not found in the beat text`));
      return -1;
    }
    prev = at;
    return at;
  });
  return { idx, issues };
}

/** Emphasis words → 0–3 unique display-word indexes. */
export function resolveEmphasis(text: string, words: readonly string[]): number[] {
  const { idx } = resolveAnchors(text, words, "");
  return [...new Set(idx.filter((i) => i >= 0))].slice(0, 3);
}

// ---------------------------------------------------------------- fact-check
export function factCheckItemsFromWire(
  w: FactCheckWire,
  o: { idOf: (where: string, sentence: string, claimKind: string) => string; validWhere: (where: string) => string | null },
): FactCheckItem[] {
  const out: FactCheckItem[] = [];
  for (const it of w.items) {
    const where = o.validWhere(it.where) ?? o.validWhere(it.segment_id);
    if (!where) continue; // an item that points nowhere cannot be shown or fixed
    const id = o.idOf(where, it.sentence, it.claim_kind);
    if (out.some((x) => x.id === id)) continue;
    out.push({
      id, where, surface: it.surface, sentence: it.sentence.trim(), claimKind: it.claim_kind, verdict: it.verdict, risk: it.risk,
      factIds: it.fact_ids.map((f) => normRef(f, "fact_ids") ?? "").filter((f) => f !== ""), problem: it.problem.trim(),
      suggestedRewrite: it.suggested_rewrite.trim(), origin: "llm", rule: null, resolution: "open", note: "",
    });
  }
  return out;
}

// ---------------------------------------------------------------- rerank, passage, transcreate
export interface RerankScore {
  vision: number; technical: number; watermark: boolean; nsfw: boolean;
  focal: { x: number; y: number }; safeCrop: { x: number; y: number; w: number; h: number }; notes: string;
}
/** Maps "Image N" (1-based) entries onto `count` slots; missing images get null. */
export function rerankFromWire(w: RerankWire, count: number): (RerankScore | null)[] {
  const out: (RerankScore | null)[] = Array.from({ length: count }, () => null);
  const zeroBased = w.images.some((im) => im.index === 0);
  for (const im of w.images) {
    const slot = Math.round(im.index) - (zeroBased ? 0 : 1);
    if (slot < 0 || slot >= count || out[slot]) continue;
    const cw = clamp(im.crop_w, 0.05, 1);
    const chh = clamp(im.crop_h, 0.05, 1);
    out[slot] = {
      vision: clamp(im.relevance, 0, 10) / 10, technical: clamp(im.technical_quality, 0, 10) / 10,
      watermark: im.has_watermark_or_burned_text, nsfw: im.nsfw,
      focal: { x: clamp(im.focal_x, 0, 1), y: clamp(im.focal_y, 0, 1) },
      safeCrop: { x: clamp(im.crop_x, 0, 1 - cw), y: clamp(im.crop_y, 0, 1 - chh), w: cw, h: chh },
      notes: im.notes.trim(),
    };
  }
  return out;
}

export function passageFromWire(w: PassageWire, indexes: readonly number[]): { bestIndex: number; confidence: number } {
  const best = Math.round(w.best_index);
  if (!indexes.includes(best)) return { bestIndex: indexes[0] ?? -1, confidence: 0 };
  return { bestIndex: best, confidence: clamp(w.confidence > 1 ? w.confidence / 10 : w.confidence, 0, 1) };
}

export function transcreateFromWire(w: TranscreateWire, lang: Lang, type: ScriptSegment["type"]): { displayText: string; subtitleTranslation: string } {
  let displayText = w.display_text.trim();
  if (lang === "fr" && type === "narration") displayText = applyFrTypography(displayText);
  return { displayText, subtitleTranslation: type === "clip" ? w.subtitle_translation.trim() : "" };
}
