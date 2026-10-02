import { z } from "zod";
import {
  AssetId, BeatId, IsoDateTime, Lang, Ms, NormPoint, NormRect, PersonId, QuoteId, SegmentId, Sha16, Sha256, Unit,
  docVersion,
} from "./common";
import { AssetProviderId } from "./project";
import { LicenseInfo, UploadDeclaration } from "./license";
import { WordTiming } from "./voice";

export const AssetKind = z.enum(["image", "video", "audio"]);
export type AssetKind = z.infer<typeof AssetKind>;
export const MediaRole = z.enum([
  "broll", "archival", "clip", "portrait", "document", "music", "sfx", "vo", "generated", "user",
]);
export type MediaRole = z.infer<typeof MediaRole>;

export const AssetQuery = z.object({
  beatId: BeatId.nullable(),
  kind: AssetKind,
  role: MediaRole,
  text: z.string(), // English (most APIs)
  localText: z.string().nullable(), // optional query in the subject's language (Commons/LOC)
  entityQid: z.string().regex(/^Q\d+$/).nullable(), // Wikidata P180 depicts
  personIds: z.array(PersonId),
  orientation: z.enum(["landscape", "portrait", "any"]),
  minWidth: z.number().int().nonnegative(),
  durationSec: z.tuple([z.number(), z.number()]).nullable(),
  limit: z.number().int().positive(),
  lang: Lang.nullable(),
});
export type AssetQuery = z.infer<typeof AssetQuery>;

export const YoutubeRef = z.object({
  videoId: z.string(),
  channel: z.string(),
  channelVerified: z.boolean(),
  publishedAt: z.string(),
  url: z.string(),
  startMs: Ms.nullable(), // passage in the SOURCE video (null until found)
  endMs: Ms.nullable(),
  transcriptLang: z.string().nullable(),
  transcriptKind: z.enum(["manual", "asr-orig", "asr", "translated", "local-asr", "none", "user"]),
  matchScore: z.number().min(0).max(1).nullable(),
  matchedText: z.string(),
});
export type YoutubeRef = z.infer<typeof YoutubeRef>;

/** Search result. The provider payload is kept only in assets/candidates/<beatId>.json (CandidateRecord.raw). */
export const Candidate = z.object({
  provider: AssetProviderId,
  providerAssetId: z.string(),
  kind: AssetKind,
  title: z.string(),
  description: z.string(),
  tags: z.array(z.string()),
  previewUrl: z.string(), // thumbnail ≤ 768 px (for rerank)
  downloadUrl: z.string(), // "" for youtube (yt-dlp) and procedural
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationSec: z.number().nullable(),
  license: LicenseInfo,
  author: z.object({ name: z.string(), url: z.string().nullable() }).nullable(),
  sourcePageUrl: z.string(),
  retrievedAt: IsoDateTime,
  youtube: YoutubeRef.nullable(),
});
export type Candidate = z.infer<typeof Candidate>;

export const CandidateScore = z.object({
  metadata: Unit,
  clip: Unit.nullable(),
  vision: Unit.nullable(), // Claude rerank relevance/10
  technical: Unit.nullable(),
  watermark: z.boolean().nullable(),
  nsfw: z.boolean().nullable(),
  total: Unit,
  focal: NormPoint.nullable(), // Ken Burns / punch focal point
  safeCrop: NormRect.nullable(), // 16:9 safe crop
  notes: z.string(),
});
export type CandidateScore = z.infer<typeof CandidateScore>;

export const CandidateRecord = z.object({ candidate: Candidate, score: CandidateScore.nullable(), raw: z.unknown() });
export const CandidatesDoc = z.object({
  schemaVersion: docVersion("candidates"),
  beatId: BeatId,
  queries: z.array(AssetQuery),
  records: z.array(CandidateRecord),
});
export type CandidatesDoc = z.infer<typeof CandidatesDoc>;

