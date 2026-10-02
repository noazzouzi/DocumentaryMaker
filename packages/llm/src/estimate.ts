// Pre-run cost estimate of one LLM step (engine.estimatePipeline sums these). Prices from core PRICES.
import { PRICES, type CostLine, type Lang } from "@docmaker/core";
import type { Effort, LlmStep } from "./types";

export const MODEL = "claude-opus-5-5" as const;
const P = PRICES.claude[MODEL];

/** Effort per step (§6.2 call table). */
export const STEP_EFFORT: Readonly<Record<LlmStep, Effort>> = {
  research: "high", factsheet: "high", style: "low", outline: "high", chapter: "high", revise: "high", beats: "medium",
  beatslice: "low", factcheck: "high", recheck: "high", transcreate: "low", rerank: "low", passage: "low",
};
/** Output-token multiplier for adaptive thinking at each effort (thinking tokens are billed as output). */
const THINKING: Readonly<Record<Effort, number>> = { low: 1.3, medium: 1.8, high: 2.5, xhigh: 3.2, max: 4 };
/** Characters per token (English ≈ 4.0; French text tokenises slightly worse). */
export const charsPerToken = (lang: Lang | null): number => (lang === "fr" ? 3.6 : lang === "en" ? 4.0 : 3.8);

const line = (label: string, unit: CostLine["unit"], quantity: number, unitPriceUsd: number): CostLine => {
  const q = Math.max(0, Math.round(quantity));
  return { label, provider: "anthropic", unit, quantity: q, unitPriceUsd, totalUsd: Math.round(q * unitPriceUsd * 1e6) / 1e6 };
};

export function estimateStepCost(step: LlmStep, i: { inputChars: number; outputChars: number; cachedChars: number; webSearches?: number; lang: Lang | null }): CostLine[] {
  const cpt = charsPerToken(i.lang);
  const cached = Math.min(Math.max(0, i.cachedChars), Math.max(0, i.inputChars));
  const lines = [
    line(`${step}: input`, "input_tokens", (i.inputChars - cached) / cpt, P.inputPerMTok / 1e6),
    line(`${step}: cached input`, "cache_read_tokens", cached / cpt, P.cacheReadPerMTok / 1e6),
    line(`${step}: output (incl. thinking)`, "output_tokens", (i.outputChars / cpt) * THINKING[STEP_EFFORT[step]], P.outputPerMTok / 1e6),
  ];
  if ((i.webSearches ?? 0) > 0) lines.push(line(`${step}: web searches`, "web_searches", i.webSearches!, PRICES.webSearchPer1k / 1000));
  return lines.filter((l) => l.quantity > 0);
}

/** Receipt cost: input·4 + output·20 + cache_read·0.20 + cache_write·5 per MTok + web_search_requests·$0.01. */
export function usageCostUsd(u: { input: number; output: number; cacheRead: number; cacheWrite: number; webSearches: number }): number {
  const usd = (u.input * P.inputPerMTok + u.output * P.outputPerMTok + u.cacheRead * P.cacheReadPerMTok + u.cacheWrite * P.cacheWrite5mPerMTok) / 1e6
    + (u.webSearches * PRICES.webSearchPer1k) / 1000;
  return Math.round(usd * 1e6) / 1e6;
}
