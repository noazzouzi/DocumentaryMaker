// @docmaker/llm — public API (packages/llm/src/index.ts). Never writes project files: returns values to the engine
// (the only files it writes are raw paid responses in the caller-provided rawDir, costs/llm/<fingerprint>.json).
import { DocmakerError, type Logger } from "@docmaker/core";
import { AnthropicLlm, createAnthropicSdk } from "./client/anthropic";
import { FixtureLlm } from "./client/fixture";
import type { LlmClient } from "./types";

export type {
  ChapterInput, Effort, LlmCallCtx, LlmClient, LlmStep, ResearchRequest, ResearchResult, SegmentSkeleton, StepCtx, StructuredRequest,
  StyleCatalogEntry, SystemBlock,
} from "./types";

/** rawDir = <projectDir>/costs/llm (raw responses by fingerprint). Fixture: <repoRoot>/fixtures/<fixtureId> (or its llm/ dir). */
export function createLlmClient(cfg: { provider: "anthropic" | "fixture"; fixtureDir: string | null; rawDir: string; refusalFallback: boolean; logger: Logger; apiKey: string | null }): LlmClient {
  if (cfg.provider === "fixture") {
    if (!cfg.fixtureDir) throw new DocmakerError("FIXTURE_MISSING", "fixture provider without a fixture directory", { hint: "set project.llm.fixtureId" });
    return new FixtureLlm(cfg.fixtureDir);
  }
  return new AnthropicLlm({ sdk: createAnthropicSdk(cfg.apiKey), rawDir: cfg.rawDir, refusalFallback: cfg.refusalFallback, logger: cfg.logger });
}
export { FixtureLlm, fixtureLlmDir, fixtureFileName, readFixtureFile } from "./client/fixture";
export { AnthropicLlm, FALLBACK_BETA, REFUSAL_HINT, mapSdkError, systemParam, type AnthropicLike } from "./client/anthropic";

// ---- steps (§6.2 call table)
export { runResearch, buildResearchFromTurns, sourceListText, researchPrompts, type TurnLike } from "./steps/research";
export {
  buildFactSheet, suggestStyle, writeOutline, writeChapter, writeChapterWithTitle, reviseChapter, transcreateSegment, chapterToWire, segmentSkeleton,
} from "./steps/write";
export { planBeats, sliceBeats, motionFormats } from "./steps/beats";
export { factCheck, recheck } from "./steps/factcheck";
export { makeReranker, pickPassage } from "./steps/assets";
export { estimateStepCost, usageCostUsd, STEP_EFFORT, MODEL } from "./estimate";

// ---- deterministic (free) helpers
export { planBudget, findShape } from "./budget";
export { lintScript, validateOutline, type LintScriptInput } from "./lint";
export { applyFrTypography } from "./wire/typography";
export { validateBeats, insideQuote, isSynthetic, RECONSTRUCTION_RULES } from "./beats/validate";
export { splitBeatsFallback, fallbackShares } from "./beats/split";
export { syntheticBeats, assembleBeatPlans, computePlanKey, emptyBeatLang } from "./beats/synthetic";
export { checkMotion, kineticFrom, copyInvariantFields } from "./beats/motion";
export { beatsFromWire, resplitSegments } from "./beats/map";
export { deterministicFactChecks, factCheckId, carryOverResolutions, type DeterministicInput } from "./factcheck/rules";
export { extractNumbers, parseNumberToken } from "./factcheck/numbers";
export { ACCUSATORY, ATTRIBUTION, BANNED_OPENERS, AND_THEN, DENIAL, splitSentences } from "./lexicon";

// ---- wire layer
export * from "./wire/schemas";
export {
  factSheetFromWire, factSheetToWire, styleSuggestionFromWire, outlineFromWire, outlineToWire, chapterFromWire, resolveAnchors, resolveEmphasis,
  factCheckItemsFromWire, rerankFromWire, passageFromWire, transcreateFromWire,
} from "./wire/map";
export { normRef, normRefs, normChapterId, normSegmentId, normBeatId, normLoopId } from "./wire/ids";
export { EDITORIAL_RULES, SAFE_MESSAGING } from "./prompts/rules";
export { buildSystem } from "./prompts/system";
