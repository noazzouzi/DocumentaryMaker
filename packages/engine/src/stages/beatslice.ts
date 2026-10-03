// beatslice[lang] (§6.3 step 5s, App. D): primary → planned slices (or a deterministic re-slice after a text edit);
// secondary → sliceBeats(mode "llm") with validator + fallback. Writes beats/<lang>.json.
import { BeatSlicesDoc, P, docHash, hashJson, type BeatLang, type LintIssue } from "@docmaker/core";
import type { StageDef } from "../types";
import { docs, need } from "../docs";
import { X, emitLog, needLang, stepCtx, writeDoc } from "./common";

export const beatsliceStage: StageDef = {
  id: "beatslice",
  perLang: true,
  version: 1,
  optionKeys: [],
  async inputs(ctx) {
    const lang = needLang(ctx);
    return {
      plans: await ctx.store.docHashOf(P.beatPlans), script: await ctx.store.docHashOf(P.script(lang)), factsheet: await ctx.store.docHashOf(P.factsheet),
      styleHash: ctx.style.dataHash,
    };
  },
  async estimate(ctx) {
    const lang = needLang(ctx);
    if (ctx.llm.kind === "fixture" || lang === ctx.project.primaryLang) return { stage: "beatslice", lang, lines: [], totalUsd: 0, confidence: "exact" };
    const script = await docs.script(ctx.store, lang);
    const chars = script?.chapters.reduce((a, c) => a + c.segments.reduce((b, s) => b + s.displayText.length, 0), 0) ?? ctx.project.targetMinutes * 900;
    const lines = X(ctx).rt.deps.llm.estimateStepCost("beatslice", { inputChars: chars * 3, outputChars: chars * 2, cachedChars: 20_000, lang });
    return { stage: "beatslice", lang, lines, totalUsd: lines.reduce((a, l) => a + l.totalUsd, 0), confidence: "estimate" };
  },
  outputs: (ctx) => [P.beatSlices(needLang(ctx))],
  async run(ctx) {
    const e = X(ctx);
    const lang = needLang(ctx);
    const p = ctx.project;
    const plans = need(await docs.plans(ctx.store), "beats/plans.json", "beats");
    const script = need(await docs.script(ctx.store, lang), `script/${lang}/script.json`, `script (${lang})`);
    const facts = need(await docs.factsheet(ctx.store), "research/factsheet.json", "research");
    const isPrimary = lang === plans.primaryLang;
    const texts: BeatLang[] = [];
    const chapters: BeatSlicesDoc["chapters"] = [];
    const validation: LintIssue[] = [];
    for (const [k, ch] of script.chapters.entries()) {
      ctx.progress(k / script.chapters.length, `slices ${ch.chapterId}`);
      const chPlans = plans.plans.filter((x) => x.chapterId === ch.chapterId);
      const planned = plans.chapters.find((c) => c.chapterId === ch.chapterId);
      if (isPrimary && planned && planned.textHash === hashJson(ch.segments.map((s) => s.displayText))) {
        const ids = new Set(chPlans.map((x) => x.id));
        texts.push(...plans.primary.filter((t) => ids.has(t.beatId)).map((t) => ({ ...t, lang })));
        chapters.push({ chapterId: ch.chapterId, method: "planned" });
        continue;
      }
      const r = await e.rt.deps.llm.sliceBeats(isPrimary ? null : stepCtx(ctx), {
        plans: plans.plans, primaryTexts: plans.primary, chapter: ch, lang, factSheet: facts, mode: isPrimary ? "deterministic" : "llm", style: ctx.style.data,
      });
      texts.push(...r.texts);
      validation.push(...r.issues);
      chapters.push({ chapterId: ch.chapterId, method: isPrimary ? "fallback" : r.method });
    }
    const errors = validation.filter((x) => x.level === "error");
    if (errors.length) emitLog(ctx, "beatslice", "warn", `${lang}: ${errors.length} slice error(s): ${errors.slice(0, 3).map((x) => `${x.rule}@${x.where}`).join(", ")}`);
    const order = new Map(plans.plans.map((x) => [x.id, x.order]));
    const seen = new Set<string>();
    const sorted = texts
      .filter((t) => order.has(t.beatId) && !seen.has(t.beatId) && (seen.add(t.beatId), true))
      .sort((a, b) => (order.get(a.beatId) ?? 0) - (order.get(b.beatId) ?? 0));
    const doc = BeatSlicesDoc.parse({
      schemaVersion: 1, lang, plansHash: docHash(plans), scriptHash: docHash(script), texts: sorted, chapters, validation,
      updatedAt: new Date().toISOString(),
    });
    await writeDoc(ctx, "beatslice", P.beatSlices(lang), BeatSlicesDoc, doc);
    void p;
    return { artifacts: [P.beatSlices(lang)] };
  },
};
