// Public types of @docmaker/engine (§4.19 engine stub, verbatim; additive fields are marked).
import type { z } from "zod";
import type {
  Approval, AssetProviderId, AssetQuery, CandidateRecord, CostEstimate, CostTracker, FrozenAsset, GateId, HomeConfig, JobEvent,
  JobEventInput, JobRecord, JobRequest, Lang, LintIssue, Logger, NewProjectInput, PipelineEstimate, Progress, Project,
  RenderClient, RenderPresetId, RuntimeConfig, Secrets, StageId, StageState, StylePlugin, StyleSuggestion, UploadDeclaration,
} from "@docmaker/core";
import type { ProjectStore } from "@docmaker/core/node";
import type { LlmClient } from "@docmaker/llm";
import type { StyleSummary } from "@docmaker/styles";
import type { EngineDeps } from "./deps";

export type JobRunnerMode =
  | { kind: "in-process" } // CLI, tests
  | { kind: "worker"; workerPath: string }; // web: jobs run in a forked worker (<repoRoot>/apps/cli/src/worker.ts)
export interface EngineOptions {
  cwd?: string; // repoRoot is found from here (or DOCMAKER_REPO_ROOT)
  env?: NodeJS.ProcessEnv;
  renderClient: RenderClient | null; // null in "worker" mode (the worker owns rendering)
  runner?: JobRunnerMode; // default in-process
  llmOverride?: LlmClient; // tests
  logger?: Logger;
  /** Additive (tests, walking skeleton §16.5): package adapters replacing the real workspace packages. */
  deps?: EngineDeps;
  /** Additive: skip crash reconciliation at start (the forked worker host reconciles in the worker instead). */
  skipReconcile?: boolean;
}
export interface StageStatus extends StageState { stale: boolean; blockedBy: GateId | null; blockedReason: "unmet" | "stale" | null }
export interface DemoOptions {
  fixture: string; // "tulip-mania"
  langs: Lang[]; // default ["en"]
  offline: boolean; // default true → providers: local + procedural only; HttpClient refuses all requests
  tts: "auto" | "synthetic" | "kokoro" | "piper"; // auto → kokoro/piper if a model is present, else synthetic
  preset: RenderPresetId; // default "draft"
  onlyChapters: string[] | null; // e.g. ["CH1","CH2"] → JobOptions.onlyChapters (hashed)
  slug?: string;
}
export interface ImpactReport { staleStages: { stage: StageId; lang: Lang | null }[]; estimatedRerunUsd: number; lostUserEdits: string[] }

