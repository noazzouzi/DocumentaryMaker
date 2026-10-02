// packages/core/src/util/paths.ts — project path table (§5.2) + document registry. Pure (no node:*). Normative.
import type { z } from "zod";
import type { DocKind, Lang } from "../schema/common";
import type { StageId } from "../schema/ops";
import { Project } from "../schema/project";
import { FactSheet, RegistryDoc, ResearchDossier, StyleSuggestion, Verification } from "../schema/research";
import { Outline } from "../schema/outline";
import { FactCheck, Script } from "../schema/script";
import { BeatPlansDoc, BeatSlicesDoc } from "../schema/beats";
import {
  CandidatesDoc, ClipWordsDoc, EntitiesDoc, FrozenDoc, Ledger, LocalIndexDoc, PicksDoc, UserPicksDoc,
} from "../schema/assets";
import { MusicDoc } from "../schema/media";
import { ActiveTake, VoiceTrack } from "../schema/voice";
import { ProgramLayout } from "../schema/layout";
import { OverridesDoc, Timeline, UsageDoc } from "../schema/timeline";
import {
  ApprovalsDoc, CostEstimate, JobsIndex, LoudnessDoc, ProjectState, QaReport, RenderDoc, TimelineLintDoc,
} from "../schema/ops";

export const P = {
  project: "project.json",
  state: "state.json",
  approvals: "approvals.json",
  lock: ".lock", // job lock (one running job per project)
  jobsIndex: "jobs/index.json",
  jobEvents: (jobId: string) => `jobs/${jobId}.ndjson`,
  receipts: "costs/receipts.ndjson",
  estimate: (stage: StageId, lang: Lang | null) => `costs/estimates/${stage}${lang ? "." + lang : ""}.json`,
  llmRaw: (fingerprint: string) => `costs/llm/${fingerprint}.json`,
  dossier: "research/dossier.json",
  dossierMd: "research/dossier.md",
  registry: "research/registry.json",
  factsheet: "research/factsheet.json",
  verification: "research/verification.json",
  researchTurn: (n: number) => `research/raw/turn-${n}.json`,
  styleSuggestion: "style/suggestion.json",
  outline: "outline/outline.json",
  script: (lang: Lang) => `script/${lang}/script.json`, // the ONLY script source of truth
  chapterCache: (lang: Lang, chapterId: string) => `script/${lang}/.cache/${chapterId}.json`, // LLM output cache, never an input
  factcheck: (lang: Lang) => `script/${lang}/factcheck.json`,
  teleprompter: (lang: Lang) => `voice/${lang}/teleprompter.html`,
  beatPlans: "beats/plans.json",
  beatSlices: (lang: Lang) => `beats/${lang}.json`,
  candidates: (beatId: string) => `assets/candidates/${beatId}.json`,
  userPicks: "assets/user-picks.json", // user input; never written by a stage
  picks: "assets/picks.json",
  frozen: "assets/frozen.json",
  ledger: "assets/ledger.json",
  music: "assets/music.json",
  entities: "research/entities.json", // personId → QID + aliases (resolved by the research stage)
  localIndex: "assets/local-index.json",
  clipWords: (segmentId: string) => `assets/clips/${segmentId}.json`,
  credits: (lang: Lang) => `assets/credits.${lang}.md`,
  media: (assetId: string, ext: string) => `media/${assetId}.${ext}`,
  uploads: "uploads/", // staging for web uploads (declaration required before import)
  activeTake: (lang: Lang) => `voice/${lang}/active.json`,
  take: (lang: Lang, takeId: string) => `voice/${lang}/${takeId}/take.json`,
  takeSegment: (lang: Lang, takeId: string, segmentId: string) => `voice/${lang}/${takeId}/seg/${segmentId}.wav`,
  segmentCache: (lang: Lang, cacheKey: string) => `voice/${lang}/.segcache/${cacheKey}.wav`,
  recordings: (lang: Lang) => `voice/${lang}/recordings/`,
  layout: (lang: Lang) => `layout/${lang}.json`,
  voProgram: (lang: Lang) => `program/${lang}/vo_program.wav`,
  timeline: (lang: Lang) => `timeline/${lang}.json`,
  overrides: (lang: Lang) => `timeline/${lang}.overrides.json`,
  timelineLint: (lang: Lang) => `timeline/${lang}.lint.json`,
  usage: (lang: Lang) => `timeline/${lang}.usage.json`,
  mix: (lang: Lang) => `audio/${lang}/mix.wav`,
  stem: (lang: Lang, stem: "vo" | "music" | "sfx" | "clip") => `audio/${lang}/stems/${stem}.wav`,
  loudness: (lang: Lang) => `audio/${lang}/loudness.json`,
  renderDir: (lang: Lang, preset: string) => `render/${lang}/${preset}/`,
  renderSnapshot: (lang: Lang, preset: string) => `render/${lang}/${preset}/snapshot/`,
  renderChunk: (lang: Lang, preset: string, hash: string) => `render/${lang}/${preset}/chunks/${hash}.ts`,
  renderFinal: (lang: Lang, preset: string) => `render/${lang}/${preset}/final.mp4`,
  renderDoc: (lang: Lang, preset: string) => `render/${lang}/${preset}/render.json`,
  exportDir: (lang: Lang) => `export/${lang}/`,
  qaReport: (lang: Lang, preset: string) => `qa/${lang}/${preset}/report.json`,
  qaSheets: (lang: Lang, preset: string) => `qa/${lang}/${preset}/sheets/`,
  history: (rel: string) => `.history/${rel}/`, // last 20 versions of user-editable docs
} as const;
export type ProjectPaths = typeof P;

