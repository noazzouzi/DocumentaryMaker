// Step 6 fact-check (LLM per chapter + deterministic rules a–h, resolutions carried over) and 6b recheck.
import {
  FactCheck, FactSheet, hashJson, type BeatPlansDoc, type BeatSlicesDoc, type PublishInfo, type RiskFlag, type Script, type Source,
} from "@docmaker/core";
import { carryOverResolutions, deterministicFactChecks, factCheckId } from "../factcheck/rules";
import { splitSentences } from "../lexicon";
import { EDITORIAL_RULES } from "../prompts/rules";
import { FACTCHECK_EXTRA, FACTCHECK_USER, RECHECK_STRUCT_USER, RECHECK_USER } from "../prompts/steps";
import { json } from "../prompts/system";
import { motionStrings } from "../text";
import type { StepCtx } from "../types";
import { normBeatId, normSegmentId } from "../wire/ids";
import { factCheckItemsFromWire, factSheetToWire } from "../wire/map";
import { FactCheckWire, RecheckWire } from "../wire/schemas";
import { chapterToWire } from "./write";
import { call, nowIso } from "./common";
import { sourceListText } from "./research";

export async function factCheck(ctx: StepCtx, i: {
  script: Script; slices: BeatSlicesDoc; plans: BeatPlansDoc; factSheet: FactSheet; publish: PublishInfo | null;
  previous: FactCheck | null; riskFlags: RiskFlag[]; scriptHash: string; slicesHash: string; personAcks?: readonly string[];
}): Promise<FactCheck> {
  const lang = i.script.lang;
  const system = [
    { text: `You are the fact-checker and the defamation lawyer of a documentary YouTube channel (${lang}).\n${EDITORIAL_RULES(lang, i.factSheet.asOf)}`, cache: false },
    { text: `<fact_sheet>${json(factSheetToWire(i.factSheet))}</fact_sheet>`, cache: true },
  ];
  const textOf = new Map(i.slices.texts.filter((t) => t.lang === lang).map((t) => [t.beatId, t]));
  const llmItems: FactCheck["items"] = [];
  const needs = new Set<string>();
  const ttIssues = new Set<string>();
  const total = i.script.chapters.length;
  for (const [k, ch] of i.script.chapters.entries()) {
    ctx.progress(k / Math.max(1, total), `fact-check ${ch.chapterId}`);
    const segIds = new Set(ch.segments.map((s) => s.id));
    const beats = i.plans.plans.filter((p) => p.chapterId === ch.chapterId);
    const beatIds = new Set(beats.map((b) => b.id));
    const narration = ch.segments.flatMap((s) =>
      s.type === "narration" ? splitSentences(s.displayText).map((sentence) => ({ where: s.id, sentence }))
        : s.type === "clip" ? [{ where: s.id, sentence: s.displayText, clip_quote_id: s.quoteId ?? "", subtitle: s.subtitleTranslation }] : [],
    );
    const onScreen = beats.flatMap((b) => {
      const t = textOf.get(b.id);
      const strings = [...new Set([t?.onScreenText ?? "", ...motionStrings(t?.motionData ?? {})].map((x) => x.trim()).filter((x) => x !== ""))];
      return strings.map((text) => ({ where: b.id, text, person_ids: b.personIds, fact_ids: b.factIds }));
    });
    const publish = k === 0 && i.publish ? i.publish : { title: "", thumbnailText: "", description: "" };
    const wire = await call(ctx, {
      step: "factcheck", key: `${lang}.${ch.chapterId}`, schema: FactCheckWire, effort: "high", maxTokens: 16000, lang, system,
      user: FACTCHECK_USER(json(chapterToWire(ch)), publish.title, publish.thumbnailText)
        + FACTCHECK_EXTRA({ narrationJson: json(narration), onScreenJson: json(onScreen), publishJson: json(publish) }),
    });
    const validWhere = (w: string): string | null => {
      const t = w.trim();
      if (["title", "thumbnail", "description"].includes(t.toLowerCase())) return t.toLowerCase();
      const seg = normSegmentId(t);
      if (seg && segIds.has(seg)) return seg;
      const beat = normBeatId(t);
      if (beat && beatIds.has(beat)) return beat;
      return null;
    };
    llmItems.push(...factCheckItemsFromWire(wire, { idOf: (w, s, kind) => factCheckId(w, s, kind, "llm"), validWhere }));
    for (const q of wire.needs_more_research) if (q.trim()) needs.add(q.trim());
    for (const q of wire.title_thumbnail_issues) if (q.trim()) ttIssues.add(q.trim());
  }
  const det = deterministicFactChecks({
    script: i.script, slices: i.slices, plans: i.plans, factSheet: i.factSheet, publish: i.publish, riskFlags: i.riskFlags, personAcks: i.personAcks,
  });
  const merged = [...det, ...llmItems.filter((x) => !det.some((d) => d.id === x.id))];
  ctx.progress(1, "fact-check done");
  return FactCheck.parse({
    schemaVersion: 1, lang, scriptHash: i.scriptHash, slicesHash: i.slicesHash, publishHash: hashJson(i.publish ?? null),
    items: carryOverResolutions(merged, i.previous), needsMoreResearch: [...needs], titleThumbnailIssues: [...ttIssues], createdAt: nowIso(),
  });
}

