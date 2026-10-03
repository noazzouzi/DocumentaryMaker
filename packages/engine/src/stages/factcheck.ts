// factcheck[lang] (§6.3 step 6, App. D): llm.factCheck per chapter (receipt-cached) + deterministic rules a–h, resolutions
// carried over by stable FC ids → script/<lang>/factcheck.json. The factcheck-ack gate is evaluated before final voice
// takes, render and export (gates.ts), never here.
import { FactCheck, P, docHash, hashJson } from "@docmaker/core";
import type { StageDef } from "../types";
import { docs, effectivePublish, need } from "../docs";
import { X, needLang, stepCtx, writeDoc } from "./common";

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
      plans: await ctx.store.docHashOf(P.beatPlans), factsheet: await ctx.store.docHashOf(P.factsheet),
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
    const facts = need(await docs.factsheet(ctx.store), "research/factsheet.json", "research");
    const suggestion = await docs.suggestion(ctx.store);
    const previous = await docs.factcheck(ctx.store, lang);
    const fc = await e.rt.deps.llm.factCheck(stepCtx(ctx), {
      script, slices, plans, factSheet: facts, publish: effectivePublish(ctx.project, lang, script, suggestion), previous,
      riskFlags: (await e.riskFlags()).filter((f) => f !== "none"), scriptHash: docHash(script), slicesHash: docHash(slices),
      personAcks: await e.personAcks(),
    });
    await writeDoc(ctx, "factcheck", P.factcheck(lang), FactCheck, fc);
    return { artifacts: [P.factcheck(lang)] };
  },
};
