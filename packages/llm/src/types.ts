// Public types of @docmaker/llm (§4.19 llm stub; re-exported by src/index.ts).
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import type {
  ChapterPlan, CostTracker, Device, FactSheet, Lang, Logger, Outline, Progress, Receipt, RegistryEntry, RiskFlag, SegmentType,
  StageId, StylePlugin, TopicType,
} from "@docmaker/core";

export type LlmStep =
  | "research" | "factsheet" | "style" | "outline" | "chapter" | "revise" | "beats" | "beatslice"
  | "factcheck" | "recheck" | "rerank" | "passage" | "transcreate";
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
export interface LlmCallCtx {
  signal: AbortSignal;
  costs: CostTracker;
  newRequest: boolean;
  /** Optional: receives the receipt of a paid call (or of a reused one). */
  onReceipt?: (r: Receipt) => void;
}
export interface LlmClient {
  /** "claude-code": the user's Claude subscription through the `claude` CLI (no API key, no per-call cost). */
  readonly kind: "anthropic" | "claude-code" | "fixture";
  structured<S extends z.ZodType>(req: StructuredRequest<S>, h: LlmCallCtx): Promise<z.infer<S>>;
  research(req: ResearchRequest, h: LlmCallCtx & { progress: Progress }): Promise<ResearchResult>;
}
export interface StepCtx { llm: LlmClient; signal: AbortSignal; costs: CostTracker; logger: Logger; progress: Progress; newRequest: boolean }

export interface StyleCatalogEntry { id: string; names: { en: string; fr: string }; description: { en: string; fr: string }; bestFor: TopicType[] }

export interface SegmentSkeleton {
  id: string; type: SegmentType; device: Device; quoteId: string | null; factIds: string[]; approxChars: number;
  /** hashJson(primary displayText): copied into the secondary segment's primaryHash (see segmentSkeleton()). */
  primaryHash?: string;
}
export interface ChapterInput {
  lang: Lang; primaryLang: Lang; outline: Outline; plan: ChapterPlan; factSheet: FactSheet; style: StylePlugin;
  storySoFar: string[]; previousTail: string[]; skeleton: SegmentSkeleton[] | null; // skeleton = primary chapter (secondary langs)
  targetWords: number; riskFlags: RiskFlag[];
}
