// @docmaker/llm — public API (packages/llm/src/index.ts). Never writes project files: returns values to the engine.
// P0 API stub (SPEC §4.19): every function throws DocmakerError("INTERNAL", "not implemented: …") until its owner lands it.
import { notImplemented } from "./notImplemented";
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type {
  BeatLang, BeatPlan, BeatPlansDoc, BeatSlicesDoc, Budget, ChapterPlan, ChapterScript, CostLine, CostTracker, Device, FactCheck,
  FactCheckItem, FactSheet, Lang, LintIssue, Logger, Outline, Progress, PublishInfo, RegistryDoc, RegistryEntry, Reranker,
  ResearchDossier, RiskFlag, Script, ScriptProfile, SegmentType, StageId, StyleData, StylePlugin, StyleSuggestion, TopicType,
} from "@docmaker/core";

export type LlmStep =
  | "research" | "factsheet" | "style" | "outline" | "chapter" | "revise" | "beats" | "beatslice"
  | "factcheck" | "recheck" | "rerank" | "passage";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";
export interface SystemBlock { text: string; cache: boolean }
export interface StructuredRequest<S extends z.ZodType> {
  step: LlmStep;
  key: string; // fixture/receipt key: "", "en.CH3", "CH2", …
  schema: S; // WIRE schema
  system: SystemBlock[];
  user: string | Anthropic.Beta.BetaContentBlockParam[]; // images allowed (rerank)
  effort: Effort;
  maxTokens: number;
  stage: StageId;
  lang: Lang | null;
}
export interface ResearchRequest {
  topic: string; langs: Lang[]; minutes: number; asOf: string; maxSearches: number; maxFetches: number;
  system: SystemBlock[]; user: string;
  resumeTurns: unknown[]; // saved research/raw/turn-*.json messages (resume after cancel/crash)
  onTurn: (n: number, message: unknown) => Promise<void>; // engine persists research/raw/turn-<n>.json
}
export interface ResearchResult { dossierMarkdown: string; registry: RegistryEntry[]; searchesUsed: number; fetchesUsed: number; turns: number }
export interface LlmCallCtx { signal: AbortSignal; costs: CostTracker; newRequest: boolean }
export interface LlmClient {
  readonly kind: "anthropic" | "fixture";
  structured<S extends z.ZodType>(req: StructuredRequest<S>, h: LlmCallCtx): Promise<z.infer<S>>;
  research(req: ResearchRequest, h: LlmCallCtx & { progress: Progress }): Promise<ResearchResult>;
}
/** rawDir = <projectDir>/costs/llm (raw responses by fingerprint). Fixture: <repoRoot>/fixtures/<fixtureId>/llm. */
export function createLlmClient(cfg: { provider: "anthropic" | "fixture"; fixtureDir: string | null; rawDir: string; refusalFallback: boolean; logger: Logger; apiKey: string | null }): LlmClient {
  throw notImplemented("llm.createLlmClient");
}
export class FixtureLlm implements LlmClient {
  /** P0 stub: constructor arguments are kept for inspection in tests. */
  readonly stubArgs: readonly unknown[];
  constructor(fixtureDir: string) {
    this.stubArgs = [fixtureDir];
  }
  readonly kind = "fixture" as const;
  structured<S extends z.ZodType>(req: StructuredRequest<S>, h: LlmCallCtx): Promise<z.infer<S>> {
    throw notImplemented("llm.FixtureLlm.structured");
  }
  research(req: ResearchRequest, h: LlmCallCtx & { progress: Progress }): Promise<ResearchResult> {
    throw notImplemented("llm.FixtureLlm.research");
  }
}
export interface StepCtx { llm: LlmClient; signal: AbortSignal; costs: CostTracker; logger: Logger; progress: Progress; newRequest: boolean }

