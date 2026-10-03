// Package adapters (SPEC §0.1 P1, §16.5): every call the engine makes into another workspace package goes through
// EngineDeps, so tests can wrap or replace single functions (spies, failure injection). Every package has landed (P2):
// the P0 stub-fallback composition is gone and REAL_DEPS is the only full implementation.
import * as stylesPkg from "@docmaker/styles";
import * as llmPkg from "@docmaker/llm";
import * as assetsPkg from "@docmaker/assets";
import * as voicePkg from "@docmaker/voice";
import * as audioPkg from "@docmaker/audio";
import * as directorPkg from "@docmaker/director";
import * as exportPkg from "@docmaker/export";
import type { Logger, RuntimeConfig } from "@docmaker/core";

export type StylesApi = Pick<typeof stylesPkg,
  "discoverStyles" | "suggestStyleOffline" | "riskFlagsOffline" | "classifyTopicOffline" | "scaffoldStyle" | "inspectStyleDir" | "builtinStylesDir" | "styleFontAssets">;
export type LlmApi = Pick<typeof llmPkg,
  | "createLlmClient" | "runResearch" | "buildFactSheet" | "suggestStyle" | "planBudget" | "writeOutline" | "validateOutline"
  | "writeChapterWithTitle" | "reviseChapter" | "lintScript" | "segmentSkeleton" | "planBeats" | "assembleBeatPlans" | "sliceBeats"
  | "validateBeats" | "factCheck" | "deterministicFactChecks" | "recheck" | "makeReranker" | "estimateStepCost" | "transcreateSegment">;
export type FrozenCacheLike = assetsPkg.AssetsCtx["cache"];
export type AssetsApi = Pick<typeof assetsPkg,
  | "createHttpClient" | "resolveAssets" | "freezeFile" | "conformAudio" | "validatePick" | "buildCredits" | "verifyQuotes" | "resolveEntity"
  | "liveSearch" | "freezeCandidate" | "importUpload" | "importLocalDir" | "resolveManualClip" | "ytProbe" | "videoVerifiedQuotes" | "requireDeclaration" | "collectReferencedBlobs" | "readUserFrozen"> & {
  createFrozenCache(o: { config: RuntimeConfig; logger: Logger }): FrozenCacheLike;
};
export type VoiceApi = Pick<typeof voicePkg,
  | "buildTtsText" | "synthesizeTrack" | "importRecording" | "voiceSettingsHash" | "editedAfterTake" | "estimateTtsCost" | "createTtsProvider"
  | "calibrateVoice" | "teleprompterHtml" | "ensureModel" | "voiceLicense" | "installWhisperCppRuntime" | "ensureFasterWhisperModel" | "fasterWhisperModelPresent">;
export type AudioApi = Pick<typeof audioPkg,
  "ensureSfxPack" | "loadSfxEntries" | "generateMusic" | "scanMusicLibrary" | "assembleVoProgram" | "mixTimeline" | "densityReport">;
export type DirectorApi = Pick<typeof directorPkg, "layoutProgram" | "direct" | "DIRECTOR_VERSION">;
export type ExportApi = Pick<typeof exportPkg,
  | "conformForNle" | "toExportTimeline" | "writeFcpxml" | "writeXmeml" | "writeOtio" | "writeMarkersEdl" | "writeSrt" | "writePublishKit"
  | "writeEditorialReport" | "exportReadme" | "writeExportBundle">;

export interface EngineDeps {
  styles: StylesApi;
  llm: LlmApi;
  assets: AssetsApi;
  voice: VoiceApi;
  audio: AudioApi;
  director: DirectorApi;
  exporter: ExportApi;
}

/** The real workspace packages. */
export const REAL_DEPS: EngineDeps = {
  styles: stylesPkg,
  llm: llmPkg,
  assets: { ...assetsPkg, createFrozenCache: (o) => new assetsPkg.FrozenCache(o) },
  voice: voicePkg,
  audio: audioPkg,
  director: directorPkg,
  exporter: exportPkg,
};
