// Test helpers: fakes (cost tracker, logger, style plugin) and an offline fixture pipeline (FixtureLlm end to end).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BeatPlansDoc, BeatSlicesDoc, DocmakerError, FixtureManifest, Script, docHash, hashJson, type BeatLang, type BeatPlan, type ChapterScript, type CostTracker,
  type FactCheck, type FactSheet, type Lang, type Logger, type Outline, type Receipt, type RegistryDoc, type ResearchDossier, type StylePlugin,
  type StyleSuggestion,
} from "@docmaker/core";
import { findRepoRoot } from "@docmaker/core/node";
import { TEST_NOW, TEST_STYLE } from "@docmaker/core/testing";
import {
  FixtureLlm, assembleBeatPlans, buildFactSheet, factCheck, planBeats, planBudget, runResearch, segmentSkeleton, sliceBeats, suggestStyle,
  writeChapterWithTitle, writeOutline, type LlmClient, type StepCtx,
} from "../src/index";

export const REPO = findRepoRoot(process.cwd());
export const fixtureDir = (id: string) => join(REPO, "fixtures", id);

export const silentLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {},
  child() {
    return silentLogger;
  },
};

export class FakeCosts implements CostTracker {
  receipts: Receipt[] = [];
  budgetChecks = 0;
  failBudget = false;
  async estimate(): Promise<never> {
    throw new DocmakerError("INTERNAL", "not used in tests");
  }
  async findReceipt(fp: string): Promise<Receipt | null> {
    return this.receipts.find((r) => r.fingerprint === fp) ?? null;
  }
  async record(r: Omit<Receipt, "createdAt" | "jobId">): Promise<Receipt> {
    const full: Receipt = { ...r, createdAt: TEST_NOW, jobId: null };
    this.receipts.push(full);
    return full;
  }
  spentUsd(): number {
    return this.receipts.reduce((a, r) => a + r.costUsd, 0);
  }
  spentTotalUsd(): number {
    return this.spentUsd();
  }
  assertWithinBudget(): void {
    this.budgetChecks++;
    if (this.failBudget) throw new DocmakerError("BUDGET_EXCEEDED", "over budget");
  }
}

export const TEST_PLUGIN: StylePlugin = {
  data: TEST_STYLE,
  promptPack: {
    qualityDirective: "Every shot earns its place.", visualGrammar: "archival > clip > motion graphic > stock",
    narratorPersona: { en: "Dry, precise, ironic.", fr: "Sec, précis, ironique." }, styleMd: "# STYLE", guideMd: "# GUIDE",
  },
  dir: "/tmp/style", source: "builtin", fonts: [], dataHash: "0".repeat(64),
};

export function makeCtx(llm: LlmClient, costs = new FakeCosts()): StepCtx & { costs: FakeCosts } {
  return { llm, signal: new AbortController().signal, costs, logger: silentLogger, progress: () => {}, newRequest: false };
}

export interface PipelineResult {
  ctx: StepCtx & { costs: FakeCosts };
  registry: RegistryDoc; dossier: ResearchDossier; factSheet: FactSheet; style: StyleSuggestion; outline: Outline;
  scripts: Record<Lang, Script>; plans: BeatPlansDoc; slices: Record<Lang, BeatSlicesDoc>;
  planIssues: { chapterId: string; method: string; issues: import("@docmaker/core").LintIssue[] }[];
  sliceIssues: { chapterId: string; method: string; issues: import("@docmaker/core").LintIssue[] }[];
  factChecks: Record<Lang, FactCheck>;
}

