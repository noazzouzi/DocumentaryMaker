// Steps 1b–4: fact sheet, style suggestion, outline, chapters (write / revise / transcreate).
import {
  hashJson, type Budget, type ChapterScript, type FactSheet, type Lang, type LintIssue, type Outline, type RegistryDoc,
  type ResearchDossier, type RiskFlag, type Script, type StylePlugin, type StyleSuggestion,
} from "@docmaker/core";
import { findShape } from "../budget";
import { validateOutline } from "../lint";
import { EDITORIAL_RULES } from "../prompts/rules";
import {
  CHAPTER_FIRST, CHAPTER_SECONDARY, CHAPTER_USER, FACTSHEET_USER, OUTLINE_USER, RESEARCH_ROLE, REVISE_USER, STYLE_USER, TRANSCREATE_USER,
} from "../prompts/steps";
import { buildSystem, json } from "../prompts/system";
import type { ChapterInput, SegmentSkeleton, StepCtx, StyleCatalogEntry } from "../types";
import { chapterFromWire, factSheetFromWire, outlineFromWire, styleSuggestionFromWire, transcreateFromWire } from "../wire/map";
import { ChapterScriptWire, FactSheetWire, StyleSuggestionWire, TranscreateWire, buildOutlineWire, type OutlineWire } from "../wire/schemas";
import { sourceListText } from "./research";
import { call, nowIso, tryRepair } from "./common";

// ---------------------------------------------------------------- 1b fact sheet
export async function buildFactSheet(ctx: StepCtx, i: { dossier: ResearchDossier; registry: RegistryDoc; asOf: string; topic: string }): Promise<{ factSheet: FactSheet; invalidRefs: string[] }> {
  const lang = (i.dossier.searchLanguages.find((l) => l === "en" || l === "fr") ?? "en") as Lang;
  const wire = await call(ctx, {
    step: "factsheet", key: "", schema: FactSheetWire, effort: "high", maxTokens: 32000, lang: null,
    system: [{ text: `${RESEARCH_ROLE}\n${EDITORIAL_RULES(lang, i.asOf)}`, cache: true }],
    user: FACTSHEET_USER(i.dossier.markdown, sourceListText(i.registry.entries), i.asOf),
  });
  const r = factSheetFromWire(wire, { registry: i.registry.entries, asOf: i.asOf, topic: i.topic });
  for (const x of r.issues) ctx.logger.warn(x.msg, { rule: x.rule, where: x.where });
  return { factSheet: r.factSheet, invalidRefs: r.invalidRefs };
}

// ---------------------------------------------------------------- 2 style
export async function suggestStyle(ctx: StepCtx, i: { idea: string; styles: StyleCatalogEntry[]; factSummary: string | null; stage: "idea" | "research" }): Promise<StyleSuggestion> {
  const registry = json(i.styles.map((s) => ({ id: s.id, names: s.names, description: s.description, best_for: s.bestFor })));
  const topic = i.factSummary ? `${i.idea}\n<fact_summary>${i.factSummary}</fact_summary>` : i.idea;
  const wire = await call(ctx, {
    step: "style", key: "", schema: StyleSuggestionWire, effort: "low", maxTokens: i.stage === "idea" ? 2000 : 4000, lang: null,
    system: [{ text: "You are the editor-in-chief of a documentary YouTube studio. You match each topic with the edit style that serves it best, and you flag editorial risks honestly.", cache: true }],
    user: STYLE_USER(topic, registry) + (i.stage === "research" ? "\nAlso propose theme_override: an accent colour, backdrop and texture themed to the topic ('' keeps the style's)." : ""),
  });
  return styleSuggestionFromWire(wire, { styleIds: i.styles.map((s) => s.id), stage: i.stage, source: ctx.llm.kind === "fixture" ? "fixture" : "llm" });
}