export type DocOwner = StageId | "user" | "engine";
export interface DocRegistryEntry {
  pattern: RegExp;
  kind: DocKind;
  schema: z.ZodType;
  owner: DocOwner; // the ONLY writer (besides migrations). "user" docs are written via writeDoc only.
  userEditable: boolean; // PUT allowed through engine.writeDoc (keeps .history)
  compact: boolean; // stableStringify indent 0 (large generated docs)
}
/** writeJson/readDoc consult this table: validation, migration, ownership, history, compaction. */
export const DOC_REGISTRY: readonly DocRegistryEntry[] = [
  { pattern: /^project\.json$/, kind: "project", schema: Project, owner: "engine", userEditable: true, compact: false },
  { pattern: /^state\.json$/, kind: "state", schema: ProjectState, owner: "engine", userEditable: false, compact: false },
  { pattern: /^approvals\.json$/, kind: "approvals", schema: ApprovalsDoc, owner: "engine", userEditable: false, compact: false },
  { pattern: /^jobs\/index\.json$/, kind: "jobsIndex", schema: JobsIndex, owner: "engine", userEditable: false, compact: false },
  { pattern: /^costs\/estimates\/[a-z]+(\.(en|fr))?\.json$/, kind: "estimate", schema: CostEstimate, owner: "engine", userEditable: false, compact: false },
  { pattern: /^research\/dossier\.json$/, kind: "dossier", schema: ResearchDossier, owner: "research", userEditable: false, compact: false },
  { pattern: /^research\/registry\.json$/, kind: "registry", schema: RegistryDoc, owner: "research", userEditable: false, compact: false },
  { pattern: /^research\/factsheet\.json$/, kind: "factsheet", schema: FactSheet, owner: "research", userEditable: true, compact: false },
  { pattern: /^research\/verification\.json$/, kind: "verification", schema: Verification, owner: "research", userEditable: false, compact: false },
  { pattern: /^style\/suggestion\.json$/, kind: "styleSuggestion", schema: StyleSuggestion, owner: "style", userEditable: false, compact: false },
  { pattern: /^outline\/outline\.json$/, kind: "outline", schema: Outline, owner: "outline", userEditable: true, compact: false },
  { pattern: /^script\/(en|fr)\/script\.json$/, kind: "script", schema: Script, owner: "script", userEditable: true, compact: false },
  { pattern: /^script\/(en|fr)\/factcheck\.json$/, kind: "factcheck", schema: FactCheck, owner: "factcheck", userEditable: true, compact: false },
  { pattern: /^beats\/plans\.json$/, kind: "beatPlans", schema: BeatPlansDoc, owner: "beats", userEditable: true, compact: false },
  { pattern: /^beats\/(en|fr)\.json$/, kind: "beatSlices", schema: BeatSlicesDoc, owner: "beatslice", userEditable: true, compact: false },
  { pattern: /^assets\/candidates\/[A-Z0-9-]+\.json$/, kind: "candidates", schema: CandidatesDoc, owner: "assets", userEditable: false, compact: true },
  { pattern: /^assets\/user-picks\.json$/, kind: "userPicks", schema: UserPicksDoc, owner: "user", userEditable: true, compact: false },
  { pattern: /^assets\/picks\.json$/, kind: "picks", schema: PicksDoc, owner: "assets", userEditable: false, compact: false },
  { pattern: /^assets\/frozen\.json$/, kind: "frozen", schema: FrozenDoc, owner: "assets", userEditable: false, compact: true },
  { pattern: /^assets\/ledger\.json$/, kind: "ledger", schema: Ledger, owner: "assets", userEditable: false, compact: false },
  { pattern: /^assets\/music\.json$/, kind: "music", schema: MusicDoc, owner: "assets", userEditable: false, compact: false },
  { pattern: /^research\/entities\.json$/, kind: "entities", schema: EntitiesDoc, owner: "research", userEditable: true, compact: false },
  { pattern: /^assets\/local-index\.json$/, kind: "localIndex", schema: LocalIndexDoc, owner: "user", userEditable: false, compact: false },
  { pattern: /^assets\/clips\/[A-Z0-9-]+\.json$/, kind: "clipWords", schema: ClipWordsDoc, owner: "assets", userEditable: false, compact: true },
  { pattern: /^voice\/(en|fr)\/active\.json$/, kind: "activeTake", schema: ActiveTake, owner: "voice", userEditable: true, compact: false },
  { pattern: /^voice\/(en|fr)\/(take|scratch)-[a-f0-9]{12}\/take\.json$/, kind: "voiceTrack", schema: VoiceTrack, owner: "voice", userEditable: false, compact: true },
  { pattern: /^layout\/(en|fr)\.json$/, kind: "layout", schema: ProgramLayout, owner: "layout", userEditable: false, compact: true },
  { pattern: /^timeline\/(en|fr)\.json$/, kind: "timeline", schema: Timeline, owner: "direct", userEditable: false, compact: true },
  { pattern: /^timeline\/(en|fr)\.overrides\.json$/, kind: "overrides", schema: OverridesDoc, owner: "user", userEditable: true, compact: false },
  { pattern: /^timeline\/(en|fr)\.lint\.json$/, kind: "timelineLint", schema: TimelineLintDoc, owner: "direct", userEditable: false, compact: false },
  { pattern: /^timeline\/(en|fr)\.usage\.json$/, kind: "usage", schema: UsageDoc, owner: "direct", userEditable: false, compact: false },
  { pattern: /^audio\/(en|fr)\/loudness\.json$/, kind: "loudness", schema: LoudnessDoc, owner: "mix", userEditable: false, compact: false },
  { pattern: /^render\/(en|fr)\/(draft|master)\/render\.json$/, kind: "render", schema: RenderDoc, owner: "render", userEditable: false, compact: false },
  { pattern: /^qa\/(en|fr)\/(draft|master)\/report\.json$/, kind: "qa", schema: QaReport, owner: "qa", userEditable: false, compact: false },
];
/** First DOC_REGISTRY entry whose pattern matches the project-relative path (forward slashes), else null. */
export function docEntryFor(rel: string): DocRegistryEntry | null {
  const norm = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  for (const e of DOC_REGISTRY) if (e.pattern.test(norm)) return e;
  return null;
}