export interface Engine {
  readonly config: RuntimeConfig;
  // projects
  createProject(input: NewProjectInput): Promise<Project>;
  listProjects(): Promise<{ slug: string; title: string; updatedAt: string; languages: Lang[]; activeJobId: string | null }[]>;
  getProject(slug: string): Promise<Project>;
  /** Validated; LOCKED_AFTER_START fields rejected once any stage produced output. */
  updateProject(slug: string, patch: Partial<Project>): Promise<Project>;
  impact(slug: string, patch: Partial<Project> | { doc: string }): Promise<ImpactReport>; // shown before style/minutes/language/outline edits
  status(slug: string): Promise<{ stages: StageStatus[]; costUsd: number; activeJobId: string | null; queued: string[] }>;
  // costs & gates
  estimate(slug: string, stage: StageId, lang: Lang | null): Promise<CostEstimate | null>;
  estimatePipeline(slug: string, o: { from: StageId; to: StageId; langs: Lang[] }): Promise<PipelineEstimate>;
  /** Per-gate validation (§5.4): factcheck-ack needs items ⊇ open high items, each with a note ≥ 10 chars; editorial gates refuse by:"flag"/"auto-threshold". */
  approve(slug: string, gate: GateId, a: Omit<Approval, "gate" | "approvedAt">): Promise<void>;
  // jobs (persisted in jobs/index.json; crash-reconciled at start; identical queued requests coalesce)
  submit(req: JobRequest): Promise<{ jobId: string; coalesced: boolean }>;
  resume(jobId: string): Promise<{ jobId: string }>; // "approve & continue" / `docmaker run --resume`
  cancel(jobId: string): Promise<void>; // aborts SDK streams, kills process groups, deletes partial chunk .tmp files
  listJobs(slug: string): Promise<JobRecord[]>;
  getJob(jobId: string): Promise<JobRecord | null>;
  events(jobId: string, afterSeq?: number): AsyncIterable<JobEvent>; // replays jobs/<id>.ndjson then live
  // documents (user edits). PUT of a script runs lintScript + deterministic fact-checks and returns the issues.
  readDoc<S extends z.ZodType>(slug: string, rel: string, schema: S): Promise<{ value: z.infer<S>; etag: string | null }>;
  writeDoc<S extends z.ZodType>(slug: string, rel: string, schema: S, value: z.input<S>, etag: string | null): Promise<{ etag: string; issues: LintIssue[] }>;
  history(slug: string, rel: string): Promise<{ file: string; at: string; etag: string }[]>;
  revert(slug: string, rel: string, historyFile: string): Promise<{ etag: string }>;
  // styles
  listStyles(): Promise<StyleSummary[]>;
  suggestStyleForIdea(idea: string, o: { useLlm: boolean }): Promise<StyleSuggestion>; // offline always; LLM only when asked + key
  getStyle(id: string): Promise<StylePlugin>;
  // assets (interactive; short, run in the calling process)
  liveSearch(slug: string, i: { beatId: string; query: Partial<AssetQuery> & { text: string }; providers: AssetProviderId[]; allowPaid: boolean }): Promise<CandidateRecord[]>;
  freeze(slug: string, i: { beatId: string; slot: number; provider: AssetProviderId; providerAssetId: string }): Promise<{ asset: FrozenAsset; issues: LintIssue[] }>;
  upload(slug: string, i: { tmpPath: string; kind: "asset" | "recording"; lang: Lang | null; declaration: UploadDeclaration | null; segmentId: string | null }): Promise<{ rel: string; asset: FrozenAsset | null }>;
  resolveClip(slug: string, i: { segmentId: string; url: string | null; uploadRel: string | null; startMs: number; endMs: number; channel: string; title: string }): Promise<{ issues: LintIssue[] }>;
  // environment
  doctor(): Promise<DoctorReport>;
  homeConfig(): Promise<HomeConfig>;
  setHomeConfig(patch: Partial<Omit<HomeConfig, "schemaVersion">>): Promise<HomeConfig>;
  setSecret(name: string, value: string): Promise<void>; // writes <home>/.env (0600) after explicit consent
  testKey(name: string): Promise<{ ok: boolean; tier: string | null; message: string }>;
  runDemo(opts: DemoOptions): Promise<{ slug: string; jobId: string; mp4: string; exportDir: string }>;
  close(): Promise<void>;
}
export interface DoctorCheck { id: string; ok: boolean; level: "error" | "warn" | "info"; value: string; hint: string | null }
export interface DoctorReport { checks: DoctorCheck[]; blocking: boolean }

export interface StageCtx {
  project: Project; lang: Lang | null; variant: string | null; store: ProjectStore; config: RuntimeConfig; secrets: Secrets; logger: Logger;
  signal: AbortSignal; emit(e: JobEventInput): void; progress: Progress; costs: CostTracker; llm: LlmClient;
  style: StylePlugin; render: RenderClient; options: JobRequest["options"]; jobId: string;
  /** Additive (§5.6): the render stage releases the project job lock after its snapshot (other jobs may then proceed). */
  releaseProjectLock?: () => Promise<void>;
}
export interface StageDef {
  id: StageId;
  perLang: boolean;
  version: number;
  optionKeys: readonly (keyof JobRequest["options"])[]; // options that affect output → hashed into inputs
  inputs(ctx: StageCtx): Promise<unknown>; // hashed with docHash rules (§5.3)
  estimate?(ctx: StageCtx): Promise<Omit<CostEstimate, "schemaVersion" | "id" | "createdAt" | "planHash"> | null>;
  gatesBefore?(ctx: StageCtx): Promise<{ gate: GateId; reason: "unmet" | "stale"; planHash: string; summary: string }[]>;
  outputs(ctx: StageCtx): string[]; // project-relative artifacts (existence checked for "done")
  run(ctx: StageCtx): Promise<{ artifacts: string[] }>;
}
export type { JobEvent, PipelineEstimate };