/** Runs every LLM step of the offline demo on a fixture (EN primary + FR secondary). */
export async function runFixturePipeline(id: string, o?: { asOf?: string; minutes?: number; style?: StylePlugin }): Promise<PipelineResult> {
  const plugin = o?.style ?? TEST_PLUGIN;
  const llm = new FixtureLlm(fixtureDir(id));
  const ctx = makeCtx(llm);
  const manifest = FixtureManifest.parse(JSON.parse(readFileSync(join(fixtureDir(id), "fixture.json"), "utf8")));
  const asOf = o?.asOf ?? manifest.asOf;
  const minutes = o?.minutes ?? manifest.targetMinutes;
  const langs = manifest.languages;
  const research = await runResearch(ctx, { topic: id, langs, minutes, asOf, resumeTurns: [], onTurn: async () => {} });
  const registry: RegistryDoc = { schemaVersion: 1, entries: research.registry };
  const dossier: ResearchDossier = {
    schemaVersion: 1, topic: id, asOf, searchLanguages: langs, markdown: research.dossierMarkdown, searchesUsed: research.searchesUsed,
    fetchesUsed: research.fetchesUsed, turns: research.turns, rawFiles: [], generatedBy: "fixture",
  };
  const { factSheet } = await buildFactSheet(ctx, { dossier, registry, asOf, topic: id });
  const style = await suggestStyle(ctx, {
    idea: id, factSummary: factSheet.oneLinePremise, stage: "research",
    styles: [{ id: "drama-commentary", names: { en: "Drama", fr: "Drama" }, description: { en: "", fr: "" }, bestFor: ["history"] }],
  });
  const profile = plugin.data.scriptProfile;
  const budgets = { en: planBudget(minutes, "en", profile, "rise-fall"), fr: planBudget(minutes, "fr", profile, "rise-fall") };
  const outline = await writeOutline(ctx, { factSheet, style: plugin, budget: budgets.en, budgets, shapeId: "rise-fall", lang: "en", riskFlags: style.riskFlags });

  const chapters: Record<Lang, ChapterScript[]> = { en: [], fr: [] };
  const titles: Record<Lang, string> = { en: outline.title, fr: outline.title };
  for (const lang of langs) {
    const story: string[] = [];
    let tail: string[] = [];
    for (const plan of outline.chapters) {
      const primary = chapters.en.find((c) => c.chapterId === plan.id) ?? null;
      const r = await writeChapterWithTitle(ctx, {
        lang, primaryLang: "en", outline, plan, factSheet, style: plugin, storySoFar: story, previousTail: tail,
        skeleton: lang === "fr" && primary ? segmentSkeleton(primary) : null, targetWords: plan.targetWords, riskFlags: [],
      });
      if (r.videoTitle) titles[lang] = r.videoTitle;
      chapters[lang].push({ ...r.chapter, segments: r.chapter.segments.map((s) => ({ ...s, ttsText: s.type === "narration" ? s.displayText : "" })) });
      story.push(r.chapter.summaryForNext);
      tail = r.chapter.segments.filter((s) => s.type === "narration").slice(-2).map((s) => s.displayText);
    }
  }
  const scripts = Object.fromEntries(langs.map((lang) => [lang, Script.parse({
    schemaVersion: 1, lang, outlineHash: hashJson(outline), title: titles[lang], chapters: chapters[lang], lint: [], generatedBy: "fixture", updatedAt: TEST_NOW,
  })])) as Record<Lang, Script>;

  const planned: BeatPlan[] = [];
  const primaryTexts: BeatLang[] = [];
  const planIssues: PipelineResult["planIssues"] = [];
  for (const ch of scripts.en.chapters) {
    const r = await planBeats(ctx, { chapter: ch, factSheet, style: plugin, isHook: ch.chapterId === "CH1", lang: "en", startOrder: planned.length });
    planned.push(...r.plans);
    primaryTexts.push(...r.texts);
    planIssues.push({ chapterId: ch.chapterId, method: r.method, issues: r.issues });
  }
  const assembled = assembleBeatPlans(scripts.en, planned, langs);
  const enTexts = [...primaryTexts, ...assembled.texts.filter((t) => t.lang === "en")];
  const plans = BeatPlansDoc.parse({
    schemaVersion: 1, primaryLang: "en",
    chapters: scripts.en.chapters.map((c) => ({
      chapterId: c.chapterId, skeletonHash: hashJson(c.segments.map((s) => ({ id: s.id, type: s.type, quoteId: s.quoteId }))),
      textHash: hashJson(c.segments.map((s) => s.displayText)), method: "fixture",
    })),
    plans: assembled.plans, primary: enTexts, generatedBy: "fixture", updatedAt: TEST_NOW,
  });
  const order = new Map(plans.plans.map((p) => [p.id, p.order]));
  const sortTexts = (ts: BeatLang[]) => [...ts].sort((a, b) => (order.get(a.beatId) ?? 0) - (order.get(b.beatId) ?? 0));
  const frTexts: BeatLang[] = [];
  const sliceIssues: PipelineResult["sliceIssues"] = [];
  for (const ch of scripts.fr?.chapters ?? []) {
    const r = await sliceBeats(ctx, { plans: plans.plans, primaryTexts: enTexts, chapter: ch, lang: "fr", factSheet, mode: "llm", style: plugin.data });
    frTexts.push(...r.texts);
    sliceIssues.push({ chapterId: ch.chapterId, method: r.method, issues: r.issues });
  }
  const sliceDoc = (lang: Lang, texts: BeatLang[], method: "planned" | "llm"): BeatSlicesDoc => BeatSlicesDoc.parse({
    schemaVersion: 1, lang, plansHash: docHash(plans), scriptHash: docHash(scripts[lang]), texts: sortTexts(texts),
    chapters: scripts[lang].chapters.map((c) => ({ chapterId: c.chapterId, method })), validation: [], updatedAt: TEST_NOW,
  });
  const slices = { en: sliceDoc("en", enTexts, "planned") } as Record<Lang, BeatSlicesDoc>;
  if (scripts.fr) slices.fr = sliceDoc("fr", frTexts, "llm");
  const factChecks = {} as Record<Lang, FactCheck>;
  for (const lang of langs) {
    factChecks[lang] = await factCheck(ctx, {
      script: scripts[lang], slices: slices[lang], plans, factSheet, publish: { title: titles[lang], thumbnailText: style.thumbnailTextOptions[0] ?? "", description: "" },
      previous: null, riskFlags: style.riskFlags, scriptHash: docHash(scripts[lang]), slicesHash: docHash(slices[lang]),
    });
  }
  return { ctx, registry, dossier, factSheet, style, outline, scripts, plans, slices, planIssues, sliceIssues, factChecks };
}