export const FrozenAsset = z.object({
  id: AssetId, // sha256 of conformed bytes
  originalSha256: Sha256,
  kind: AssetKind,
  role: MediaRole,
  mime: z.string(),
  ext: z.enum(["jpg", "png", "mp4", "wav"]),
  bytes: z.number().int().positive(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: Ms.nullable(),
  fps: z.number().nullable(),
  hasAudio: z.boolean(),
  lufs: z.number().nullable(), // audio-bearing assets after normalisation
  cacheRel: z.string(), // blobs/ab/<sha256>.<ext> relative to DOCMAKER_HOME/cache
  projectRel: z.string(), // media/<id>.<ext> relative to the project dir (hardlink or copy)
  candidate: Candidate.nullable(), // null for procedural/user/generated-in-pipeline assets
  declaration: UploadDeclaration.nullable(), // uploads and local imports
  conform: z.object({
    recipe: z.string(), // "image-v1" | "video-cfr-v1" | "audio-norm-v1" | "clip-v1" | "proc-*-v1" | …
    sourceInMs: Ms.nullable(), // trimmed range in the ORIGINAL media (handles included)
    sourceOutMs: Ms.nullable(),
    handleHeadMs: Ms, // clips/b-roll: media kept BEFORE the wanted range (default 1000)
    handleTailMs: Ms, // media kept AFTER the wanted range (default 1000)
  }),
  analysis: z.object({
    grayscale: z.boolean().nullable(), // mean channel spread < 6/255 (sharp stats) → treatment "bw"
    meanLuma: z.number().nullable(),
    year: z.number().int().nullable(), // EXIF DateTimeOriginal / provider date → treatment "archival" if < 1970
    lowRes: z.boolean(), // image width < 1280
  }),
  frozenAt: IsoDateTime,
});
export type FrozenAsset = z.infer<typeof FrozenAsset>;
export const FrozenDoc = z.object({ schemaVersion: docVersion("frozen"), assets: z.record(AssetId, FrozenAsset) });
export type FrozenDoc = z.infer<typeof FrozenDoc>;

export const AssetPick = z.object({
  beatId: BeatId,
  slot: z.number().int().nonnegative(), // 0 = primary shot, 1.. = additional shots of this beat
  assetId: AssetId,
  role: z.enum(["primary", "alt"]),
  focal: NormPoint, // default {x:.5,y:.45}
  crop: NormRect.nullable(),
  sourceInMs: Ms.nullable(), // video in-point (relative to the conformed file)
  sourceOutMs: Ms.nullable(),
  score: CandidateScore,
  pickedBy: z.enum(["auto", "user"]),
  planKey: Sha16, // BeatPlan.planKey at pick time; mismatch → orphaned (shown, never applied)
});
export type AssetPick = z.infer<typeof AssetPick>;

export const ClipResolution = z.object({
  segmentId: SegmentId,
  quoteId: QuoteId,
  assetId: AssetId.nullable(), // conformed passage WITH handles (video+audio)
  status: z.enum(["found", "manual", "not-found", "skipped-offline", "skipped-policy", "failed"]),
  source: z.enum(["auto", "manual-url", "manual-file"]),
  youtube: YoutubeRef.nullable(),
  /** The quoted passage inside the CONFORMED file (handles excluded): layout uses passageOutMs - passageInMs. */
  passageInMs: Ms.nullable(),
  passageOutMs: Ms.nullable(),
  reason: z.string(),
});
export type ClipResolution = z.infer<typeof ClipResolution>;

/** assets/user-picks.json — USER input (scene board / CLI). Read-only for the assets stage; validated by validatePick on write. */
export const UserPicksDoc = z.object({
  schemaVersion: docVersion("userPicks"),
  picks: z.array(AssetPick),
  portraits: z.array(z.object({ personId: PersonId, assetId: AssetId })),
  clips: z.array(ClipResolution), // manual clip resolutions (URL/file + timecodes)
});
export type UserPicksDoc = z.infer<typeof UserPicksDoc>;


/** assets/picks.json — OUTPUT of the assets stage: auto picks merged with user picks (user wins per (beatId, slot)). */
export const PicksDoc = z.object({
  schemaVersion: docVersion("picks"),
  plansHash: Sha256,
  picks: z.array(AssetPick),
  clips: z.array(ClipResolution),
  portraits: z.array(z.object({ personId: PersonId, assetId: AssetId })),
  orphans: z.array(AssetPick), // user picks whose planKey no longer matches their beat
  updatedAt: IsoDateTime,
});
export type PicksDoc = z.infer<typeof PicksDoc>;

/** assets/clips/<segmentId>.json — transcript words, ms relative to the CONFORMED clip file start. */
export const ClipWordsDoc = z.object({
  schemaVersion: docVersion("clipWords"),
  segmentId: SegmentId,
  assetId: AssetId,
  words: z.array(WordTiming),
});
export type ClipWordsDoc = z.infer<typeof ClipWordsDoc>;

export const EntitiesDoc = z.object({
  schemaVersion: docVersion("entities"),
  entities: z.array(
    z.object({
      personId: PersonId,
      qid: z.string().regex(/^Q\d+$/).nullable(),
      label: z.string(),
      aliases: z.array(z.string()),
      resolvedBy: z.enum(["wbsearchentities", "user", "none"]),
    }),
  ),
});
export type EntitiesDoc = z.infer<typeof EntitiesDoc>;

export const LocalIndexDoc = z.object({
  schemaVersion: docVersion("localIndex"),
  files: z.array(
    z.object({
      path: z.string(), // absolute path at import time
      sha256: Sha256,
      kind: AssetKind,
      tokens: z.array(z.string()),
      tags: z.array(z.string()),
      declaration: UploadDeclaration,
    }),
  ),
});
export type LocalIndexDoc = z.infer<typeof LocalIndexDoc>;

export const LedgerEntry = z.object({
  assetId: AssetId,
  provider: z.union([AssetProviderId, z.literal("voice")]),
  title: z.string(),
  sourcePageUrl: z.string(),
  fileUrl: z.string(),
  author: z.string().nullable(),
  license: LicenseInfo,
  attributionText: z.string(), // always filled (generated from the licence when the provider gives none)
  retrievedAt: IsoDateTime,
  youtube: YoutubeRef.nullable(),
  declaration: UploadDeclaration.nullable(),
  transformations: z.array(z.string()), // "trim 00:01:10–00:01:25", "transcode h264 cfr 30", "exif-rotate", …
});
export type LedgerEntry = z.infer<typeof LedgerEntry>;
/** assets/ledger.json — written ONLY by the assets stage. Per-language usage lives in timeline/<lang>.usage.json. */
export const Ledger = z.object({ schemaVersion: docVersion("ledger"), entries: z.array(LedgerEntry) });
export type Ledger = z.infer<typeof Ledger>;

// ---- inferred types (one per schema constant)
export type CandidateRecord = z.infer<typeof CandidateRecord>;