/** 6b: re-research the status of pending claims (web_search ≤ 10), then a structured delta merged into the fact sheet. */
/**
 * `changed`: re-checked claims whose status (or decision date, subject response) changed. `checked`: every requested claim
 * the structured output actually covered (changed or not) — a claim the output omitted was NOT re-checked.
 */
export async function recheck(ctx: StepCtx, i: { factSheet: FactSheet; claimIds: string[]; asOf: string }): Promise<{ factSheet: FactSheet; changed: string[]; checked: string[] }> {
  const targets = i.factSheet.claims.filter((c) => i.claimIds.includes(c.id));
  if (targets.length === 0) return { factSheet: i.factSheet, changed: [], checked: [] };
  const claimsJson = json(targets.map((c) => ({
    id: c.id, summary: c.summary, made_by: c.madeBy, against: c.against, status: c.status, jurisdiction: c.jurisdiction,
    decision_date: c.decisionDate, subject_response: c.subjectResponse, as_of: c.asOf,
  })));
  const system = [{ text: `You are the lead researcher of a documentary YouTube channel, re-checking legal statuses before publication.\n${EDITORIAL_RULES("en", i.asOf)}`, cache: true }];
  const notes = await ctx.llm.research(
    { topic: i.factSheet.topic, langs: ["en"], minutes: 0, asOf: i.asOf, maxSearches: 10, maxFetches: 0, system, user: RECHECK_USER(claimsJson, i.asOf), resumeTurns: [], onTurn: async () => {} },
    { signal: ctx.signal, costs: ctx.costs, newRequest: ctx.newRequest, progress: ctx.progress },
  );
  const wire = await call(ctx, {
    step: "recheck", key: "", schema: RecheckWire, effort: "high", maxTokens: 32000, lang: null, system,
    user: RECHECK_STRUCT_USER(notes.dossierMarkdown, claimsJson, sourceListText(notes.registry)),
  });
  const sources: Source[] = [...i.factSheet.sources];
  const nextSourceId = () => `S${sources.reduce((m, s) => Math.max(m, Number(s.id.slice(1))), 0) + 1}`;
  const byUrl = new Map(notes.registry.map((r) => [r.url, r]));
  const changed: string[] = [];
  const checked: string[] = [];
  const claims = i.factSheet.claims.map((c) => {
    const w = wire.claims.find((x) => x.id.trim().toUpperCase() === c.id);
    if (!w || !i.claimIds.includes(c.id)) return c;
    checked.push(c.id);
    const sourceIds = [...c.sourceIds];
    for (const url of w.source_urls) {
      const r = byUrl.get(url.trim());
      if (!r) continue; // only URLs the API returned
      let s = sources.find((x) => x.url === r.url);
      if (!s) {
        s = {
          id: nextSourceId(), url: r.url, title: r.title, publisher: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ""); } catch { return ""; } })(),
          publishedAt: r.pageAge ?? "", sourceType: "other", reliability: "medium", language: "", fetched: r.fetched, cited: r.cited, snippets: r.snippets.slice(0, 5),
        };
        sources.push(s);
      }
      if (!sourceIds.includes(s.id)) sourceIds.push(s.id);
    }
    const next = {
      ...c, status: w.status, jurisdiction: w.jurisdiction.trim() || c.jurisdiction, decisionDate: w.decision_date.trim() || c.decisionDate,
      subjectResponse: w.subject_response.trim() || c.subjectResponse, asOf: i.asOf, sourceIds,
    };
    if (w.changed || next.status !== c.status || next.decisionDate !== c.decisionDate || next.subjectResponse !== c.subjectResponse) changed.push(c.id);
    return next;
  });
  return { factSheet: FactSheet.parse({ ...i.factSheet, sources, claims }), changed, checked };
}