// ---------------------------------------------------------------- 3 outline
export async function writeOutline(ctx: StepCtx, i: { factSheet: FactSheet; style: StylePlugin; budget: Budget; budgets: Partial<Record<Lang, Budget>>; shapeId: string; lang: Lang; riskFlags: RiskFlag[] }): Promise<Outline> {
  const profile = i.style.data.scriptProfile;
  const shape = findShape(profile, i.shapeId);
  const schema = buildOutlineWire(shape.acts.map((a) => a.id));
  const system = buildSystem({ style: i.style, lang: i.lang, asOf: i.factSheet.asOf, riskFlags: i.riskFlags, factSheet: i.factSheet });
  const budgetJson = json({ ...i.budget, story_shape: { id: shape.id, acts: shape.acts.map((a) => ({ id: a.id, share: a.share, purpose: a.purpose, words: i.budget.perAct[a.id] ?? 0 })) } });
  const user = OUTLINE_USER(budgetJson, i.lang) + `\nUse story_shape "${shape.id}" and exactly ${i.budget.chapters} chapters; the sum of target_words must be ${i.budget.words} (± 5 %).`;
  const map = (w: OutlineWire) => {
    const issues: LintIssue[] = [];
    const o = outlineFromWire(w, {
      lang: i.lang, budget: i.budget, budgets: i.budgets, shapeId: shape.id, avgCharsPerWord: profile.avgCharsPerWord[i.lang],
      generatedBy: ctx.llm.kind === "fixture" ? "fixture" : "llm", now: nowIso(), issues,
    });
    for (const x of issues) ctx.logger.warn(`outline: ${x.msg}`, { rule: x.rule, where: x.where });
    return o;
  };
  let outline = map(await call(ctx, { step: "outline", key: "", schema, effort: "high", maxTokens: 16000, lang: i.lang, system, user }));
  const errors = validateOutline(outline, i.style.data).filter((x) => x.level === "error");
  if (errors.length > 0) {
    ctx.logger.warn("outline failed validation; one repair round", { errors: errors.length });
    const repaired = await tryRepair(() => call(ctx, {
      step: "outline", key: "repair", schema, effort: "high", maxTokens: 16000, lang: i.lang, system,
      user: `${user}\n<previous_outline_issues>${json(errors)}</previous_outline_issues>\nFix every issue and return the full outline.`,
    }));
    if (repaired) {
      const o2 = map(repaired);
      if (validateOutline(o2, i.style.data).filter((x) => x.level === "error").length < errors.length) outline = o2;
    }
  }
  return outline;
}

// ---------------------------------------------------------------- 4 chapters
export function chapterToWire(ch: ChapterScript, videoTitle = ""): Record<string, unknown> {
  return {
    chapter_id: ch.chapterId, title: ch.title, video_title: videoTitle,
    segments: ch.segments.map((s) => ({
      id: s.id, type: s.type, text: s.displayText, quote_id: s.quoteId ?? "", fact_ids: s.factIds, device: s.device, subtitle_translation: s.subtitleTranslation,
    })),
    loops_opened: ch.loopsOpened, loops_closed: ch.loopsClosed, summary_for_next: ch.summaryForNext,
  };
}

/** Skeleton of a primary chapter for the secondary languages (with primaryHash = hashJson(displayText)). */
export function segmentSkeleton(ch: ChapterScript): SegmentSkeleton[] {
  return ch.segments.map((s) => ({
    id: s.id, type: s.type, device: s.device, quoteId: s.quoteId, factIds: s.factIds, approxChars: s.displayText.length, primaryHash: hashJson(s.displayText),
  }));
}

function knownFacts(fs: FactSheet): Set<string> {
  return new Set([...fs.sources, ...fs.people, ...fs.timeline, ...fs.figures, ...fs.claims, ...fs.quotes].map((x) => x.id));
}

function chapterPrompt(i: ChapterInput): { system: ReturnType<typeof buildSystem>; user: string } {
  const system = buildSystem({ style: i.style, lang: i.lang, asOf: i.factSheet.asOf, riskFlags: i.riskFlags, factSheet: i.factSheet, outline: i.outline });
  const idx = i.outline.chapters.findIndex((c) => c.id === i.plan.id);
  const before = new Set(i.outline.chapters.slice(0, Math.max(0, idx)).map((c) => c.id));
  const openLoops = i.outline.loops.filter((l) => (before.has(l.openedIn) || l.openedIn === i.plan.id) && !before.has(l.closedIn));
  const planWire = {
    id: i.plan.id, act: i.plan.act, title: i.plan.title, target_words: i.targetWords, target_sec: i.plan.targetSec, purpose: i.plan.purpose,
    event_ids: i.plan.eventIds, claim_ids: i.plan.claimIds, quote_ids: i.plan.quoteIds, opens_loops: i.plan.opensLoops, closes_loops: i.plan.closesLoops,
    exit_hook: i.plan.exitHook, ad_break_after: i.plan.adBreakAfter,
  };
  let user = CHAPTER_USER({
    chapterJson: json(planWire), previousTail: i.previousTail.join("\n"), storySoFar: i.storySoFar.join("\n"),
    openLoops: json(openLoops.map((l) => ({ id: l.id, question: l.question, closed_in: l.closedIn }))), targetWords: i.targetWords, lang: i.lang,
  });
  if (i.skeleton && i.lang !== i.primaryLang) {
    user += CHAPTER_SECONDARY(json(i.skeleton.map((s) => ({ id: s.id, type: s.type, device: s.device, quote_id: s.quoteId ?? "", fact_ids: s.factIds, approx_chars: s.approxChars }))), i.lang);
  }
  if (idx === 0) user += CHAPTER_FIRST(i.lang);
  return { system, user };
}

