// @docmaker/assets — public API (packages/assets/src/index.ts). Owns all network I/O (HttpClient), licences, frozen cache.
import type {
  AssetProvider, AssetProviderId, ClipResolution, ClipWordsDoc, FrozenAsset, LocalIndexDoc, UploadDeclaration, WordTiming,
} from "@docmaker/core";
import type { AssetsCtx } from "./types";
import * as yt from "./youtube/ytdlp";
import { resolveManualClip as resolveManualClipImpl } from "./youtube/manual";
import { freezeCandidate as freezeCandidateImpl } from "./live";
import { importLocalDir as importLocalDirImpl, importUpload as importUploadImpl } from "./upload";
import { allProviders as allProvidersImpl, providerById as providerByIdImpl } from "./providers";
import { PROCEDURAL_RECIPES as RECIPES, proceduralAsset as proceduralAssetImpl } from "./providers/procedural";

export type { AssetsCtx } from "./types";

// ---- http (offline → throws OFFLINE before any socket; SSRF guard; per-host UA; TTL cache; size caps)
export { createHttpClient, guardUrl, isBlockedAddress, parseRetryAfter, redactUrl, CONTACT_RATE_LIMIT_HINT, needsContactHint, DEFAULT_MAX_BYTES, VIDEO_MAX_BYTES, HEADER_TIMEOUT_MS } from "./http";
export type { HttpClientInternals, LookupFn } from "./http";
export { QuotaBuckets } from "./quota";

// ---- providers & licences
/** The 12 providers of §7.2, in default priority order. */
export function allProviders(): AssetProvider[] {
  return allProvidersImpl();
}
export function providerById(id: AssetProviderId): AssetProvider {
  return providerByIdImpl(id);
}
export { createLocalProvider } from "./providers/local";
export { createProceduralProvider, recipeFor } from "./providers/procedural";
export { parseOpenverse } from "./providers/openverse";
export { parseCommons, commonsUrl } from "./providers/wikimedia";
export { parseIaMetadata, parseIaSearch, parseLoc, parseNasa, pickNasaAsset, pickLocImage } from "./providers/archives";
export { commercialMediaHint, iaLicenceTrusted, IA_TRUSTED_COLLECTIONS, IA_COMMUNITY_COLLECTIONS } from "./provenance";
export { parsePexelsPhotos, parsePexelsVideos, parsePixabayImages, parsePixabayVideos } from "./providers/stock";
export { parseBraveImages, falCandidate, falRequest } from "./providers/paid";
export { LicensePolicyEngine, licenseInfo, parseCcLicense, attributionText, declarationLicense, LICENSE_LABEL } from "./license";
export type { PolicyVerdict } from "./license";
/** Server-side re-check of ANY pick (auto, user PUT, replaceSource override, upload): licence policy, AI-GENERATED + people,
 *  stock look-alikes on person/negative beats, minors/private persons without person-ack. Errors = POLICY_DENIED. */
export { validatePick, licenseOfAsset, looksLikePeople, peopleRuleBlocks, PEOPLE_RE } from "./validate";
export { candidateNamesPerson, nonLikenessSubject, personNameTokenSets } from "./identity";
export { buildAiDenylist, checkFalPrompt, falAllowedForBeat, falPrompt, FAL_PROMPT_SUFFIX, FAL_NEGATIVE_PROMPT, PHOTOREAL_VOCABULARY } from "./denylist";

// ---- frozen cache & conform
export { FrozenCache, collectReferencedBlobs } from "./cache";
export type { ConformResult } from "./conform";
export { conformImage, conformVideo, conformClip, conformAudio, trimWindow, analyzePixels } from "./conform";
/** conform → cache.put → link → FrozenAsset (used by the stage, the music step in the engine, uploads, manual clips). */
export { freezeFile } from "./freeze";

// ---- planning, ranking, picking
export { planQueries, shotsNeeded, providerOrder, searchablePersons } from "./plan";
export { metadataScore, metadataParts, rankCandidates, needsVisionRerank, dHash, hamming, dedupeRecords, PROVIDER_PRIOR } from "./rank";
export { pickAssets } from "./pick";

