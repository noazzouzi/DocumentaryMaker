// Package adapters (SPEC §0.1 P1, §16.5): every call the engine makes into another workspace package goes through
// EngineDeps, so tests (and the walking skeleton) can substitute fakes for packages whose M1 has not landed yet.
import * as stylesPkg from "@docmaker/styles";
import * as llmPkg from "@docmaker/llm";
import * as assetsPkg from "@docmaker/assets";
import * as voicePkg from "@docmaker/voice";
import * as audioPkg from "@docmaker/audio";
import * as directorPkg from "@docmaker/director";
import * as exportPkg from "@docmaker/export";
import { isDocmakerError, type Logger, type RuntimeConfig } from "@docmaker/core";

export type StylesApi = Pick<typeof stylesPkg,
  "discoverStyles" | "suggestStyleOffline" | "riskFlagsOffline" | "classifyTopicOffline" | "scaffoldStyle" | "inspectStyleDir" | "builtinStylesDir" | "styleFontAssets">;
export type LlmApi = Pick<typeof llmPkg,
  | "createLlmClient" | "runResearch" | "buildFactSheet" | "suggestStyle" | "planBudget" | "writeOutline" | "validateOutline"
  | "writeChapterWithTitle" | "reviseChapter" | "lintScript" | "segmentSkeleton" | "planBeats" | "assembleBeatPlans" | "sliceBeats"
  | "validateBeats" | "factCheck" | "deterministicFactChecks" | "recheck" | "makeReranker" | "estimateStepCost" | "transcreateSegment">;
export type FrozenCacheLike = assetsPkg.AssetsCtx["cache"];
export type AssetsApi = Pick<typeof assetsPkg,
  | "createHttpClient" | "resolveAssets" | "freezeFile" | "conformAudio" | "validatePick" | "buildCredits" | "verifyQuotes" | "resolveEntity"
  | "liveSearch" | "freezeCandidate" | "importUpload" | "importLocalDir" | "resolveManualClip" | "ytProbe"> & {
  createFrozenCache(o: { config: RuntimeConfig; logger: Logger }): FrozenCacheLike;
};
export type VoiceApi = Pick<typeof voicePkg,
  | "buildTtsText" | "synthesizeTrack" | "importRecording" | "voiceSettingsHash" | "editedAfterTake" | "estimateTtsCost" | "createTtsProvider"
  | "calibrateVoice" | "teleprompterHtml" | "ensureModel" | "voiceLicense">;
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

/** A §4.19 P0 stub error ("not implemented: <pkg>.<fn>"). */
export function isNotImplemented(e: unknown): boolean {
  return isDocmakerError(e) && e.code === "INTERNAL" && /^not implemented: /.test(e.message);
}

function isThenable(v: unknown): v is Promise<unknown> {
  return typeof v === "object" && v !== null && typeof (v as { then?: unknown }).then === "function";
}

/** Calls `real`; when it is still a P0 stub (sync throw or rejected promise) calls `fake` with the same arguments. */
function fallbackFn(real: (...a: unknown[]) => unknown, fake: (...a: unknown[]) => unknown, onFallback?: (name: string) => void, name = "?") {
  return (...args: unknown[]): unknown => {
    try {
      const r = real(...args);
      if (isThenable(r)) {
        return r.catch((e: unknown) => {
          if (!isNotImplemented(e)) throw e;
          onFallback?.(name);
          return fake(...args);
        });
      }
      return r;
    } catch (e) {
      if (!isNotImplemented(e)) throw e;
      onFallback?.(name);
      return fake(...args);
    }
  };
}

/** Object whose methods try `real` first and fall back to `fake` on P0 stub errors (used for FrozenCache instances). */
export function fallbackObject<T extends object>(real: T, fake: T, onFallback?: (name: string) => void): T {
  const out: Record<string, unknown> = {};
  const keys = new Set<string>();
  for (let o: object | null = fake; o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) keys.add(k);
  for (const k of keys) {
    if (k === "constructor") continue;
    const f = (fake as Record<string, unknown>)[k];
    const r = (real as Record<string, unknown>)[k];
    if (typeof f === "function") {
      out[k] = typeof r === "function"
        ? fallbackFn((r as (...a: unknown[]) => unknown).bind(real), (f as (...a: unknown[]) => unknown).bind(fake), onFallback, k)
        : (f as (...a: unknown[]) => unknown).bind(fake);
    } else out[k] = r ?? f;
  }
  return out as T;
}

/**
 * Walking-skeleton composition (§16.5): each API member of `real` that is still a P0 stub transparently falls back to the
 * member of `fakes` with the same name. As soon as a package lands its implementation, the real code runs.
 */
export function withStubFallback(real: EngineDeps, fakes: Partial<{ [K in keyof EngineDeps]: Partial<EngineDeps[K]> }>, onFallback?: (name: string) => void): EngineDeps {
  const out = { ...real } as Record<string, unknown>;
  for (const [pkg, fakeApi] of Object.entries(fakes) as [keyof EngineDeps, Record<string, unknown> | undefined][]) {
    if (!fakeApi) continue;
    const realApi = real[pkg] as unknown as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...realApi };
    for (const [k, f] of Object.entries(fakeApi)) {
      const r = realApi[k];
      if (typeof f !== "function") {
        merged[k] = r ?? f;
        continue;
      }
      if (pkg === "assets" && k === "createFrozenCache" && typeof r === "function") {
        merged[k] = (o: unknown) => fallbackObject((r as (o: unknown) => object)(o), (f as (o: unknown) => object)(o), onFallback);
        continue;
      }
      merged[k] = typeof r === "function"
        ? fallbackFn(r as (...a: unknown[]) => unknown, f as (...a: unknown[]) => unknown, onFallback, `${pkg}.${k}`)
        : f;
    }
    out[pkg] = merged;
  }
  return out as unknown as EngineDeps;
}
