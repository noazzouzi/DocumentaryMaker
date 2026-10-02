// @docmaker/export — public API (packages/export/src/index.ts).
// P0 API stub (SPEC §4.19): every function throws DocmakerError("INTERNAL", "not implemented: …") until its owner lands it.
import { notImplemented } from "./notImplemented";
import type {
  ExportFormat, ExportTimeline, FactCheck, FactSheet, Lang, Ledger, Logger, PublishInfo, RuntimeConfig, Timeline, UsageDoc, VoiceTrack,
} from "@docmaker/core";

export interface ConformedMedia { assetId: string | null; localPath: string; name: string; kind: "video" | "image" | "audio"; width: number | null; height: number | null; durationFrames: number | null; hasVideo: boolean; hasAudio: boolean; audioChannels: number | null; alpha: boolean }
export type ConformMap = Record<string, ConformedMedia>; // key: assetId | "gen:<clipId>" | "ovl:<itemId>" | "stem:<name>" | "vo:<segmentId>"
export interface ExportCtx { config: RuntimeConfig; logger: Logger; signal: AbortSignal }

/** Copies/hardlinks + converts media into export/<lang>/media/ (stills cover-cropped to 1920×1080 from VisualSource crop/focal). */
export function conformForNle(t: Timeline, i: { projectDir: string; exportDir: string; generatedStills: Record<string, string>; overlays: Record<string, string> | null; stems: Record<string, string> }, ctx: ExportCtx): Promise<ConformMap> {
  throw notImplemented("export.conformForNle");
}
/** Reads ONLY the Timeline (+ the conform map) — never picks.json. */
export function toExportTimeline(t: Timeline, ctx: { exportDir: string; exportRoot: string | null; conformed: ConformMap }): ExportTimeline {
  throw notImplemented("export.toExportTimeline");
}
export function writeFcpxml(et: ExportTimeline, o: { version: "1.10" | "1.11" | "1.13" }): string {
  throw notImplemented("export.writeFcpxml");
}
export function writeXmeml(et: ExportTimeline, o: { flavour: "premiere" | "resolve" }): string {
  throw notImplemented("export.writeXmeml");
}
export function writeOtio(et: ExportTimeline, o: { premiereMetadata: boolean }): string {
  throw notImplemented("export.writeOtio");
}
export function writeMarkersEdl(et: ExportTimeline): string {
  throw notImplemented("export.writeMarkersEdl");
}
export function writeSrt(t: Timeline): string {
  throw notImplemented("export.writeSrt");
} // non-burned "srt"/"clip"/"translation" groups only (never "keywords")
export function writePublishKit(i: { t: Timeline; publish: PublishInfo | null; credits: string; lang: Lang }): string {
  throw notImplemented("export.writePublishKit");
} // publish.<lang>.md
export function writeEditorialReport(i: { t: Timeline; facts: FactSheet; factCheck: FactCheck; ledger: Ledger; usage: UsageDoc; voice: VoiceTrack | null; lang: Lang }): string {
  throw notImplemented("export.writeEditorialReport");
}
export function exportReadme(i: { t: Timeline; formats: ExportFormat[]; exportRoot: string | null; asOf: string; hasReference: boolean; lang: Lang }): string {
  throw notImplemented("export.exportReadme");
}
export function writeExportBundle(i: {
  t: Timeline; projectDir: string; exportDir: string; formats: ExportFormat[]; exportRoot: string | null; fcpxmlVersion: "1.10" | "1.11" | "1.13";
  conformed: ConformMap; referenceMp4: string | null; credits: string; publishKit: string | null; editorialReport: string | null; readme: string;
}, ctx: ExportCtx): Promise<{ dir: string; files: string[] }> {
  throw notImplemented("export.writeExportBundle");
}
