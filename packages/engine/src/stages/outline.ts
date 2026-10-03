// outline (§6.3 step 3, App. D): gate style-confirm → planBudget per language (in code) → writeOutline (validates + 1 repair).
import { Outline, P, type Budget, type Lang, type Project, type StylePlugin } from "@docmaker/core";
import type { StageDef } from "../types";
import { docs, need } from "../docs";
import { styleGate } from "../gates";
import { X, stepCtx, writeDoc } from "./common";

export const cpsOf = (project: Project, style: StylePlugin, lang: Lang): number =>
  project.voice[lang]?.charsPerSec ?? style.data.scriptProfile.charsPerSec[lang];

export function budgetsFor(ctx: Parameters<StageDef["run"]>[0], shapeId: string): Partial<Record<Lang, Budget>> {
  const e = X(ctx);
  const out: Partial<Record<Lang, Budget>> = {};
  for (const lang of ctx.project.languages) {
    out[lang] = e.rt.deps.llm.planBudget(ctx.project.targetMinutes, lang, ctx.style.data.scriptProfile, shapeId, ctx.project.voice[lang]?.charsPerSec ?? undefined);
  }
  return out;
}

export const outlineStage: StageDef = {
  id: "outline",
  perLang: false,
  version: 1,
  optionKeys: [],
  async inputs(ctx) {
    const p = ctx.project;
    const sug = await docs.suggestion(ctx.store);
    return {
      factsheet: await ctx.store.docHashOf(P.factsheet), styleId: p.styleId, styleHash: ctx.style.dataHash, targetMinutes: p.targetMinutes,
      languages: p.languages, primaryLang: p.primaryLang, cps: Object.fromEntries(p.languages.map((l) => [l, cpsOf(p, ctx.style, l)])),
      riskFlags: sug?.riskFlags ?? [],
    };
  },
  async gatesBefore(ctx) {
    const g = styleGate(ctx.project);
    return g ? [g] : [];
  },
  async estimate(ctx) {
    if (ctx.llm.kind === "fixture") return { stage: "outline", lang: null, lines: [], totalUsd: 0, confidence: "exact" };
    const fsChars = (await ctx.store.etag(P.factsheet)) ? 30_000 : 20_000;
    const lines = X(ctx).rt.deps.llm.estimateStepCost("outline", { inputChars: 8_000, outputChars: 6_000 + ctx.project.targetMinutes * 200, cachedChars: fsChars, lang: ctx.project.primaryLang });
    return { stage: "outline", lang: null, lines, totalUsd: lines.reduce((a, l) => a + l.totalUsd, 0), confidence: "estimate" };
  },
  outputs: () => [P.outline],
  async run(ctx) {
    const e = X(ctx);
    const facts = need(await docs.factsheet(ctx.store), "research/factsheet.json", "research");
    const sug = await docs.suggestion(ctx.store);
    const shapeId = ctx.style.data.scriptProfile.defaultShape;
    const budgets = budgetsFor(ctx, shapeId);
    const primary = ctx.project.primaryLang;
    const outline = await e.rt.deps.llm.writeOutline(stepCtx(ctx), {
      factSheet: facts, style: ctx.style, budget: budgets[primary]!, budgets, shapeId, lang: primary,
      riskFlags: (sug?.riskFlags ?? []).filter((f) => f !== "none"),
    });
    await writeDoc(ctx, "outline", P.outline, Outline, { ...outline, budgets: { ...budgets, ...outline.budgets }, generatedBy: ctx.llm.kind === "fixture" ? "fixture" : outline.generatedBy });
    return { artifacts: [P.outline] };
  },
};
