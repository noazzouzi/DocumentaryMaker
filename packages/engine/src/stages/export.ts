// export[lang] (§13, App. D): editorial gates → renderClient.renderGeneratedStills() → export.conformForNle() →
// assets.buildCredits() → publish kit / editorial report → export.writeExportBundle() (reference MP4 when an
// up-to-date render of this timeline + mix exists, master preferred). Export never waits for a render.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  P, docHash, type ExportFormat, type Lang, type MusicDoc, type RenderPresetId, type SfxEntry, type Timeline,
} from "@docmaker/core";
import type { StageCtx, StageDef } from "../types";
import { activeTakeOf, docs, need } from "../docs";
import { writeTextIfChanged } from "../util";
import { X, emitLog, exportCtx, needLang } from "./common";
import { sfxEntriesOrNull } from "./direct";
import { STEMS } from "./mix";
import { publishGates } from "./render";

export const exportReadmeRel = (lang: Lang) => `${P.exportDir(lang)}README.md`;

/** The newest up-to-date render of the current timeline + mix (master preferred), or null. */
export async function upToDateRender(ctx: Pick<StageCtx, "store">, lang: Lang, t: Timeline | null): Promise<{ preset: RenderPresetId; rel: string } | null> {
  if (!t) return null;
  const th = docHash(t);
  const mixHash = await ctx.store.etag(P.mix(lang));
  for (const preset of ["master", "draft"] as const) {
    const doc = await docs.renderDoc(ctx.store, lang, preset).catch(() => null);
    if (!doc || doc.timelineHash !== th || doc.mixHash !== mixHash || doc.frames !== t.durationInFrames) continue;
    if (await ctx.store.exists(P.renderFinal(lang, preset))) return { preset, rel: P.renderFinal(lang, preset) };
  }
  return null;
}