// ---- the assets stage (minus SFX pack and music, which the engine prepares through @docmaker/audio)
export type { AssetsStageInput, AssetsStageOutput } from "./stage";
export { resolveAssets, videoVerifiedQuotes, activeProviders } from "./stage";

// ---- interactive (web scene board / CLI)
export { liveSearch } from "./live";
/** The server re-derives the Candidate from assets/candidates/<beatId>.json or the live-search cache; client licence data is ignored. */
export function freezeCandidate(i: { projectDir: string; beatId: string; provider: AssetProviderId; providerAssetId: string }, ctx: AssetsCtx): Promise<FrozenAsset> {
  return freezeCandidateImpl(i, ctx);
}
export function importUpload(i: { file: string; declaration: UploadDeclaration; projectDir: string }, ctx: AssetsCtx): Promise<FrozenAsset> {
  return importUploadImpl(i, ctx);
}
export function importLocalDir(i: { dir: string; declaration: UploadDeclaration; tags: string[]; projectDir: string; previous: LocalIndexDoc | null }, ctx: AssetsCtx): Promise<LocalIndexDoc> {
  return importLocalDirImpl(i, ctx);
}
export function resolveManualClip(i: { projectDir: string; segmentId: string; quoteId: string; url: string | null; file: string | null; startMs: number; endMs: number; channel: string; title: string; fps: number }, ctx: AssetsCtx): Promise<{ clip: ClipResolution; frozen: FrozenAsset; words: ClipWordsDoc | null }> {
  return resolveManualClipImpl(i, ctx);
}
export { requireDeclaration } from "./upload";
export { readUserFrozen, recordUserFrozen, USER_FROZEN_DIR } from "./userfrozen";

// ---- research helpers (network lives here)
export { resolveEntity, pickEntity } from "./entities";
/** Offline/fixture → every quote stays "unchecked" with items {check:"quote-verbatim", ok:false, detail:"skipped-offline"}. */
export { verifyQuotes, extractPageText, quoteMatchRatio } from "./verify";

// ---- credits
export { buildCredits, buildLedger, ledgerEntryFor } from "./ledger";

// ---- procedural provider (offline, deterministic) — every recipe is executed by a unit test (ffmpeg 6.1)
export const PROCEDURAL_RECIPES: readonly { id: string; kind: "image" | "video"; args: (o: { seed: number; palette: string[]; fps: number; seconds: number }) => string[] }[] = RECIPES;
export function proceduralAsset(i: { recipe: string; seed: number; palette: string[]; fps: number; seconds: number; outDir: string }, ctx: AssetsCtx): Promise<string> {
  return proceduralAssetImpl(i, ctx);
}

// ---- YouTube (local yt-dlp)
export function ytSearch(q: string, ctx: AssetsCtx): Promise<{ id: string; title: string; durationSec: number; channel: string; channelVerified: boolean; views: number }[]> {
  return yt.ytSearch(q, ctx);
}
export function ytFetchTranscript(videoId: string, lang: string, ctx: AssetsCtx): Promise<{ words: WordTiming[]; kind: "manual" | "asr-orig" | "asr" | "translated" | "local-asr" | "none"; lang: string | null }> {
  return yt.ytFetchTranscript(videoId, lang, ctx);
}
export function ytDownload(videoId: string, o: { sectionMs: [number, number] | null; outDir: string }, ctx: AssetsCtx): Promise<string> {
  return yt.ytDownload(videoId, o, ctx);
}
export { parseJson3, parseVtt, pickSubtitleTrack } from "./youtube/json3";
export { findPassage, smithWaterman, levRatio } from "./youtube/passage";
export function mapYtError(stderr: string): "YT_RATE_LIMIT" | "YT_BOT_CHECK" | "YT_FORBIDDEN" | "YT_UNAVAILABLE" | null {
  return yt.mapYtError(stderr);
}
/** doctor */
export function ytProbe(ctx: AssetsCtx): Promise<"ok" | "bot-check" | "403" | "missing" | "offline"> {
  return yt.ytProbe(ctx);
}
export { parseYtSearch, ytBaseFlags, parseYoutubeId } from "./youtube/ytdlp";
export { resolveClips } from "./youtube/clips";
export type { PassagePicker } from "./youtube/clips";
export { loadClip, clipSimTo01 } from "./clipsim";
