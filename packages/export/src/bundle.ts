// writeExportBundle (§13.5): the export/<lang>/ folder. Builds the ExportTimeline from the Timeline + conform map,
// runs the selected writers, writes credits / publish kit / editorial report / README atomically, hardlinks the
// reference render when given, and removes bundle files of formats that are no longer selected.
import { copyFile, link, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExportFormat, Timeline } from "@docmaker/core";
import { writeMarkersEdl } from "./edl";
import { writeFcpxml } from "./fcpxml";
import { writeOtio } from "./otio";
import { bundleFileNames } from "./readme";
import { writeSrt } from "./srt";
import { toExportTimeline } from "./toExportTimeline";
import type { ConformMap, ExportCtx } from "./types";
import { writeXmeml } from "./xmeml";

export interface BundleInput {
  t: Timeline; projectDir: string; exportDir: string; formats: ExportFormat[]; exportRoot: string | null; fcpxmlVersion: "1.10" | "1.11" | "1.13";
  conformed: ConformMap; referenceMp4: string | null; credits: string; publishKit: string | null; editorialReport: string | null; readme: string;
}

async function writeAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, file);
}

export async function writeExportBundle(i: BundleInput, ctx: ExportCtx): Promise<{ dir: string; files: string[] }> {
  const dir = i.exportDir;
  await mkdir(dir, { recursive: true });
  const names = bundleFileNames(i.t);
  const want = new Set(i.formats);
  const conformed: ConformMap = want.has("stems") ? i.conformed : Object.fromEntries(Object.entries(i.conformed).filter(([k]) => !k.startsWith("stem:")));
  const et = toExportTimeline(i.t, { exportDir: dir, exportRoot: i.exportRoot, conformed });
  const outputs: [string, () => string, boolean][] = [
    [names.fcpxml, () => writeFcpxml(et, { version: i.fcpxmlVersion }), want.has("fcpxml")],
    [names.premiere, () => writeXmeml(et, { flavour: "premiere" }), want.has("xmeml-premiere")],
    [names.resolve, () => writeXmeml(et, { flavour: "resolve" }), want.has("xmeml-resolve")],
    [names.otio, () => writeOtio(et, { premiereMetadata: true }), want.has("otio")],
    [names.edl, () => writeMarkersEdl(et), want.has("markers-edl")],
    [names.srt, () => writeSrt(i.t), want.has("srt")],
    [names.credits, () => i.credits, true],
    [names.publish, () => i.publishKit ?? "", i.publishKit !== null],
    [names.report, () => i.editorialReport ?? "", i.editorialReport !== null],
    [names.readme, () => i.readme, true],
  ];
  const files: string[] = [];
  for (const [name, make, on] of outputs) {
    if (ctx.signal.aborted) break;
    const file = path.join(dir, name);
    if (!on) {
      await rm(file, { force: true });
      continue;
    }
    await writeAtomic(file, make());
    files.push(file);
  }
  const ref = path.join(dir, names.reference);
  await rm(ref, { force: true });
  if (i.referenceMp4 && want.has("reference-mp4")) {
    try {
      await link(i.referenceMp4, ref);
    } catch {
      await copyFile(i.referenceMp4, ref);
    }
    files.push(ref);
  }
  // stems are conformed straight into stems/ (they are listed when present and selected)
  if (want.has("stems")) {
    for (const [k, cm] of Object.entries(conformed)) if (k.startsWith("stem:")) files.push(cm.localPath);
  } else {
    await rm(path.join(dir, "stems"), { recursive: true, force: true });
  }
  ctx.logger.info(`export: wrote ${files.length} file(s) to ${dir}`, { media: et.media.length, tracks: et.video.length + et.audio.length });
  return { dir, files };
}