export const exportStage: StageDef = {
  id: "export",
  perLang: true,
  version: 1,
  optionKeys: ["timelineOnly", "overlays"],
  async inputs(ctx) {
    const lang = needLang(ctx);
    const p = ctx.project;
    const t = await docs.timeline(ctx.store, lang);
    const ref = ctx.options.timelineOnly ? null : await upToDateRender(ctx, lang, t);
    return {
      timeline: t ? docHash(t) : null, mix: await ctx.store.etag(P.mix(lang)), formats: p.export.formats, exportRoot: p.export.exportRoot,
      fcpxmlVersion: p.export.fcpxmlVersion, overlays: p.export.overlays, ledger: await ctx.store.docHashOf(P.ledger), usage: await ctx.store.docHashOf(P.usage(lang)),
      factcheck: await ctx.store.docHashOf(P.factcheck(lang)), music: await ctx.store.docHashOf(P.music), publish: p.publish[lang] ?? null,
      asOf: p.editorial.asOf, take: await ctx.store.docHashOf(P.activeTake(lang)), reference: ref ? { preset: ref.preset, etag: await ctx.store.etag(ref.rel) } : null,
    };
  },
  gatesBefore: publishGates,
  outputs: (ctx) => [exportReadmeRel(needLang(ctx))],
  async run(ctx) {
    const e = X(ctx);
    const lang = needLang(ctx);
    const p = ctx.project;
    const ex = e.rt.deps.exporter;
    const t = need(await docs.timeline(ctx.store, lang), `timeline/${lang}.json`, `direct (${lang})`);
    const exportDirAbs = ctx.store.abs(P.exportDir(lang));
    await mkdir(exportDirAbs, { recursive: true });
    const formats: ExportFormat[] = [...p.export.formats];

    // generated / solid sources → PNG stills for the NLE
    const genIds = t.video.filter((c) => c.source.kind === "generated" || c.source.kind === "solid").map((c) => c.id);
    let generatedStills: Record<string, string> = {};
    if (genIds.length) {
      if (!ctx.render) emitLog(ctx, "export", "warn", `${lang}: no render client — ${genIds.length} generated still(s) are exported as markers only`);
      else {
        ctx.progress(0.05, "generated stills");
        const r = await ctx.render.renderGeneratedStills({ projectDir: ctx.store.dir, timelineRel: P.timeline(lang), clipIds: genIds, outDir: ctx.store.abs(`${P.exportDir(lang)}.generated`) }, { onEvent: (ev) => ctx.emit(ev), signal: ctx.signal });
        generatedStills = Object.fromEntries(r.map((x) => [x.clipId, x.file]));
      }
    }
    const stems: Record<string, string> = {};
    for (const s of STEMS) if (await ctx.store.exists(P.stem(lang, s))) stems[s] = ctx.store.abs(P.stem(lang, s));
    ctx.progress(0.25, "conforming media for the NLE");
    const conformed = await ex.conformForNle(t, { projectDir: ctx.store.dir, exportDir: exportDirAbs, generatedStills, overlays: null, stems }, exportCtx(ctx));

    // credits (+ assets/credits.<lang>.md)
    const ledger = (await docs.ledger(ctx.store)) ?? { schemaVersion: 1 as const, entries: [] };
    const usage = (await docs.usage(ctx.store, lang)) ?? { schemaVersion: 1 as const, lang, usage: [] };
    const music: MusicDoc = (await docs.music(ctx.store)) ?? { schemaVersion: 1, tracks: [] };
    const voice = await activeTakeOf(ctx.store, lang);
    const sfxAll: SfxEntry[] = (await sfxEntriesOrNull(ctx)) ?? [];
    const used = new Set(usage.usage.map((u) => u.assetId));
    const sfx = sfxAll.filter((s) => used.has(s.assetId));
    const credits = e.rt.deps.assets.buildCredits({ ledger, usage, lang, voice, music, sfx });
    await writeTextIfChanged(ctx.store.abs(P.credits(lang)), credits);

    const facts = await docs.factsheet(ctx.store);
    const factCheck = await docs.factcheck(ctx.store, lang);
    const publishKit = formats.includes("publish-kit") ? ex.writePublishKit({ t, publish: p.publish[lang] ?? null, credits, lang }) : null;
    const editorialReport = formats.includes("editorial-report") && facts && factCheck
      ? ex.writeEditorialReport({ t, facts, factCheck, ledger, usage, voice, lang })
      : null;
    const ref = ctx.options.timelineOnly || !formats.includes("reference-mp4") ? null : await upToDateRender(ctx, lang, t);
    const readme = ex.exportReadme({ t, formats, exportRoot: p.export.exportRoot, asOf: p.editorial.asOf, hasReference: ref !== null, lang });
    ctx.progress(0.6, "writing the export bundle");
    const bundle = await ex.writeExportBundle({
      t, projectDir: ctx.store.dir, exportDir: exportDirAbs, formats, exportRoot: p.export.exportRoot, fcpxmlVersion: p.export.fcpxmlVersion,
      conformed, referenceMp4: ref ? ctx.store.abs(ref.rel) : null, credits, publishKit, editorialReport, readme,
    }, exportCtx(ctx));
    // README.md is the stage's completion marker (the bundle writer normally writes it; make sure it exists)
    if (!(await ctx.store.exists(exportReadmeRel(lang)))) await writeTextIfChanged(ctx.store.abs(exportReadmeRel(lang)), readme);
    if (!ref) emitLog(ctx, "export", "info", `${lang}: no up-to-date render — the bundle has no reference.mp4`);
    for (const f of bundle.files) {
      const rel = path.isAbsolute(f) ? path.relative(ctx.store.dir, f).split(path.sep).join("/") : `${P.exportDir(lang)}${f}`;
      ctx.emit({ type: "artifact", stage: "export", lang, path: rel, kind: "export" });
    }
    return { artifacts: [exportReadmeRel(lang), P.credits(lang)] };
  },
};
