// render[lang, preset] (§12.3, §5.6, App. D): editorial gates → snapshot (timeline copy + mix hardlink) → release the
// project job lock (other jobs of the project may proceed) → renderClient.render(RenderRequest) → render.json.
// The machine-wide render slot is taken by the RenderClient itself (never here: same lock file → self-deadlock).
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  DocmakerError, P, RenderDoc, RenderPresetId, docHash, type Lang, type RenderPresetId as Preset, type RenderRequest,
} from "@docmaker/core";
import type { StageCtx, StageDef } from "../types";
import { docs, need } from "../docs";
import { factcheckGate, personGate, recheckGate } from "../gates";
import { remotionCodeHash } from "../codehash";
import { nowIso } from "../util";
import { needLang, onlyChaptersOf, writeDoc } from "./common";
import { mixSourceHash } from "./mix";

/**
 * Whether audio/<lang>/mix.wav was mixed from this timeline's audio (loudness.json records the mix source). null: no mix.
 * A mix of another timeline (direct re-ran after the mix: new take, scene-board edit, chapter selection) is not current.
 */
export async function mixMatches(ctx: Pick<StageCtx, "store" | "project">, lang: Lang, t: import("@docmaker/core").Timeline): Promise<boolean | null> {
  if (!(await ctx.store.exists(P.mix(lang)))) return null;
  const ld = await docs.loudness(ctx.store, lang).catch(() => null);
  return !!ld?.sourceHash && ld.sourceHash === mixSourceHash(t, ctx.project);
}

export function presetOf(ctx: Pick<StageCtx, "variant" | "project">): Preset {
  const v = ctx.variant ?? ctx.project.render.defaultPreset;
  const r = RenderPresetId.safeParse(v);
  if (!r.success) throw new DocmakerError("VALIDATION", `unknown render preset ${v}`);
  return r.data;
}
export const snapshotTimelineRel = (lang: Lang, preset: string) => `${P.renderSnapshot(lang, preset)}timeline.json`;
export const snapshotMixRel = (lang: Lang, preset: string) => `${P.renderSnapshot(lang, preset)}mix.wav`;

/** Editorial gates shared by render and export (§5.4). */
export async function publishGates(ctx: StageCtx): Promise<{ gate: import("@docmaker/core").GateId; reason: "unmet" | "stale"; planHash: string; summary: string }[]> {
  const lang = needLang(ctx);
  const out = [];
  const fc = await factcheckGate(ctx.store, ctx.project, lang);
  if (fc) out.push(fc);
  const pg = await personGate(ctx.store, ctx.project);
  if (pg) out.push(pg);
  const rc = await recheckGate(ctx.store, ctx.project);
  if (rc) out.push(rc);
  return out;
}

export const renderStage: StageDef = {
  id: "render",
  perLang: true,
  version: 1,
  optionKeys: ["frameRange", "onlyChapters"],
  async inputs(ctx) {
    const lang = needLang(ctx);
    const preset = presetOf(ctx);
    const grade = ctx.style.data.grade;
    return {
      timeline: await ctx.store.docHashOf(P.timeline(lang)), mix: await ctx.store.etag(P.mix(lang)), codeHash: await remotionCodeHash(ctx.config.repoRoot),
      preset, gl: ctx.project.render.gl, chunkSeconds: ctx.project.render.chunkSeconds,
      grain: preset === "master" ? grade.grainFfmpeg : 0, lut: preset === "master" ? grade.lut ?? null : null,
    };
  },
  gatesBefore: publishGates,
  outputs: (ctx) => [P.renderFinal(needLang(ctx), presetOf(ctx)), P.renderDoc(needLang(ctx), presetOf(ctx))],
  async run(ctx) {
    const lang = needLang(ctx);
    const preset = presetOf(ctx);
    if (!ctx.render) throw new DocmakerError("TOOL_MISSING", "no render client in this process", { hint: "renders run in the CLI or the job worker" });
    const timeline = need(await docs.timeline(ctx.store, lang), `timeline/${lang}.json`, `direct (${lang})`);
    // snapshot (the timeline bytes as they are now; the mix is hardlinked — mix.wav is replaced atomically on re-mix)
    const tRel = snapshotTimelineRel(lang, preset);
    await mkdir(path.dirname(ctx.store.abs(tRel)), { recursive: true });
    await copyFile(ctx.store.abs(P.timeline(lang)), ctx.store.abs(tRel));
    let mixRel: string | null = null;
    let mixHash: string | null = null;
    const current = await mixMatches(ctx, lang, timeline);
    if (current === false) {
      throw new DocmakerError("UPSTREAM_MISSING", `${lang}: the mix was not built from the current timeline (direct ran after the last mix)`, { hint: `re-run the mix first (docmaker run <slug> --from mix --to render)` });
    }
    if (current) {
      mixRel = snapshotMixRel(lang, preset);
      await ctx.store.linkOrCopy(ctx.store.abs(P.mix(lang)), mixRel);
      mixHash = await ctx.store.etag(mixRel);
    } else {
      ctx.emit({ type: "log", level: "warn", stage: "render", message: `${lang}: no mix yet — rendering with a silent track` });
    }
    const snapTimelineHash = docHash(timeline);
    // the job lock is released: scene-board `direct` runs of this project may proceed during a long master render
    await ctx.releaseProjectLock?.();
    const grade = ctx.style.data.grade;
    const req: RenderRequest = {
      slug: ctx.project.slug, lang, preset, projectDir: ctx.store.dir, timelineRel: tRel, mixRel, outRel: P.renderFinal(lang, preset),
      frameRange: ctx.options.frameRange ?? null, chunkSeconds: ctx.project.render.chunkSeconds, gl: ctx.project.render.gl,
      concurrency: ctx.project.render.concurrency, grain: preset === "master" ? grade.grainFfmpeg : 0, lutCube: null,
    };
    const r = await ctx.render.render(req, { onEvent: (ev) => ctx.emit(ev), signal: ctx.signal });
    const doc: RenderDoc = {
      ...r, schemaVersion: 1, lang, preset, timelineHash: snapTimelineHash, mixHash, onlyChapters: onlyChaptersOf(ctx) ?? timeline.onlyChapters, createdAt: nowIso(),
    };
    await writeDoc(ctx, "render", P.renderDoc(lang, preset), RenderDoc, doc);
    ctx.emit({ type: "artifact", stage: "render", lang, path: P.renderFinal(lang, preset), kind: "video" });
    return { artifacts: [P.renderFinal(lang, preset), P.renderDoc(lang, preset), tRel, ...(mixRel ? [mixRel] : [])] };
  },
};
