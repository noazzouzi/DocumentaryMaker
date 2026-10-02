// @docmaker/assets — public API (packages/assets/src/index.ts). Owns all network I/O (HttpClient), licences, frozen cache.
// P0 API stub (SPEC §4.19): every function throws DocmakerError("INTERNAL", "not implemented: …") until its owner lands it.
import { notImplemented } from "./notImplemented";
import type {
  AssetKind, AssetPick, AssetProvider, AssetProviderId, AssetQuery, BeatPlan, BeatPlansDoc, Candidate, CandidateRecord,
  CandidatesDoc, CandidateScore, ClipResolution, ClipWordsDoc, CostTracker, CueType, EntitiesDoc, FactSheet, FrozenAsset,
  FrozenDoc, HttpClient, Lang, Ledger, LicenseInfo, LicensePolicy, LintIssue, LocalIndexDoc, Logger, MediaRole, MusicDoc,
  PicksDoc, Progress, Project, Reranker, RuntimeConfig, Script, Secrets, SfxEntry, StyleData, UploadDeclaration, UsageDoc,
  UserPicksDoc, VerificationItem, VoiceTrack, WordTiming,
} from "@docmaker/core";

export interface AssetsCtx { config: RuntimeConfig; secrets: Secrets; logger: Logger; http: HttpClient; signal: AbortSignal; progress: Progress; costs: CostTracker; cache: FrozenCache }

// ---- http (offline → throws OFFLINE before any socket; SSRF guard; per-host UA; TTL cache; size caps)
export function createHttpClient(o: { config: RuntimeConfig; logger: Logger }): HttpClient {
  throw notImplemented("assets.createHttpClient");
}

// ---- providers & licences
export function allProviders(): AssetProvider[] {
  throw notImplemented("assets.allProviders");
} // the 12 providers of §7.2, in default priority order
export function providerById(id: AssetProviderId): AssetProvider {
  throw notImplemented("assets.providerById");
}
export interface PolicyVerdict { allowed: boolean; reasons: string[]; flags: string[] }
export class LicensePolicyEngine {
  /** P0 stub: constructor arguments are kept for inspection in tests. */
  readonly stubArgs: readonly unknown[];
  constructor(policy: LicensePolicy, ctx: { monetized: boolean; fairUseAcknowledged: boolean }) {
    this.stubArgs = [policy, ctx];
  }
  evaluate(license: LicenseInfo, beat: { personIds: string[]; cueTypes: CueType[] } | null): PolicyVerdict {
    throw notImplemented("assets.LicensePolicyEngine.evaluate");
  }
}
/** Server-side re-check of ANY pick (auto, user PUT, replaceSource override, upload): licence policy, AI-GENERATED + people,
 *  stock look-alikes on person/negative beats, minors/private persons without person-ack. Errors = POLICY_DENIED. */
export function validatePick(i: {
  pick: AssetPick; plan: BeatPlan | null; asset: FrozenAsset; policy: LicensePolicy; editorial: Project["editorial"];
  facts: FactSheet; personAcks: readonly string[];
}): LintIssue[] {
  throw notImplemented("assets.validatePick");
}
export function buildAiDenylist(facts: FactSheet, entities: EntitiesDoc): Set<string> {
  throw notImplemented("assets.buildAiDenylist");
} // normWord tokens ≥ 3 chars of names, aliases, speakers
export function checkFalPrompt(prompt: string, denylist: ReadonlySet<string>): { ok: boolean; reason: string | null } {
  throw notImplemented("assets.checkFalPrompt");
}

