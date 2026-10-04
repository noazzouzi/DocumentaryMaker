// Public input/output types of @docmaker/director (SPEC §4.19 director stub; re-exported by index.ts unchanged).
import type {
  BeatLang, BeatPlan, ChapterId, ClipResolution, FactCheck, FactSheet, Fps, FrozenAsset, Lang, LintIssue, MusicTrack,
  Outline, OverridesDoc, PicksDoc, ProgramLayout, Project, RiskFlag, Script, SfxEntry, StyleData, StyleRenderTokens, Timeline,
  VoiceProviderId, VoiceTrack, WordTiming,
} from "@docmaker/core";

type Pauses2 = StyleData["pauses"];

export interface LayoutInput {
  lang: Lang; fps: Fps; script: Script; // chapters ALREADY filtered by onlyChapters (engine)
  plans: BeatPlan[]; texts: BeatLang[]; // texts for `lang`
  take: VoiceTrack; // active take or the scratch take
  clips: ClipResolution[]; frozen: Record<string, FrozenAsset>; pauses: Pauses2; clipFallback: "narrated" | "card";
  outline: Outline; style: Pick<StyleData, "scriptProfile" | "budgets">; storyShapeId: string;
  scriptHash: string; plansHash: string; slicesHash: string; onlyChapters: ChapterId[] | null;
}

export interface DirectorInput {
  /** `assets` (optional, I 2026-10-03): `assets.maxClipSeconds` feeds the CLIP_SHARE clip-length error. */
  project: Pick<Project, "slug" | "seed" | "captions" | "captionsVariant" | "video" | "themeOverride"> & Partial<Pick<Project, "assets">>;
  lang: Lang;
  style: StyleData;
  renderTokens: StyleRenderTokens; // tokens merged with themeOverride, captionDNA variant resolved (engine builds it)
  layout: ProgramLayout;
  layoutHash: string;
  script: Script;
  plans: BeatPlan[]; texts: BeatLang[]; // texts for `lang`
  facts: FactSheet;
  picks: PicksDoc;
  frozen: Record<string, FrozenAsset>;
  clipWords: Record<string, WordTiming[]>; // segmentId → transcript words (ms, relative to the conformed clip file)
  sfx: SfxEntry[]; // merged manifests of enabled packs
  music: MusicTrack[];
  voiceProvider: VoiceProviderId;
  takeKind: "scratch" | "final";
  pickupSegments: readonly string[]; // recording takes: segments synthesised by the pickup provider
  personAcks: readonly string[]; // personIds acknowledged via gate person-ack
  riskFlags: readonly RiskFlag[]; // from style/suggestion.json (safe-messaging end card, minors)
  factCheck: FactCheck | null; // markers for items not "rewritten"
  overrides: OverridesDoc | null;
  /** Story shape, per-chapter plan and ad breaks (§9.3). null/absent → shape from style.scriptProfile by act names, ad breaks from the style schedule. */
  outline?: Outline | null;
  /** Licence/AI/person re-check for replaceSource overrides (engine passes assets.validatePick bound to the project). */
  validateAsset: (assetId: string, beatId: string | null) => LintIssue[];
}

export interface DirectorStats {
  durationSec: number; shots: number; aslSec: number; nonCutShare: number; primaryShare: number; transitionsByKind: Record<string, number>;
  punchPerMin: number; sfxPerMin: number; impactsPerMin: number; overlaysByKind: Record<string, number>; silences: number; jlCuts: number;
  maxStaticHoldSec: number; maxNoChangeSec: number; eventsPer10s: number; captionGroups: number; keywordCaptions: number;
  salienceDrops: number; cleanStretches: number; cardShare: number; maxUpscale: number;
  /** Bare-backdrop stretches longer than DEAD_AIR_MAX_SEC left in the timeline (generated or procedural), and their total seconds. */
  deadAirStretches: number; deadAirSec: number;
}

export interface DirectorOutput {
  timeline: Timeline; lint: LintIssue[]; stats: DirectorStats;
  usage: { assetId: string; itemIds: string[] }[]; // → timeline/<lang>.usage.json (the engine writes it)
  rejectedOverrides: { id: string; reason: string }[];
}
