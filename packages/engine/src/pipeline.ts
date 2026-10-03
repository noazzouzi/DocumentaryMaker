// Job request → ordered stage invocations (§5.1 graph, stage-major, primary language first) + pipeline estimates (§5.4).
import {
  DocmakerError, PER_LANG_STAGES, VARIANT_STAGES, hashJson, type CostEstimate, type JobRequest, type Lang, type PipelineEstimate,
  type Project, type RenderClient, type StageId,
} from "@docmaker/core";
import type { ProjectStore } from "@docmaker/core/node";
import type { Runtime } from "./runtime";
import { ProjectCosts } from "./costs";
import { STAGE_ORDER, stageDef, stageIndex } from "./stages";
import { buildCtx, inputsHashOf, outputsExist, upToDate, type StageInvocation } from "./runner";
import { findStage, readState } from "./state";
import { orderLangs } from "./util";

/** Stages that need an active take; the runner inserts a scratch voice take first when none exists (§5.1). */
export const NEEDS_TAKE: readonly StageId[] = ["layout", "direct", "mix", "render", "export", "qa"];
/** Per-language stages that the primary language must run whenever a secondary one does (skeleton, plans). */
const PRIMARY_CLOSURE: readonly StageId[] = ["script", "beatslice"];

export function stageRange(from: StageId | null, to: StageId | null): StageId[] {
  const a = stageIndex(from ?? "research");
  const b = stageIndex(to ?? "qa");
  if (a < 0 || b < 0) throw new DocmakerError("VALIDATION", `unknown stage range ${from}→${to}`);
  if (a > b) throw new DocmakerError("VALIDATION", `--from ${from} comes after --to ${to}`);
  return STAGE_ORDER.slice(a, b + 1);
}

export function planInvocations(project: Project, req: JobRequest): StageInvocation[] {
  const langs = orderLangs(project, req.langs);
  if (req.langs.length > 0 && langs.length === 0) throw new DocmakerError("VALIDATION", `languages ${req.langs.join(",")} are not project languages (${project.languages.join(",")})`);
  const preset = req.preset ?? project.render.defaultPreset;
  let stages: StageId[];
  if (req.kind === "stage") {
    if (!req.stage) throw new DocmakerError("VALIDATION", "a stage job needs a stage");
    stages = [req.stage];
  } else if (req.kind === "pipeline" || req.kind === "demo") {
    stages = stageRange(req.from, req.to);
  } else {
    throw new DocmakerError("VALIDATION", `job kind ${req.kind} is not run by the pipeline runner`);
  }
  const out: StageInvocation[] = [];
  for (const stage of stages) {
    const def = stageDef(stage);
    if (!def.perLang || !PER_LANG_STAGES.includes(stage)) {
      out.push({ stage, lang: null, variant: null, options: req.options, force: req.force });
      continue;
    }
    const ls = req.kind !== "stage" && PRIMARY_CLOSURE.includes(stage) && !langs.includes(project.primaryLang) ? [project.primaryLang, ...langs] : langs;
    for (const lang of ls) out.push({ stage, lang, variant: VARIANT_STAGES.includes(stage) ? preset : null, options: req.options, force: req.force });
  }
  return out;
}

/** One estimate per paid invocation that is not up to date (persisted in costs/estimates/), planHash over the set. */
export async function pipelineEstimate(rt: Runtime, store: ProjectStore, plan: readonly StageInvocation[], renderClient: RenderClient | null, costs?: ProjectCosts): Promise<PipelineEstimate> {
  const state = await readState(store);
  const stages: CostEstimate[] = [];
  for (const inv of plan) {
    const def = stageDef(inv.stage);
    if (!def.estimate) continue;
    const ctx = await buildCtx(rt, store, inv, null, renderClient);
    const ih = await inputsHashOf(def, ctx);
    if (!inv.force && upToDate(findStage(state, inv), ih) && (await outputsExist(def, ctx))) continue;
    const e = await def.estimate(ctx);
    if (!e || e.totalUsd <= 0) continue;
    stages.push(await (costs ?? ctx.costs).estimate(e, ih));
  }
  const totalUsd = Math.round(stages.reduce((a, s) => a + s.totalUsd, 0) * 1e6) / 1e6;
  return { stages, totalUsd, planHash: hashJson(stages.map((s) => s.planHash).sort()) };
}

export function pipelineSummary(pe: PipelineEstimate): string {
  const lines = pe.stages.map((s) => `${s.stage}${s.lang ? "." + s.lang : ""} $${s.totalUsd.toFixed(2)}`);
  return `pipeline estimate $${pe.totalUsd.toFixed(2)} (${lines.join(", ")})`;
}

export const langsLabel = (langs: readonly Lang[]): string => (langs.length ? langs.join(",") : "all");
