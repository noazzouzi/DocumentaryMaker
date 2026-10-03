// style (§5.1, App. D): offline suggestion always; refined by the LLM when a key (or a fixture) is available.
// Sets project.styleId only when it is null; never touches styleConfirmed.
import { P, StyleSuggestion, type RiskFlag } from "@docmaker/core";
import type { StageDef } from "../types";
import { docs, need } from "../docs";
import { X, emitLog, stepCtx, writeDoc } from "./common";

function mergeFlags(a: readonly RiskFlag[], b: readonly RiskFlag[]): RiskFlag[] {
  const all = [...new Set([...a, ...b])].filter((f) => f !== "none").sort();
  return all.length ? all : ["none"];
}

export const styleStage: StageDef = {
  id: "style",
  perLang: false,
  version: 1,
  optionKeys: [],
  async inputs(ctx) {
    const reg = await X(ctx).rt.styles();
    return { idea: ctx.project.idea, factsheet: await ctx.store.docHashOf(P.factsheet), registry: reg.hash, llm: ctx.llm.kind };
  },
  async estimate(ctx) {
    if (ctx.llm.kind === "fixture" || !ctx.secrets.anthropic) return { stage: "style", lang: null, lines: [], totalUsd: 0, confidence: "exact" };
    const lines = X(ctx).rt.deps.llm.estimateStepCost("style", { inputChars: 12_000, outputChars: 3_000, cachedChars: 0, lang: null });
    return { stage: "style", lang: null, lines, totalUsd: lines.reduce((a, l) => a + l.totalUsd, 0), confidence: "estimate" };
  },
  outputs: () => [P.styleSuggestion],
  async run(ctx) {
    const e = X(ctx);
    const reg = await e.rt.styles();
    const facts = need(await docs.factsheet(ctx.store), "research/factsheet.json", "research");
    const offline = e.rt.deps.styles.suggestStyleOffline(ctx.project.idea, reg);
    let suggestion: StyleSuggestion = { ...offline, stage: "research" };
    const canLlm = ctx.llm.kind === "fixture" || !!ctx.secrets.anthropic;
    if (canLlm) {
      try {
        const styles = reg.list().map((s) => ({ id: s.id, names: s.names, description: s.description, bestFor: s.bestFor }));
        const llm = await e.rt.deps.llm.suggestStyle(stepCtx(ctx), { idea: ctx.project.idea, styles, factSummary: facts.oneLinePremise, stage: "research" });
        const recommended = reg.has(llm.recommendedStyleId) ? llm.recommendedStyleId : offline.recommendedStyleId;
        suggestion = {
          ...llm,
          ranked: llm.ranked.filter((r) => reg.has(r.styleId)).length ? llm.ranked.filter((r) => reg.has(r.styleId)) : offline.ranked,
          recommendedStyleId: recommended,
          riskFlags: mergeFlags(llm.riskFlags, offline.riskFlags),
          source: ctx.llm.kind === "fixture" ? "fixture" : "llm",
          stage: "research",
        };
      } catch (err) {
        emitLog(ctx, "style", "warn", `LLM style suggestion failed, using the offline ranking: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await writeDoc(ctx, "style", P.styleSuggestion, StyleSuggestion, suggestion);
    const patch: Record<string, unknown> = {};
    if (ctx.project.styleId === null) patch.styleId = suggestion.recommendedStyleId;
    if (ctx.project.themeOverride === null && suggestion.themeOverride) patch.themeOverride = suggestion.themeOverride;
    if (Object.keys(patch).length) ctx.project = await e.updateProject(patch);
    return { artifacts: [P.styleSuggestion] };
  },
};