/** writeChapter + the video title (first chapter only) and mapping notes. */
export async function writeChapterWithTitle(ctx: StepCtx, i: ChapterInput): Promise<{ chapter: ChapterScript; videoTitle: string | null; issues: LintIssue[] }> {
  const { system, user } = chapterPrompt(i);
  const wire = await call(ctx, { step: "chapter", key: `${i.lang}.${i.plan.id}`, schema: ChapterScriptWire, effort: "high", maxTokens: 16000, lang: i.lang, system, user });
  return chapterFromWire(wire, {
    chapterId: i.plan.id, lang: i.lang, primaryLang: i.primaryLang, knownFacts: knownFacts(i.factSheet), skeleton: i.lang !== i.primaryLang ? i.skeleton : null,
    fallbackTitle: i.plan.title,
  });
}

export async function writeChapter(ctx: StepCtx, i: ChapterInput): Promise<ChapterScript> {
  return (await writeChapterWithTitle(ctx, i)).chapter;
}

export async function reviseChapter(ctx: StepCtx, i: ChapterInput & { chapter: ChapterScript; issues: LintIssue[] }): Promise<ChapterScript> {
  const { system, user: chapterUser } = chapterPrompt(i);
  const relevant = i.issues.filter((x) => x.level === "error" || x.rule === "lang-parity");
  const user = `${chapterUser}\n${REVISE_USER(json(chapterToWire(i.chapter)), json(relevant))}`;
  const wire = await call(ctx, { step: "revise", key: `${i.lang}.${i.plan.id}`, schema: ChapterScriptWire, effort: "high", maxTokens: 16000, lang: i.lang, system, user });
  // revisions keep segment ids: the secondary skeleton, else the current chapter's ids
  const skeleton = i.lang !== i.primaryLang && i.skeleton
    ? i.skeleton
    : i.chapter.segments.map((s) => ({ id: s.id, primaryHash: s.primaryHash }));
  const r = chapterFromWire(wire, {
    chapterId: i.plan.id, lang: i.lang, primaryLang: i.primaryLang, knownFacts: knownFacts(i.factSheet), skeleton, fallbackTitle: i.chapter.title,
  });
  return { ...r.chapter, userEdited: i.chapter.userEdited, locked: i.chapter.locked };
}

/** Out-of-sync secondary segment (primaryHash mismatch): cheap, cost-gated transcreation of ONE segment. */
export async function transcreateSegment(ctx: StepCtx, i: {
  primary: Script["chapters"][number]["segments"][number]; current: Script["chapters"][number]["segments"][number]; lang: Lang; style: StylePlugin; factSheet: FactSheet;
  riskFlags?: readonly RiskFlag[];
}): Promise<{ displayText: string; subtitleTranslation: string }> {
  const seg = (s: typeof i.primary) => ({ id: s.id, type: s.type, text: s.displayText, quote_id: s.quoteId ?? "", subtitle_translation: s.subtitleTranslation, fact_ids: s.factIds });
  const wire = await call(ctx, {
    step: "transcreate", key: `${i.lang}.${i.current.id}`, schema: TranscreateWire, effort: "low", maxTokens: 2000, lang: i.lang,
    system: buildSystem({ style: i.style, lang: i.lang, asOf: i.factSheet.asOf, riskFlags: i.riskFlags ?? [], factSheet: i.factSheet }),
    user: TRANSCREATE_USER({ primaryJson: json(seg(i.primary)), currentJson: json(seg(i.current)), lang: i.lang }),
  });
  const r = transcreateFromWire(wire, i.lang, i.current.type);
  // a clip's display text is the verbatim quote: never replaced by the model
  return i.current.type === "clip" ? { displayText: i.primary.displayText, subtitleTranslation: r.subtitleTranslation } : r;
}
