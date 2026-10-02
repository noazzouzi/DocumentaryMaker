// @docmaker/director — public API (packages/director/src/index.ts). PURE: no I/O, no Date, no Math.random.
// P0 API stub (SPEC §4.19): every function throws DocmakerError("INTERNAL", "not implemented: …") until its owner lands it.
import { notImplemented } from "./notImplemented";
import type {
  AnchorIndex, BeatLang, BeatPlan, CaptionDNA, ChapterId, ClipResolution, Fps, FactCheck, FactSheet, FrozenAsset, Lang, LayoutWord,
  LintIssue, MusicTrack, Outline, OverridesDoc, PicksDoc, ProgramLayout, Project, RiskFlag, Script, SfxEntry, StyleData,
  StyleRenderTokens, Timeline, VoiceProviderId, VoiceTrack, WordTiming,
} from "@docmaker/core";

export const DIRECTOR_VERSION: string = "2.0.0"; // "2.0.0"; part of the direct inputs hash

export interface LayoutInput {
  lang: Lang; fps: Fps; script: Script; // chapters ALREADY filtered by onlyChapters (engine)
  plans: BeatPlan[]; texts: BeatLang[]; // texts for `lang`
  take: VoiceTrack; // active take or the scratch take
  clips: ClipResolution[]; frozen: Record<string, FrozenAsset>; pauses: Pauses2; clipFallback: "narrated" | "card";
  outline: Outline; style: Pick<StyleData, "scriptProfile" | "budgets">; storyShapeId: string;
  scriptHash: string; plansHash: string; slicesHash: string; onlyChapters: ChapterId[] | null;
}
type Pauses2 = StyleData["pauses"];
/** The audio clock (§9.2). The engine then runs audio.assembleVoProgram and fills voProgram. */
export function layoutProgram(i: LayoutInput): Omit<ProgramLayout, "voProgram"> {
  throw notImplemented("director.layoutProgram");
}

export interface DirectorInput {
  project: Pick<Project, "slug" | "seed" | "captions" | "captionsVariant" | "video" | "themeOverride">;
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
  /** Licence/AI/person re-check for replaceSource overrides (engine passes assets.validatePick bound to the project). */
  validateAsset: (assetId: string, beatId: string | null) => LintIssue[];
}
export interface DirectorStats {
  durationSec: number; shots: number; aslSec: number; nonCutShare: number; primaryShare: number; transitionsByKind: Record<string, number>;
  punchPerMin: number; sfxPerMin: number; impactsPerMin: number; overlaysByKind: Record<string, number>; silences: number; jlCuts: number;
  maxStaticHoldSec: number; maxNoChangeSec: number; eventsPer10s: number; captionGroups: number; keywordCaptions: number;
  salienceDrops: number; cleanStretches: number; cardShare: number; maxUpscale: number;
}
export interface DirectorOutput {
  timeline: Timeline; lint: LintIssue[]; stats: DirectorStats;
  usage: { assetId: string; itemIds: string[] }[]; // → timeline/<lang>.usage.json (the engine writes it)
  rejectedOverrides: { id: string; reason: string }[];
}
export function direct(i: DirectorInput): DirectorOutput {
  throw notImplemented("director.direct");
}
export function groupCaptions(words: readonly LayoutWord[], g: CaptionDNA["grouping"], fps: number): { words: LayoutWord[]; from: number; dur: number }[] {
  throw notImplemented("director.groupCaptions");
}
export function lintTimeline(t: Timeline, style: StyleData, ctx: { layout: ProgramLayout; layoutHash: string; frozen: Record<string, FrozenAsset> }): LintIssue[] {
  throw notImplemented("director.lintTimeline");
}
export function applyOverrides(t: Timeline, o: OverridesDoc, ix: AnchorIndex, ctx: { style: StyleData; validateAsset: DirectorInput["validateAsset"]; plans: BeatPlan[] }): { timeline: Timeline; rejected: { id: string; reason: string }[] } {
  throw notImplemented("director.applyOverrides");
}
/** Lint severities (§4.13 table): exported so the web app can render rule help. */
export const LINT_RULES: Readonly<Record<string, { level: "error" | "warn"; help: string }>> = {};
