// Shared helpers for the step functions.
import type { z } from "zod";
import { isDocmakerError, type StageId } from "@docmaker/core";
import type { LlmStep, StepCtx, StructuredRequest } from "../types";

export const STEP_STAGE: Readonly<Record<LlmStep, StageId>> = {
  research: "research", factsheet: "research", style: "style", outline: "outline", chapter: "script", revise: "script",
  transcreate: "script", beats: "beats", beatslice: "beatslice", factcheck: "factcheck", recheck: "factcheck", rerank: "assets", passage: "assets",
};

export function call<S extends z.ZodType>(ctx: Pick<StepCtx, "llm" | "signal" | "costs" | "newRequest">, req: Omit<StructuredRequest<S>, "stage"> & { stage?: StageId }): Promise<z.infer<S>> {
  return ctx.llm.structured({ ...req, stage: req.stage ?? STEP_STAGE[req.step] }, { signal: ctx.signal, costs: ctx.costs, newRequest: ctx.newRequest });
}

/** Optional repair round: a missing fixture response means "no repair available" (offline demo), not a failure. */
export async function tryRepair<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (isDocmakerError(e) && e.code === "FIXTURE_MISSING") return null;
    throw e;
  }
}

export const nowIso = (): string => new Date().toISOString();
