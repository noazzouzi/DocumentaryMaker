import { z } from "zod";

/**
 * Per-document format versions. Each persisted document kind has its own version.
 * To change a persisted shape: bump ONE entry here and register a migration (util/migrate.ts).
 */
export const DOC_VERSIONS = {
  project: 1, dossier: 1, registry: 1, factsheet: 1, verification: 1, styleSuggestion: 1, outline: 1,
  script: 1, factcheck: 1, beatPlans: 1, beatSlices: 1, userPicks: 1, picks: 1, frozen: 1, candidates: 1,
  clipWords: 1, entities: 1, localIndex: 1, ledger: 1, music: 1, sfxManifest: 1, voiceTrack: 1, activeTake: 1,
  layout: 1, timeline: 1, overrides: 1, usage: 1, timelineLint: 1, loudness: 1, render: 1, qa: 1, state: 1,
  approvals: 1, jobsIndex: 1, estimate: 1, fixture: 1, cacheIndex: 1, homeConfig: 1, glProbe: 1, browser: 1,
} as const;
export type DocKind = keyof typeof DOC_VERSIONS;
export const docVersion = <K extends DocKind>(k: K) => z.literal(DOC_VERSIONS[k]);

export const Lang = z.enum(["en", "fr"]);
export type Lang = z.infer<typeof Lang>;
export const LANGS = Lang.options;

export const Slug = z.string().min(1).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const Sha16 = z.string().regex(/^[a-f0-9]{16}$/); // first 16 hex chars of a sha256 (plan keys)
export const IsoDate = z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/); // YYYY | YYYY-MM | YYYY-MM-DD
export const IsoDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T/); // Date#toISOString()
export const Frame = z.number().int().nonnegative();
export const PosFrames = z.number().int().positive();
export const FrameDelta = z.number().int();
export const Ms = z.number().int().nonnegative();
export const Unit = z.number().min(0).max(1);
export const Color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/);
export const Fps = z.union([z.literal(24), z.literal(25), z.literal(30)]);
export type Fps = z.infer<typeof Fps>;
export const Range2 = z.tuple([z.number(), z.number()]); // [min, max]
export type Range2 = z.infer<typeof Range2>;

// ---- id grammars. Ids are assigned IN CODE (never trusted from the LLM; the wire mappers normalise them).
export const ChapterId = z.string().regex(/^CH\d{1,2}$/); // CH1 is the cold open
export type ChapterId = z.infer<typeof ChapterId>;
export const SegmentId = z.string().regex(/^CH\d{1,2}-S\d{2,3}$/); // CH3-S07
export type SegmentId = z.infer<typeof SegmentId>;
/** CH3-B014 (planned beat) | CH3-S07-CLIP (synthetic clip beat) | CH3-S09-BR (synthetic music_breath montage beat) */
export const BeatId = z.string().regex(/^CH\d{1,2}-(B\d{3}|S\d{2,3}-(CLIP|BR))$/);
export type BeatId = z.infer<typeof BeatId>;
export const WordId = z.string().regex(/^CH\d{1,2}-S\d{2,3}:\d{1,4}$/); // `${segmentId}:${wordIndex}` (per language)
export type WordId = z.infer<typeof WordId>;
export const ClipWordId = z.string().regex(/^clip:CH\d{1,2}-S\d{2,3}:\d{1,4}$/); // clip transcript word
export const TranslationWordId = z.string().regex(/^tr:CH\d{1,2}-S\d{2,3}:\d{1,3}:\d{1,3}$/); // tr:<segmentId>:<page>:<n>
export const AnyWordId = z.union([WordId, ClipWordId, TranslationWordId]);
export const AssetId = Sha256; // sha256 of the CONFORMED file
export const TakeId = z.string().regex(/^(take|scratch)-[a-f0-9]{12}$/); // deterministic (§8.9)
export type TakeId = z.infer<typeof TakeId>;
export const ActId = z.string().regex(/^[a-z0-9_]+$/); // validated against the style's story-shape acts
export const SourceId = z.string().regex(/^S\d{1,4}$/);
export const PersonId = z.string().regex(/^P\d{1,4}$/);
export const EventId = z.string().regex(/^E\d{1,4}$/);
export const FigureId = z.string().regex(/^N\d{1,4}$/);
export const ClaimId = z.string().regex(/^C\d{1,4}$/);
export const QuoteId = z.string().regex(/^Q\d{1,4}$/);
export const FactRef = z.string().regex(/^[SPENCQ]\d{1,4}$/); // Source Person Event figure(N) Claim Quote
export const FactCheckId = z.string().regex(/^FC-[a-f0-9]{8}$/); // FC-<sha8(where|norm(sentence)|claimKind|origin)>

export const NormPoint = z.object({ x: Unit, y: Unit });
export type NormPoint = z.infer<typeof NormPoint>;
export const NormRect = z.object({ x: Unit, y: Unit, w: Unit, h: Unit });
export type NormRect = z.infer<typeof NormRect>;
export const PxRect = z.object({
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().positive(),
  h: z.number().int().positive(),
});
export type PxRect = z.infer<typeof PxRect>;

/** Deterministic lint/validation issue, shared by every linter (script, beats, timeline, styles, integrity). */
export const LintIssue = z.object({
  level: z.enum(["error", "warn"]),
  rule: z.string(), // stable code, e.g. "accusatory-unattributed", "V_CONTIGUOUS", "NO_VISUAL_CHANGE"
  where: z.string(), // segment/chapter/beat/item id or "global"
  msg: z.string(),
});
export type LintIssue = z.infer<typeof LintIssue>;

// ---- inferred types (one per schema constant)
export type Slug = z.infer<typeof Slug>;
export type Sha256 = z.infer<typeof Sha256>;
export type Sha16 = z.infer<typeof Sha16>;
export type IsoDate = z.infer<typeof IsoDate>;
export type IsoDateTime = z.infer<typeof IsoDateTime>;
export type Frame = z.infer<typeof Frame>;
export type PosFrames = z.infer<typeof PosFrames>;
export type FrameDelta = z.infer<typeof FrameDelta>;
export type Ms = z.infer<typeof Ms>;
export type Unit = z.infer<typeof Unit>;
export type Color = z.infer<typeof Color>;
export type ClipWordId = z.infer<typeof ClipWordId>;
export type TranslationWordId = z.infer<typeof TranslationWordId>;
export type AnyWordId = z.infer<typeof AnyWordId>;
export type AssetId = z.infer<typeof AssetId>;
export type ActId = z.infer<typeof ActId>;
export type SourceId = z.infer<typeof SourceId>;
export type PersonId = z.infer<typeof PersonId>;
export type EventId = z.infer<typeof EventId>;
export type FigureId = z.infer<typeof FigureId>;
export type ClaimId = z.infer<typeof ClaimId>;
export type QuoteId = z.infer<typeof QuoteId>;
export type FactRef = z.infer<typeof FactRef>;
export type FactCheckId = z.infer<typeof FactCheckId>;
