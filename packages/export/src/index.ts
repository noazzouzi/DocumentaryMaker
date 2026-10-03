// @docmaker/export — public API (packages/export/src/index.ts, SPEC §4.19 + additive exports).
// NLE export: Timeline (+ conform map) → ExportTimeline → FCPXML / xmeml / OTIO / marker EDL / SRT + bundle.
import type { ExportFormat, ExportTimeline, FactCheck, FactSheet, Lang, Ledger, PublishInfo, Timeline, UsageDoc, VoiceTrack } from "@docmaker/core";
import { writeExportBundle as writeBundleImpl } from "./bundle";
import { conformForNle as conformImpl } from "./conform";
import { writeMarkersEdl as edlImpl } from "./edl";
import { writeFcpxml as fcpxmlImpl } from "./fcpxml";
import { writeOtio as otioImpl } from "./otio";
import { writePublishKit as publishImpl } from "./publish";
import { writeEditorialReport as reportImpl } from "./report";
import { exportReadme as readmeImpl } from "./readme";
import { writeSrt as srtImpl } from "./srt";
import { toExportTimeline as toEtImpl } from "./toExportTimeline";
import type { ConformMap, ExportCtx } from "./types";
import { writeXmeml as xmemlImpl } from "./xmeml";

export type { ConformedMedia, ConformMap, ExportCtx } from "./types";
export { STEM_NAMES, clipWavKey, framingOf, mirroredSfxKey, overlayKey, pictureKey, stemKey } from "./types";
export { conformName, fileUrl, safeStem, writtenPathFor, xmemlPathUrl } from "./paths";
export { clipMotion, gainKeys, isSparseCamera } from "./keyframes";
export { coverFilter, coverRect, planConform } from "./conform";
export { loopPieces, packLanes } from "./toExportTimeline";
export { allMarkers } from "./edl";
export { bundleFileNames, nonPortableSummary } from "./readme";
export { srtGroups, wrapLines } from "./srt";
export { CROSS_DISSOLVE_UID, fcpFormatName } from "./fcpxml";
export { chapterLines, chapterStamp } from "./publish";
export { assetSpans, clipUsage } from "./report";

/** Copies/hardlinks + converts media into export/<lang>/media/ (stills cover-cropped to 1920×1080 from VisualSource crop/focal). */
export function conformForNle(t: Timeline, i: { projectDir: string; exportDir: string; generatedStills: Record<string, string>; overlays: Record<string, string> | null; stems: Record<string, string> }, ctx: ExportCtx): Promise<ConformMap> {
  return conformImpl(t, i, ctx);
}
/** Reads ONLY the Timeline (+ the conform map) — never picks.json. */
export function toExportTimeline(t: Timeline, ctx: { exportDir: string; exportRoot: string | null; conformed: ConformMap }): ExportTimeline {
  return toEtImpl(t, ctx);
}
export function writeFcpxml(et: ExportTimeline, o: { version: "1.10" | "1.11" | "1.13" }): string {
  return fcpxmlImpl(et, o);
}
export function writeXmeml(et: ExportTimeline, o: { flavour: "premiere" | "resolve" }): string {
  return xmemlImpl(et, o);
}
export function writeOtio(et: ExportTimeline, o: { premiereMetadata: boolean }): string {
  return otioImpl(et, o);
}
export function writeMarkersEdl(et: ExportTimeline): string {
  return edlImpl(et);
}
export function writeSrt(t: Timeline): string {
  return srtImpl(t);
} // non-burned "srt"/"clip"/"translation" groups only (never "keywords")
export function writePublishKit(i: { t: Timeline; publish: PublishInfo | null; credits: string; lang: Lang }): string {
  return publishImpl(i);
} // publish.<lang>.md
export function writeEditorialReport(i: { t: Timeline; facts: FactSheet; factCheck: FactCheck; ledger: Ledger; usage: UsageDoc; voice: VoiceTrack | null; lang: Lang }): string {
  return reportImpl(i);
}
export function exportReadme(i: { t: Timeline; formats: ExportFormat[]; exportRoot: string | null; asOf: string; hasReference: boolean; lang: Lang }): string {
  return readmeImpl(i);
}
export function writeExportBundle(i: {
  t: Timeline; projectDir: string; exportDir: string; formats: ExportFormat[]; exportRoot: string | null; fcpxmlVersion: "1.10" | "1.11" | "1.13";
  conformed: ConformMap; referenceMp4: string | null; credits: string; publishKit: string | null; editorialReport: string | null; readme: string;
}, ctx: ExportCtx): Promise<{ dir: string; files: string[] }> {
  return writeBundleImpl(i, ctx);
}
