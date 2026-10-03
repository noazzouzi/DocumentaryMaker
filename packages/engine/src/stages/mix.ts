// mix[lang] (§11.5, App. D): audio.mixTimeline() (in the job worker) → audio/<lang>/mix.wav, stems/*, loudness.json.
import { LoudnessDoc, P, collectAssetIds, hashJson, type Project, type Timeline } from "@docmaker/core";
import type { StageDef } from "../types";
import { docs, need } from "../docs";
import { X, audioCtx, needLang, writeDoc } from "./common";

export const STEMS = ["vo", "music", "sfx", "clip"] as const;

/** What the mix of a timeline depends on (the mix stage inputs): the audio lanes, their files, duration and targets. */
export function mixSourceOf(t: Timeline, project: Pick<Project, "audio">) {
  const a = project.audio;
  const audioIds = collectAssetIds({ ...t, video: [], overlays: [] });
  return {
    audio: hashJson(t.audio), assets: hashJson(audioIds.map((id) => [id, t.assets[id]?.projectRel ?? null])), durationInFrames: t.durationInFrames, fps: t.fps,
    targetLufs: a.targetLufs, truePeakTarget: a.truePeakTarget,
  };
}
/** LoudnessDoc.sourceHash: identifies the timeline audio a mix.wav was built from. */
export const mixSourceHash = (t: Timeline, project: Pick<Project, "audio">): string => hashJson(mixSourceOf(t, project));

export const mixStage: StageDef = {
  id: "mix",
  perLang: true,
  version: 1,
  optionKeys: ["onlyChapters"],
  async inputs(ctx) {
    const lang = needLang(ctx);
    const t = await docs.timeline(ctx.store, lang);
    if (!t) return { timeline: null };
    return mixSourceOf(t, ctx.project);
  },
  outputs: (ctx) => {
    const lang = needLang(ctx);
    return [P.mix(lang), ...STEMS.map((s) => P.stem(lang, s)), P.loudness(lang)];
  },
  async run(ctx) {
    const e = X(ctx);
    const lang = needLang(ctx);
    const t = need(await docs.timeline(ctx.store, lang), `timeline/${lang}.json`, `direct (${lang})`);
    const stemRels = Object.fromEntries(STEMS.map((s) => [s, P.stem(lang, s)])) as Record<(typeof STEMS)[number], string>;
    const r = await e.rt.deps.audio.mixTimeline(t, {
      projectDir: ctx.store.dir, outMixRel: P.mix(lang), stemRels, targetLufs: ctx.project.audio.targetLufs, truePeakTarget: ctx.project.audio.truePeakTarget,
    }, audioCtx(ctx));
    await writeDoc(ctx, "mix", P.loudness(lang), LoudnessDoc, { ...r, schemaVersion: 1, lang, sourceHash: mixSourceHash(t, ctx.project) });
    for (const rel of [P.mix(lang), ...Object.values(stemRels)]) ctx.emit({ type: "artifact", stage: "mix", lang, path: rel, kind: "audio" });
    return { artifacts: [P.mix(lang), ...Object.values(stemRels), P.loudness(lang)] };
  },
};
