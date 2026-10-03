// layout[lang] (§9.1–9.2, App. D): filter script/plans/slices by onlyChapters → director.layoutProgram() →
// audio.assembleVoProgram() → layout/<lang>.json (compact) + program/<lang>/vo_program.wav.
import { DocmakerError, P, ProgramLayout, TOKENIZER_VERSION, docHash, hashJson, type FrozenAsset } from "@docmaker/core";
import type { StageDef } from "../types";
import { activeTakeOf, docs, need } from "../docs";
import { X, audioCtx, filterPlans, filterScript, filterTexts, needLang, onlyChaptersOf, writeDoc } from "./common";

export const layoutStage: StageDef = {
  id: "layout",
  perLang: true,
  version: 1,
  optionKeys: ["onlyChapters"],
  async inputs(ctx) {
    const lang = needLang(ctx);
    const active = await docs.activeTake(ctx.store, lang);
    const picks = await docs.picks(ctx.store);
    const frozen = await docs.frozen(ctx.store);
    const clips = (picks?.clips ?? []).map((c) => ({ ...c, durationMs: c.assetId ? frozen?.assets[c.assetId]?.durationMs ?? null : null }));
    const d = ctx.style.data;
    return {
      take: active ? { id: active.takeId, doc: await ctx.store.docHashOf(P.take(lang, active.takeId)) } : null,
      script: await ctx.store.docHashOf(P.script(lang)), plans: await ctx.store.docHashOf(P.beatPlans), slices: await ctx.store.docHashOf(P.beatSlices(lang)),
      outline: await ctx.store.docHashOf(P.outline), clips: hashJson(clips), pauses: d.pauses, profile: hashJson({ s: d.scriptProfile, b: d.budgets }),
      clipFallback: ctx.project.assets.clipFallback, fps: ctx.project.video.fps, tokenizer: TOKENIZER_VERSION,
    };
  },
  outputs: (ctx) => [P.layout(needLang(ctx)), P.voProgram(needLang(ctx))],
  async run(ctx) {
    const e = X(ctx);
    const lang = needLang(ctx);
    const only = onlyChaptersOf(ctx);
    const take = need(await activeTakeOf(ctx.store, lang), `voice/${lang}/active.json`, `voice (${lang})`);
    const script = need(await docs.script(ctx.store, lang), `script/${lang}/script.json`, `script (${lang})`);
    const plansDoc = need(await docs.plans(ctx.store), "beats/plans.json", "beats");
    const slices = need(await docs.slices(ctx.store, lang), `beats/${lang}.json`, `beatslice (${lang})`);
    const outline = need(await docs.outline(ctx.store), "outline/outline.json", "outline");
    const picks = await docs.picks(ctx.store);
    const frozenDoc = await docs.frozen(ctx.store);
    const fscript = filterScript(script, only);
    const plans = filterPlans(plansDoc.plans, only);
    const texts = filterTexts(slices.texts, plans);
    const frozen: Record<string, FrozenAsset> = frozenDoc?.assets ?? {};
    const shapeId = ctx.style.data.scriptProfile.storyShapes.some((s) => s.id === outline.storyShape) ? outline.storyShape : ctx.style.data.scriptProfile.defaultShape;
    const base = e.rt.deps.director.layoutProgram({
      lang, fps: ctx.project.video.fps, script: fscript, plans, texts, take, clips: picks?.clips ?? [], frozen, pauses: ctx.style.data.pauses,
      clipFallback: ctx.project.assets.clipFallback, outline, style: { scriptProfile: ctx.style.data.scriptProfile, budgets: ctx.style.data.budgets },
      storyShapeId: shapeId, scriptHash: docHash(script), plansHash: docHash(plansDoc), slicesHash: docHash(slices), onlyChapters: only,
    });
    if (base.durationInFrames <= 0) throw new DocmakerError("VALIDATION", `${lang}: the layout is empty`);
    ctx.progress(0.5, "assembling the VO program");
    const vo = await e.rt.deps.audio.assembleVoProgram({ layout: base, projectDir: ctx.store.dir, outRel: P.voProgram(lang) }, audioCtx(ctx));
    const layout: ProgramLayout = {
      ...base,
      voProgram: { assetId: vo.sha256, projectRel: P.voProgram(lang), bakedGainDb: vo.bakedGainDb, durationMs: vo.durationMs },
    };
    await writeDoc(ctx, "layout", P.layout(lang), ProgramLayout, layout);
    ctx.emit({ type: "artifact", stage: "layout", lang, path: P.voProgram(lang), kind: "audio" });
    return { artifacts: [P.layout(lang), P.voProgram(lang)] };
  },
};