// ---- frozen cache & conform
export class FrozenCache {
  /** P0 stub: constructor arguments are kept for inspection in tests. */
  readonly stubArgs: readonly unknown[];
  constructor(o: { config: RuntimeConfig; logger: Logger }) {
    this.stubArgs = [o];
  }
  put(file: string, ext: string): Promise<{ sha256: string; cacheRel: string; bytes: number }> {
    throw notImplemented("assets.FrozenCache.put");
  }
  has(sha256: string): Promise<boolean> {
    throw notImplemented("assets.FrozenCache.has");
  }
  linkIntoProject(sha256: string, ext: string, projectDir: string): Promise<string> {
    throw notImplemented("assets.FrozenCache.linkIntoProject");
  } // → media/<id>.<ext>
  gc(o: { referenced: ReadonlySet<string>; capBytes: number }): Promise<{ freedBytes: number; removed: number }> {
    throw notImplemented("assets.FrozenCache.gc");
  }
}
export interface ConformResult {
  file: string; ext: "jpg" | "png" | "mp4" | "wav"; width: number | null; height: number | null; durationMs: number | null; fps: number | null;
  hasAudio: boolean; lufs: number | null; recipe: string; sourceInMs: number | null; sourceOutMs: number | null;
  handleHeadMs: number; handleTailMs: number; analysis: FrozenAsset["analysis"];
}
export function conformImage(src: string, outDir: string, ctx: AssetsCtx): Promise<ConformResult> {
  throw notImplemented("assets.conformImage");
}
export function conformVideo(src: string, outDir: string, o: { fps: number; inMs: number | null; outMs: number | null; handleMs: number }, ctx: AssetsCtx): Promise<ConformResult> {
  throw notImplemented("assets.conformVideo");
}
export function conformClip(src: string, outDir: string, o: { fps: number; passageInMs: number; passageOutMs: number; handleMs: number }, ctx: AssetsCtx): Promise<ConformResult & { passageInMs: number; passageOutMs: number }> {
  throw notImplemented("assets.conformClip");
}
export function conformAudio(src: string, outDir: string, o: { targetLufs: number }, ctx: AssetsCtx): Promise<ConformResult> {
  throw notImplemented("assets.conformAudio");
}
/** conform → cache.put → link → FrozenAsset (used by the stage, the music step in the engine, uploads, manual clips). */
export function freezeFile(i: { file: string; kind: AssetKind; role: MediaRole; candidate: Candidate | null; declaration: UploadDeclaration | null; conform: ConformResult; projectDir: string }, ctx: AssetsCtx): Promise<FrozenAsset> {
  throw notImplemented("assets.freezeFile");
}

// ---- planning, ranking, picking
export function planQueries(i: { plan: BeatPlan; facts: FactSheet; entities: EntitiesDoc; style: StyleData; personAcks: readonly string[] }): AssetQuery[] {
  throw notImplemented("assets.planQueries");
}
export function shotsNeeded(plan: BeatPlan, style: StyleData): number {
  throw notImplemented("assets.shotsNeeded");
} // clamp(round(est/(asl·mul)),1,4); photo_burst → count; montage → 4
export function metadataScore(c: Candidate, plan: BeatPlan, all: readonly Candidate[]): number {
  throw notImplemented("assets.metadataScore");
}
export function rankCandidates(i: { plan: BeatPlan; records: CandidateRecord[]; reranked: Map<number, Partial<CandidateScore>> | null }): { record: CandidateRecord; score: CandidateScore }[] {
  throw notImplemented("assets.rankCandidates");
}
export function pickAssets(i: { plan: BeatPlan; ranked: { record: CandidateRecord; score: CandidateScore }[]; shots: number; recentUse: ReadonlyMap<string, number> }): { candidate: Candidate; score: CandidateScore; slot: number }[] {
  throw notImplemented("assets.pickAssets");
}
export function needsVisionRerank(plan: BeatPlan, top: readonly CandidateScore[], mode: "off" | "selective" | "all"): boolean {
  throw notImplemented("assets.needsVisionRerank");
}

// ---- the assets stage (minus SFX pack and music, which the engine prepares through @docmaker/audio)
export interface AssetsStageInput {
  project: Project; plans: BeatPlansDoc; facts: FactSheet; entities: EntitiesDoc; style: StyleData; primaryScript: Script;
  userPicks: UserPicksDoc; previous: { picks: PicksDoc | null; frozen: FrozenDoc | null; ledger: Ledger | null };
  projectDir: string; reranker: Reranker | null; personAcks: readonly string[];
}
export interface AssetsStageOutput { picks: PicksDoc; frozen: FrozenDoc; ledger: Ledger; candidates: CandidatesDoc[]; clipWords: ClipWordsDoc[] }
export function resolveAssets(i: AssetsStageInput, ctx: AssetsCtx): Promise<AssetsStageOutput> {
  throw notImplemented("assets.resolveAssets");
}