// ---- steps (§6.2 call table)
export function runResearch(ctx: StepCtx, i: { topic: string; langs: Lang[]; minutes: number; asOf: string; resumeTurns: unknown[]; onTurn: ResearchRequest["onTurn"] }): Promise<ResearchResult> {
  throw notImplemented("llm.runResearch");
}
export function buildFactSheet(ctx: StepCtx, i: { dossier: ResearchDossier; registry: RegistryDoc; asOf: string; topic: string }): Promise<{ factSheet: FactSheet; invalidRefs: string[] }> {
  throw notImplemented("llm.buildFactSheet");
}
export interface StyleCatalogEntry { id: string; names: { en: string; fr: string }; description: { en: string; fr: string }; bestFor: TopicType[] }
export function suggestStyle(ctx: StepCtx, i: { idea: string; styles: StyleCatalogEntry[]; factSummary: string | null; stage: "idea" | "research" }): Promise<StyleSuggestion> {
  throw notImplemented("llm.suggestStyle");
}
/** runtimeSec = minutes·60; narrationSec = runtimeSec·narrationShare; chars = narrationSec·cps; words = chars/avgCharsPerWord. */
export function planBudget(minutes: number, lang: Lang, profile: ScriptProfile, shapeId: string, voiceCps?: number): Budget {
  throw notImplemented("llm.planBudget");
}
export function writeOutline(ctx: StepCtx, i: { factSheet: FactSheet; style: StylePlugin; budget: Budget; budgets: Partial<Record<Lang, Budget>>; shapeId: string; lang: Lang; riskFlags: RiskFlag[] }): Promise<Outline> {
  throw notImplemented("llm.writeOutline");
}
export function validateOutline(o: Outline, style: StyleData): LintIssue[] {
  throw notImplemented("llm.validateOutline");
}
export interface SegmentSkeleton { id: string; type: SegmentType; device: Device; quoteId: string | null; factIds: string[]; approxChars: number }
export interface ChapterInput {
  lang: Lang; primaryLang: Lang; outline: Outline; plan: ChapterPlan; factSheet: FactSheet; style: StylePlugin;
  storySoFar: string[]; previousTail: string[]; skeleton: SegmentSkeleton[] | null; // skeleton = primary chapter (secondary langs)
  targetWords: number; riskFlags: RiskFlag[];
}
export function writeChapter(ctx: StepCtx, i: ChapterInput): Promise<ChapterScript> {
  throw notImplemented("llm.writeChapter");
}
export function reviseChapter(ctx: StepCtx, i: ChapterInput & { chapter: ChapterScript; issues: LintIssue[] }): Promise<ChapterScript> {
  throw notImplemented("llm.reviseChapter");
}
export function lintScript(i: { lang: Lang; profile: ScriptProfile; outline: Outline; chapters: ChapterScript[]; facts: FactSheet; cps?: number }): LintIssue[] {
  throw notImplemented("llm.lintScript");
}
export function applyFrTypography(text: string): string {
  throw notImplemented("llm.applyFrTypography");
} // « » + U+202F, ;:!? spacing, ’ (displayText only)
export function planBeats(ctx: StepCtx, i: { chapter: ChapterScript; factSheet: FactSheet; style: StylePlugin; isHook: boolean; lang: Lang; startOrder: number }): Promise<{ plans: BeatPlan[]; texts: BeatLang[]; issues: LintIssue[]; method: "llm" | "fallback" }> {
  throw notImplemented("llm.planBeats");
}
/** Secondary language (LLM, validator, fallback) — or the primary language after a text edit (deterministic re-slice, no LLM). */
export function sliceBeats(ctx: StepCtx | null, i: { plans: BeatPlan[]; primaryTexts: BeatLang[]; chapter: ChapterScript; lang: Lang; factSheet: FactSheet; mode: "llm" | "deterministic" }): Promise<{ texts: BeatLang[]; issues: LintIssue[]; method: "llm" | "fallback" }> {
  throw notImplemented("llm.sliceBeats");
}
/** Exact reconstruction, durations, AI+person rewrite, motion data refs (quote/source/figure) vs FactSheet → downgrades, cue anchors. */
export function validateBeats(i: { plans: BeatPlan[]; texts: BeatLang[]; chapter: ChapterScript; factSheet: FactSheet; style: StyleData; lang: Lang; primary: boolean }): { issues: LintIssue[]; plans: BeatPlan[]; texts: BeatLang[] } {
  throw notImplemented("llm.validateBeats");
}
export function splitBeatsFallback(segmentText: string, charShares: number[]): string[] {
  throw notImplemented("llm.splitBeatsFallback");
}
/** Synthetic beats added in code: one -CLIP beat per clip segment, one -BR beat per music_breath segment (no text). */
export function syntheticBeats(script: Script, langs: Lang[], startOrder: number): { plans: BeatPlan[]; texts: BeatLang[] } {
  throw notImplemented("llm.syntheticBeats");
}
export function computePlanKey(p: Pick<BeatPlan, "visualKind" | "visualQuery" | "personIds" | "motionTemplate" | "quoteId">): string {
  throw notImplemented("llm.computePlanKey");
}
export function factCheck(ctx: StepCtx, i: {
  script: Script; slices: BeatSlicesDoc; plans: BeatPlansDoc; factSheet: FactSheet; publish: PublishInfo | null;
  previous: FactCheck | null; riskFlags: RiskFlag[]; scriptHash: string; slicesHash: string;
}): Promise<FactCheck> {
  throw notImplemented("llm.factCheck");
}
export function deterministicFactChecks(i: { script: Script; slices: BeatSlicesDoc; plans: BeatPlansDoc; factSheet: FactSheet; publish: PublishInfo | null; riskFlags: RiskFlag[] }): FactCheckItem[] {
  throw notImplemented("llm.deterministicFactChecks");
}
export function factCheckId(where: string, sentence: string, claimKind: string, origin: "llm" | "deterministic"): string {
  throw notImplemented("llm.factCheckId");
}
/** Out-of-sync secondary segment (primaryHash mismatch): cheap, cost-gated transcreation of ONE segment. */
export function transcreateSegment(ctx: StepCtx, i: { primary: Script["chapters"][number]["segments"][number]; current: Script["chapters"][number]["segments"][number]; lang: Lang; style: StylePlugin; factSheet: FactSheet }): Promise<{ displayText: string; subtitleTranslation: string }> {
  throw notImplemented("llm.transcreateSegment");
}
export function recheck(ctx: StepCtx, i: { factSheet: FactSheet; claimIds: string[]; asOf: string }): Promise<{ factSheet: FactSheet; changed: string[] }> {
  throw notImplemented("llm.recheck");
}
export function makeReranker(ctx: Omit<StepCtx, "progress">): Reranker {
  throw notImplemented("llm.makeReranker");
}
export function pickPassage(ctx: StepCtx, i: { verbatim: string; windows: { index: number; text: string; startMs: number; endMs: number }[] }): Promise<{ bestIndex: number; confidence: number }> {
  throw notImplemented("llm.pickPassage");
}
export function estimateStepCost(step: LlmStep, i: { inputChars: number; outputChars: number; cachedChars: number; webSearches?: number; lang: Lang | null }): CostLine[] {
  throw notImplemented("llm.estimateStepCost");
}
export const ACCUSATORY: Readonly<Record<Lang, RegExp>> = { en: /(?!)/, fr: /(?!)/ };
export const ATTRIBUTION: Readonly<Record<Lang, RegExp>> = { en: /(?!)/, fr: /(?!)/ };
export const BANNED_OPENERS: Readonly<Record<Lang, RegExp>> = { en: /(?!)/, fr: /(?!)/ };
