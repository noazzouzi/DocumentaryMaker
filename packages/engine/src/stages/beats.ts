// beats (§6.3 step 5, App. D): re-plan only chapters whose primary skeleton changed (or replanChapters), ∥ ≤ 4 LLM calls;
// ids + plan keys in code; synthetic clip/breath beats; writes beats/plans.json (language-neutral) + primary slices.
import { BeatPlansDoc, P, hashJson, type BeatLang, type BeatPlan, type ChapterScript, type Script } from "@docmaker/core";
import type { StageDef } from "../types";
import { docs, need } from "../docs";
import { X, emitLog, skeletonOf, stepCtx, writeDoc } from "./common";

const textHashOf = (ch: ChapterScript) => hashJson(ch.segments.map((s) => s.displayText));
const isSynthetic = (p: BeatPlan) => p.origin === "clip" || p.origin === "breath";

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export function chapterSkeletonHashes(script: Script): Record<string, string> {
  return Object.fromEntries(script.chapters.map((c) => [c.chapterId, hashJson(skeletonOf(c))]));
}

export const beatsStage: StageDef = {
  id: "beats",
  perLang: false,
  version: 1,
  optionKeys: ["replanChapters"],
  async inputs(ctx) {
    const primary = await docs.script(ctx.store, ctx.project.primaryLang);
    return {
      skeletons: primary ? chapterSkeletonHashes(primary) : null, factsheet: await ctx.store.docHashOf(P.factsheet), styleHash: ctx.style.dataHash,
      languages: ctx.project.languages,
    };
  },
  async estimate(ctx) {
    if (ctx.llm.kind === "fixture") return { stage: "beats", lang: null, lines: [], totalUsd: 0, confidence: "exact" };
    const primary = await docs.script(ctx.store, ctx.project.primaryLang);
    const chars = primary?.chapters.reduce((a, c) => a + c.segments.reduce((b, s) => b + s.displayText.length, 0), 0) ?? ctx.project.targetMinutes * 900;
    const n = primary?.chapters.length ?? 6;
    const lines = X(ctx).rt.deps.llm.estimateStepCost("beats", { inputChars: chars + n * 4_000, outputChars: chars * 4, cachedChars: n * 25_000, lang: null });
    return { stage: "beats", lang: null, lines, totalUsd: lines.reduce((a, l) => a + l.totalUsd, 0), confidence: "estimate" };
  },
  outputs: () => [P.beatPlans],
  async run(ctx) {
    const e = X(ctx);
    const p = ctx.project;
    const primary = need(await docs.script(ctx.store, p.primaryLang), `script/${p.primaryLang}/script.json`, `script (${p.primaryLang})`);
    const facts = need(await docs.factsheet(ctx.store), "research/factsheet.json", "research");
    const previous = await docs.plans(ctx.store);
    const replan = new Set<string>(ctx.options.replanChapters ?? []);
    const firstAct = ctx.style.data.scriptProfile.storyShapes.find((s) => s.id === ctx.style.data.scriptProfile.defaultShape)?.acts[0]?.id;
    const outline = await docs.outline(ctx.store);
    const actOf = new Map((outline?.chapters ?? []).map((c) => [c.id, c.act]));

    const todo = primary.chapters.map((ch, idx) => {
      const prevCh = previous?.chapters.find((c) => c.chapterId === ch.chapterId);
      const sk = hashJson(skeletonOf(ch));
      const keep = !!prevCh && prevCh.skeletonHash === sk && !replan.has(ch.chapterId) && previous!.primaryLang === p.primaryLang;
      return { ch, idx, sk, keep, prevCh };
    });
    const sctx = stepCtx(ctx);
    let done = 0;
    const results = await mapLimit(todo, 4, async (t) => {
      if (t.keep) {
        const plans = previous!.plans.filter((x) => x.chapterId === t.ch.chapterId && !isSynthetic(x));
        const ids = new Set(plans.map((x) => x.id));
        return { plans, texts: previous!.primary.filter((x) => ids.has(x.beatId)), method: t.prevCh!.method, textHash: t.prevCh!.textHash };
      }
      // the cold open is the first chapter (and only when it carries the shape's first act, if the outline says so)
      const isHook = t.idx === 0 && (firstAct === undefined || !actOf.has(t.ch.chapterId) || actOf.get(t.ch.chapterId) === firstAct);
      const r = await e.rt.deps.llm.planBeats(sctx, { chapter: t.ch, factSheet: facts, style: ctx.style, isHook, lang: p.primaryLang, startOrder: 0 });
      ctx.progress(++done / todo.length, `beats ${t.ch.chapterId}`);
      const errs = r.issues.filter((x) => x.level === "error");
      if (errs.length) emitLog(ctx, "beats", "warn", `${t.ch.chapterId}: ${errs.length} beat validation error(s) (${errs.slice(0, 3).map((x) => x.rule).join(", ")})`);
      return { plans: r.plans, texts: r.texts, method: ctx.llm.kind === "fixture" ? ("fixture" as const) : r.method, textHash: textHashOf(t.ch) };
    });
    const planned = results.flatMap((r) => r.plans);
    const assembled = e.rt.deps.llm.assembleBeatPlans(primary, planned, p.languages);
    const primaryTexts: BeatLang[] = [...results.flatMap((r) => r.texts), ...assembled.texts.filter((t) => t.lang === p.primaryLang)];
    const order = new Map(assembled.plans.map((x) => [x.id, x.order]));
    const known = new Set(assembled.plans.map((x) => x.id));
    const dedup = new Map<string, BeatLang>();
    for (const t of primaryTexts) if (known.has(t.beatId) && !dedup.has(t.beatId)) dedup.set(t.beatId, { ...t, lang: p.primaryLang });
    const doc = BeatPlansDoc.parse({
      schemaVersion: 1, primaryLang: p.primaryLang,
      chapters: todo.map((t, i) => ({ chapterId: t.ch.chapterId, skeletonHash: t.sk, textHash: results[i]!.textHash, method: results[i]!.method })),
      plans: assembled.plans,
      primary: [...dedup.values()].sort((a, b) => (order.get(a.beatId) ?? 0) - (order.get(b.beatId) ?? 0)),
      generatedBy: ctx.llm.kind === "fixture" ? "fixture" : results.every((r) => r.method === "fallback") ? "fallback-splitter" : "llm",
      updatedAt: new Date().toISOString(),
    });
    await writeDoc(ctx, "beats", P.beatPlans, BeatPlansDoc, doc);
    return { artifacts: [P.beatPlans] };
  },
};