// ---- interactive (web scene board / CLI)
export function liveSearch(i: { query: AssetQuery; providers: AssetProviderId[]; allowPaid: boolean; policy: LicensePolicy; editorial: Project["editorial"]; projectDir: string }, ctx: AssetsCtx): Promise<CandidateRecord[]> {
  throw notImplemented("assets.liveSearch");
} // records are cached server-side for freeze
/** The server re-derives the Candidate from assets/candidates/<beatId>.json or the live-search cache; client licence data is ignored. */
export function freezeCandidate(i: { projectDir: string; beatId: string; provider: AssetProviderId; providerAssetId: string }, ctx: AssetsCtx): Promise<FrozenAsset> {
  throw notImplemented("assets.freezeCandidate");
}
export function importUpload(i: { file: string; declaration: UploadDeclaration; projectDir: string }, ctx: AssetsCtx): Promise<FrozenAsset> {
  throw notImplemented("assets.importUpload");
}
export function importLocalDir(i: { dir: string; declaration: UploadDeclaration; tags: string[]; projectDir: string; previous: LocalIndexDoc | null }, ctx: AssetsCtx): Promise<LocalIndexDoc> {
  throw notImplemented("assets.importLocalDir");
}
export function resolveManualClip(i: { projectDir: string; segmentId: string; quoteId: string; url: string | null; file: string | null; startMs: number; endMs: number; channel: string; title: string; fps: number }, ctx: AssetsCtx): Promise<{ clip: ClipResolution; frozen: FrozenAsset; words: ClipWordsDoc | null }> {
  throw notImplemented("assets.resolveManualClip");
}

// ---- research helpers (network lives here)
export function resolveEntity(name: string, lang: Lang, ctx: { http: HttpClient; signal: AbortSignal }): Promise<{ qid: string; label: string; aliases: string[] } | null> {
  throw notImplemented("assets.resolveEntity");
}
/** Offline/fixture → every quote stays "unchecked" with items {check:"quote-verbatim", ok:false, detail:"skipped-offline"}. */
export function verifyQuotes(fs: FactSheet, ctx: { http: HttpClient | null; offline: boolean; signal: AbortSignal }): Promise<{ factSheet: FactSheet; items: VerificationItem[] }> {
  throw notImplemented("assets.verifyQuotes");
}

// ---- credits
export function buildCredits(i: { ledger: Ledger; usage: UsageDoc; lang: Lang; voice: VoiceTrack | null; music: MusicDoc; sfx: readonly SfxEntry[] }): string {
  throw notImplemented("assets.buildCredits");
}

// ---- procedural provider (offline, deterministic) — every recipe is executed by a unit test (ffmpeg 6.1)
export const PROCEDURAL_RECIPES: readonly { id: string; kind: "image" | "video"; args: (o: { seed: number; palette: string[]; fps: number; seconds: number }) => string[] }[] = [];
export function proceduralAsset(i: { recipe: string; seed: number; palette: string[]; fps: number; seconds: number; outDir: string }, ctx: AssetsCtx): Promise<string> {
  throw notImplemented("assets.proceduralAsset");
}

// ---- YouTube (local yt-dlp)
export function ytSearch(q: string, ctx: AssetsCtx): Promise<{ id: string; title: string; durationSec: number; channel: string; channelVerified: boolean; views: number }[]> {
  throw notImplemented("assets.ytSearch");
}
export function ytFetchTranscript(videoId: string, lang: string, ctx: AssetsCtx): Promise<{ words: WordTiming[]; kind: "manual" | "asr-orig" | "asr" | "translated" | "local-asr" | "none"; lang: string | null }> {
  throw notImplemented("assets.ytFetchTranscript");
}
export function ytDownload(videoId: string, o: { sectionMs: [number, number] | null; outDir: string }, ctx: AssetsCtx): Promise<string> {
  throw notImplemented("assets.ytDownload");
}
export function parseJson3(json: unknown): WordTiming[] {
  throw notImplemented("assets.parseJson3");
}
export function findPassage(quote: string, words: readonly WordTiming[], o: { maxClipMs: number }): { score: number; startMs: number; endMs: number; matchedText: string } | null {
  throw notImplemented("assets.findPassage");
}
export function mapYtError(stderr: string): "YT_RATE_LIMIT" | "YT_BOT_CHECK" | "YT_FORBIDDEN" | "YT_UNAVAILABLE" | null {
  throw notImplemented("assets.mapYtError");
}
export function ytProbe(ctx: AssetsCtx): Promise<"ok" | "bot-check" | "403" | "missing" | "offline"> {
  throw notImplemented("assets.ytProbe");
} // doctor
