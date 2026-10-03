// factcheck[lang] (§6.3 step 6, App. D): llm.factCheck per chapter (receipt-cached) + deterministic rules a–h, resolutions
// carried over by stable FC ids (re-opened when an item's verdict or risk changed) → script/<lang>/factcheck.json.
// The factcheck-ack gate is evaluated before final voice takes, render and export (gates.ts), never here.
import { FactCheck, P, docHash, hashJson, type FactSheet } from "@docmaker/core";
import type { StageCtx, StageDef } from "../types";
import { docs, effectivePublish, need } from "../docs";
import { reopenChanged } from "../gates";
import { X, needLang, stepCtx, writeDoc } from "./common";

/** Quote ids whose YouTube passage matched ≥ 0.8 in the assets stage (§6.3 1b). */
async function videoQuotes(ctx: StageCtx): Promise<string[]> {
  const picks = await docs.picks(ctx.store);
  return picks ? X(ctx).rt.deps.assets.videoVerifiedQuotes(picks) : [];
}

/** The fact-check sees video-verified quotes as verbatim (the fact sheet itself is never rewritten here). */
export function withVideoVerified(fs: FactSheet, ids: readonly string[]): FactSheet {
  if (ids.length === 0) return fs;
  const set = new Set(ids);
  return { ...fs, quotes: fs.quotes.map((q) => (set.has(q.id) && q.verification !== "verbatim" ? { ...q, verification: "verbatim" as const, verifiedBy: "video" as const } : q)) };
}

export const factcheckStage: StageDef = {
  id: "factcheck",
  perLang: true,
  version: 1,
  optionKeys: [],
  async inputs(ctx) {
    const lang = needLang(ctx);
    const e = X(ctx);
    const script = await docs.script(ctx.store, lang);
    const suggestion = await docs.suggestion(ctx.store);
    return {
      script: await ctx.store.docHashOf(P.script(lang)), slices: await ctx.store.docHashOf(P.beatSlices(lang)),
      plans: await ctx.store.docHashOf(P.beatPlans), factsheet: await ctx.store.docHashOf(P.factsheet), videoQuotes: await videoQuotes(ctx),
      publish: hashJson(effectivePublish(ctx.project, lang, script, suggestion)), riskFlags: await e.riskFlags(), personAcks: await e.personAcks(),
      llm: ctx.llm.kind,
    };
  },
  async estimate(ctx) {
    const lang = needLang(ctx);
    if (ctx.llm.kind === "fixture") return { stage: "factcheck", lang, lines: [], totalUsd: 0, confidence: "exact" };
    const script = await docs.script(ctx.store, lang);
    const chars = script?.chapters.reduce((a, c) => a + c.segments.reduce((b, s) => b + s.displayText.length, 0), 0) ?? ctx.project.targetMinutes * 900;
    const n = script?.chapters.length ?? 6;
    const lines = X(ctx).rt.deps.llm.estimateStepCost("factcheck", { inputChars: chars * 2 + n * 4_000, outputChars: n * 3_000, cachedChars: n * 30_000, lang });
    return { stage: "factcheck", lang, lines, totalUsd: lines.reduce((a, l) => a + l.totalUsd, 0), confidence: "estimate" };
  },
  outputs: (ctx) => [P.factcheck(needLang(ctx))],
  async run(ctx) {
    const e = X(ctx);
    const lang = needLang(ctx);
    const script = need(await docs.script(ctx.store, lang), `script/${lang}/script.json`, `script (${lang})`);
    const slices = need(await docs.slices(ctx.store, lang), `beats/${lang}.json`, `beatslice (${lang})`);
    const plans = need(await docs.plans(ctx.store), "beats/plans.json", "beats");
    const facts = withVideoVerified(need(await docs.factsheet(ctx.store), "research/factsheet.json", "research"), await videoQuotes(ctx));
    const suggestion = await docs.suggestion(ctx.store);
    const previous = await docs.factcheck(ctx.store, lang);
    const fc = await e.rt.deps.llm.factCheck(stepCtx(ctx), {
      script, slices, plans, factSheet: facts, publish: effectivePublish(ctx.project, lang, script, suggestion), previous,
      riskFlags: (await e.riskFlags()).filter((f) => f !== "none"), scriptHash: docHash(script), slicesHash: docHash(slices),
      personAcks: await e.personAcks(),
    });
    // resolutions carried over by stable id are re-opened when the item's verdict or risk changed (§5.4)
    await writeDoc(ctx, "factcheck", P.factcheck(lang), FactCheck, { ...fc, items: reopenChanged(fc.items, previous) });
    return { artifacts: [P.factcheck(lang)] };
  },
};
