// packages/core/src/schema/ops.ts — `// ----` lines are section markers inside ONE file
import { z } from "zod";
import { ChapterId, IsoDateTime, Lang, LintIssue, Sha256, Slug, docVersion } from "./common";
import { JobOptions, RenderPresetId } from "./project";

export const StageId = z.enum([
  "research", "style", "outline", "script", "beats", "beatslice", "factcheck", "assets", "voice",
  "layout", "direct", "mix", "render", "export", "qa",
]);
export type StageId = z.infer<typeof StageId>;
export const PER_LANG_STAGES: readonly StageId[] = [
  "script", "beatslice", "factcheck", "voice", "layout", "direct", "mix", "render", "export", "qa",
];
/** Stages whose state is additionally keyed by a variant (the render preset). */
export const VARIANT_STAGES: readonly StageId[] = ["render", "qa"];
export const GateId = z.enum([
  "style-confirm", "outline-approval", "factcheck-ack", "person-ack", "recheck", "cost", "fair-use",
]);
export type GateId = z.infer<typeof GateId>;
/** Editorial gates are NEVER satisfied by --yes / --max-cost / auto-threshold (only fixtures auto-approve them). */
export const EDITORIAL_GATES: readonly GateId[] = ["outline-approval", "factcheck-ack", "person-ack", "recheck", "fair-use"];
export const JobStatus = z.enum(["queued", "running", "waiting-approval", "succeeded", "failed", "canceled"]);
export type JobStatus = z.infer<typeof JobStatus>;
export const ErrorCode = z.enum([
  "CONFIG_MISSING_KEY", "FIXTURE_MISSING", "LLM_REFUSAL", "LLM_SCHEMA", "LLM_API", "GATE_REQUIRED",
  "BUDGET_EXCEEDED", "PROVIDER_RATE_LIMIT", "PROVIDER_ERROR", "OFFLINE", "YT_BOT_CHECK", "YT_FORBIDDEN", "YT_UNAVAILABLE",
  "YT_RATE_LIMIT", "TOOL_MISSING", "MODEL_MISSING", "ANCHOR_MISSING", "VALIDATION", "LANG_PARITY", "POLICY_DENIED",
  "TIMELINE_LINT", "RENDER_FAILED", "MIX_FAILED", "LOUDNESS_GATE", "EXPORT_FAILED", "CANCELED", "LOCKED", "CONFLICT",
  "UPSTREAM_MISSING", "MIGRATION_FAILED", "INTERRUPTED", "INTERNAL",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const JobRequest = z.object({
  slug: Slug,
  kind: z.enum(["stage", "pipeline", "demo", "setup"]),
  stage: StageId.nullable(),
  from: StageId.nullable(),
  to: StageId.nullable(),
  langs: z.array(Lang), // [] = project languages
  force: z.boolean(),
  options: JobOptions,
  preset: RenderPresetId.nullable(),
});
export type JobRequest = z.infer<typeof JobRequest>;

export const JobRecord = z.object({
  id: z.string(), // "job-<yyyymmdd-hhmmss>-<rand6>"
  request: JobRequest,
  status: JobStatus,
  createdAt: IsoDateTime,
  startedAt: IsoDateTime.nullable(),
  endedAt: IsoDateTime.nullable(),
  error: z.object({ code: ErrorCode, message: z.string() }).nullable(),
  coalescedInto: z.string().nullable(), // identical queued request merged into this job id
  resumeOf: z.string().nullable(), // "approve & continue" / run --resume
});
export type JobRecord = z.infer<typeof JobRecord>;
/** projects/<slug>/jobs/index.json — persisted queue + history (last 200). */
export const JobsIndex = z.object({ schemaVersion: docVersion("jobsIndex"), jobs: z.array(JobRecord) });
export type JobsIndex = z.infer<typeof JobsIndex>;

// ---- cost
export const CostUnit = z.enum([
  "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "web_searches",
  "characters", "seconds", "images", "megapixels", "requests",
]);
export const CostLine = z.object({
  label: z.string(), provider: z.string(), unit: CostUnit, quantity: z.number().nonnegative(),
  unitPriceUsd: z.number().nonnegative(), totalUsd: z.number().nonnegative(),
});
export const CostEstimate = z.object({
  schemaVersion: docVersion("estimate"),
  id: z.string(),
  stage: StageId,
  lang: Lang.nullable(),
  lines: z.array(CostLine),
  totalUsd: z.number().nonnegative(),
  confidence: z.enum(["exact", "estimate", "rough"]),
  planHash: Sha256, // hash of (stage inputs + lines) → approval binds to it
  createdAt: IsoDateTime,
});
export type CostEstimate = z.infer<typeof CostEstimate>;
/** One approval may cover a whole pipeline run: Approval.planHash = PipelineEstimate.planHash, items = stage planHashes. */
export const PipelineEstimate = z.object({
  stages: z.array(CostEstimate),
  totalUsd: z.number().nonnegative(),
  planHash: Sha256, // hashJson(sorted stage planHashes)
});
export type PipelineEstimate = z.infer<typeof PipelineEstimate>;
export const Receipt = z.object({
  fingerprint: Sha256, // sha256(provider|endpoint|canonicalJson(request minus secrets)) — same paid call never made twice
  provider: z.string(),
  endpoint: z.string(),
  model: z.string().nullable(),
  stage: StageId,
  lang: Lang.nullable(),
  createdAt: IsoDateTime,
  usage: z.record(z.string(), z.number()),
  costUsd: z.number().nonnegative(),
  outputRef: z.string().nullable(), // project-relative path of the stored response/output
  jobId: z.string().nullable(),
});
export type Receipt = z.infer<typeof Receipt>;
export const Approval = z.object({
  gate: GateId,
  stage: StageId,
  lang: Lang.nullable(),
  planHash: Sha256,
  approvedAt: IsoDateTime,
  by: z.enum(["web", "cli", "flag", "fixture", "auto-threshold"]),
  note: z.string(),
  items: z.array(z.string()), // acknowledged FactCheckItem ids | personIds | stage planHashes
  itemNotes: z.record(z.string(), z.string()), // per-item notes (factcheck-ack, person-ack)
});
export type Approval = z.infer<typeof Approval>;
export const ApprovalsDoc = z.object({ schemaVersion: docVersion("approvals"), approvals: z.array(Approval) });
export type ApprovalsDoc = z.infer<typeof ApprovalsDoc>;

/** USD; volatile — single source for estimates. Update with care. */
export const PRICES = {
  claude: { "claude-opus-5-5": { inputPerMTok: 4.0, outputPerMTok: 20.0, cacheReadPerMTok: 0.2, cacheWrite5mPerMTok: 5.0 } },
  webSearchPer1k: 10.0, // web_fetch costs tokens only
  elevenlabsPer1kChars: { eleven_multilingual_v2: 0.08, eleven_v3: 0.08, eleven_v4: 0.08, eleven_flash_v2_5: 0.04 },
  bravePer1k: 5.0,
  fal: { "fal-ai/flux/schnell": { perMegapixel: 0.003 }, "fal-ai/flux-2-pro": { firstMp: 0.03, extraMp: 0.015 } },
} as const;

const ev = { jobId: z.string(), seq: z.number().int().nonnegative(), at: IsoDateTime };
export const JobEvent = z.discriminatedUnion("type", [
  z.object({ ...ev, type: z.literal("job-start"), request: JobRequest }),
  z.object({ ...ev, type: z.literal("stage-start"), stage: StageId, lang: Lang.nullable() }),
  z.object({ ...ev, type: z.literal("progress"), stage: StageId, lang: Lang.nullable(), pct: z.number().min(0).max(1), message: z.string(), detail: z.record(z.string(), z.unknown()) }),
  z.object({ ...ev, type: z.literal("log"), level: z.enum(["debug", "info", "warn", "error"]), message: z.string(), stage: StageId.nullable() }),
  z.object({ ...ev, type: z.literal("estimate"), estimate: CostEstimate }),
  z.object({ ...ev, type: z.literal("cost"), receipt: Receipt }),
  z.object({ ...ev, type: z.literal("needs-approval"), gate: GateId, stage: StageId, lang: Lang.nullable(), planHash: Sha256, reason: z.enum(["unmet", "stale"]), summary: z.string() }),
  z.object({ ...ev, type: z.literal("artifact"), stage: StageId, lang: Lang.nullable(), path: z.string(), kind: z.string() }),
  z.object({ ...ev, type: z.literal("stage-skip"), stage: StageId, lang: Lang.nullable(), reason: z.enum(["up-to-date", "not-applicable"]) }),
  z.object({ ...ev, type: z.literal("stage-done"), stage: StageId, lang: Lang.nullable(), durationMs: z.number().int(), outputsHash: Sha256 }),
  z.object({ ...ev, type: z.literal("error"), stage: StageId.nullable(), code: ErrorCode, message: z.string(), retryable: z.boolean(), hint: z.string().nullable() }),
  z.object({ ...ev, type: z.literal("job-end"), status: JobStatus }),
]);
export type JobEvent = z.infer<typeof JobEvent>;
export type JobEventInput = JobEvent extends infer E ? (E extends unknown ? Omit<E, "jobId" | "seq" | "at"> : never) : never;

export const StageState = z.object({
  stage: StageId,
  lang: Lang.nullable(),
  variant: z.string().nullable(), // render/qa: the preset ("draft" | "master"); else null
  status: z.enum(["idle", "running", "done", "failed", "blocked"]), // "stale" is COMPUTED (inputsHash mismatch), never stored
  stageVersion: z.number().int(),
  inputsHash: Sha256.nullable(),
  outputsHash: Sha256.nullable(),
  startedAt: IsoDateTime.nullable(),
  finishedAt: IsoDateTime.nullable(),
  error: z.string().nullable(),
  costUsd: z.number().nonnegative(),
  artifacts: z.array(z.string()),
});
export type StageState = z.infer<typeof StageState>;
export const ProjectState = z.object({ schemaVersion: docVersion("state"), stages: z.array(StageState) });
export type ProjectState = z.infer<typeof ProjectState>;

// ---- qa
export const QaCheck = z.object({
  id: z.string(), level: z.enum(["error", "warn", "info"]), ok: z.boolean(), message: z.string(),
  value: z.number().nullable(), threshold: z.number().nullable(), frame: z.number().int().nullable(),
});
export const QaReport = z.object({
  schemaVersion: docVersion("qa"),
  lang: Lang,
  preset: RenderPresetId,
  createdAt: IsoDateTime,
  checks: z.array(QaCheck),
  probe: z.object({
    durationSec: z.number(), frames: z.number().int(), width: z.number().int(), height: z.number().int(), fps: z.number(),
    vcodec: z.string(), pixFmt: z.string(), acodec: z.string(), sampleRate: z.number().int(), channels: z.number().int(),
  }).nullable(),
  loudness: z.object({ integratedLufs: z.number(), truePeakDbtp: z.number(), lra: z.number() }).nullable(),
  contactSheets: z.array(z.string()),
  audioNotListenedNotice: z.literal("The mix was checked by meters only; nobody listened to it."),
});
export type QaReport = z.infer<typeof QaReport>;

// ---- render
export const RenderRequest = z.object({
  slug: Slug,
  lang: Lang,
  preset: RenderPresetId,
  projectDir: z.string(), // absolute
  timelineRel: z.string(), // snapshot copy: render/<lang>/<preset>/snapshot/timeline.json (project lock released after snapshot)
  mixRel: z.string().nullable(), // snapshot copy of the mix (null → silent track)
  outRel: z.string(), // render/<lang>/<preset>/final.mp4
  frameRange: z.tuple([z.number().int(), z.number().int()]).nullable(),
  chunkSeconds: z.number().int(),
  gl: z.enum(["auto", "swangle", "angle", "angle-egl"]),
  concurrency: z.number().int().positive().nullable(),
  grain: z.number().min(0).max(16),
  lutCube: z.string().nullable(), // absolute .cube path → ffmpeg lut3d in master post
});
export type RenderRequest = z.infer<typeof RenderRequest>;
export const RenderChunk = z.object({
  index: z.number().int(), from: z.number().int(), to: z.number().int(), // inclusive
  file: z.string(), hash: Sha256, cached: z.boolean(), ms: z.number(),
});
export const RenderResult = z.object({
  outFile: z.string(), durationInFrames: z.number().int(), frames: z.number().int(),
  chunks: z.array(RenderChunk), renderMs: z.number(), gl: z.string(), codeHash: Sha256,
  loudness: z.object({ integratedLufs: z.number(), truePeakDbtp: z.number(), gateAttempts: z.number().int() }).nullable(),
});
export type RenderResult = z.infer<typeof RenderResult>;
/** render/<lang>/<preset>/render.json */
export const RenderDoc = RenderResult.extend({
  schemaVersion: docVersion("render"), lang: Lang, preset: RenderPresetId, timelineHash: Sha256, mixHash: Sha256.nullable(),
  onlyChapters: z.array(ChapterId).nullable(), createdAt: IsoDateTime,
});
export type RenderDoc = z.infer<typeof RenderDoc>;
export const GlProbe = z.object({
  schemaVersion: docVersion("glProbe"),
  chosen: z.enum(["swangle", "angle", "angle-egl"]),
  results: z.array(z.object({ gl: z.string(), ok: z.boolean(), ms: z.number(), renderer: z.string() })),
  gpu: z.boolean(),
  probedAt: IsoDateTime,
});
export type GlProbe = z.infer<typeof GlProbe>;
export const StillsRequest = z.object({
  projectDir: z.string(), timelineRel: z.string(), frames: z.array(z.number().int()), outDir: z.string(),
  scale: z.number().positive(), sheet: z.object({ cols: z.number().int(), width: z.number().int(), label: z.boolean() }).nullable(),
});
export type StillsRequest = z.infer<typeof StillsRequest>;
export const OverlayRenderRequest = z.object({
  projectDir: z.string(), timelineRel: z.string(), itemIds: z.array(z.string()), outDir: z.string(), // ProRes 4444 per item (M3)
});
export type OverlayRenderRequest = z.infer<typeof OverlayRenderRequest>;
export const GeneratedStillsRequest = z.object({
  projectDir: z.string(), timelineRel: z.string(), clipIds: z.array(z.string()), outDir: z.string(),
});
export type GeneratedStillsRequest = z.infer<typeof GeneratedStillsRequest>;

// ---- misc persisted docs
/** timeline/<lang>.lint.json */
export const TimelineLintDoc = z.object({
  schemaVersion: docVersion("timelineLint"),
  lang: Lang,
  issues: z.array(LintIssue),
  stats: z.record(z.string(), z.unknown()), // DirectorStats
  rejectedOverrides: z.array(z.object({ id: z.string(), reason: z.string() })),
});
export type TimelineLintDoc = z.infer<typeof TimelineLintDoc>;
/** audio/<lang>/loudness.json */
export const LoudnessDoc = z.object({
  schemaVersion: docVersion("loudness"),
  lang: Lang,
  integratedLufs: z.number(), truePeakDbtp: z.number(), lra: z.number(),
  gainDb: z.number(), limiterMaxGrDb: z.number(), // stems sum to the master except for limiter gain reduction
  stems: z.array(z.enum(["vo", "music", "sfx", "clip"])),
});
export type LoudnessDoc = z.infer<typeof LoudnessDoc>;
/** fixtures/<id>/fixture.json */
export const FixtureManifest = z.object({
  schemaVersion: docVersion("fixture"),
  id: z.string(), title: z.string(), idea: z.string(), languages: z.array(Lang).min(1), primaryLang: Lang,
  targetMinutes: z.number(), styleId: z.string(), asOf: z.string(), seed: z.number().int(),
  autoApproveGates: z.boolean(), // tulip-mania: true (demo); gate-test: false (safety suite exercises every gate)
});
export type FixtureManifest = z.infer<typeof FixtureManifest>;
/** <home>/cache/index.json */
export const CacheIndex = z.object({
  schemaVersion: docVersion("cacheIndex"),
  blobs: z.array(z.object({ sha256: Sha256, ext: z.string(), bytes: z.number().int(), lastUsed: IsoDateTime })),
});
export type CacheIndex = z.infer<typeof CacheIndex>;
/** <home>/config.json — non-secret preferences (secrets live ONLY in <home>/.env, mode 0600). */
export const HomeConfig = z.object({
  schemaVersion: docVersion("homeConfig"),
  remotionLicense: z.object({ status: z.enum(["individual-or-small-org", "company-license"]), acknowledgedAt: IsoDateTime }).nullable(),
  contact: z.string().nullable(), // Wikimedia/Wikidata contact (overridden by DOCMAKER_CONTACT)
  uiLang: z.enum(["auto", "en", "fr"]),
  defaults: z.object({ languages: z.array(Lang), targetMinutes: z.number(), styleId: z.string().nullable() }),
  onboardingDone: z.boolean(),
});
export type HomeConfig = z.infer<typeof HomeConfig>;
/** <home>/browser.json — written by `setup --browser`; passed as browserExecutable to every Remotion call. */
export const BrowserDoc = z.object({ schemaVersion: docVersion("browser"), executable: z.string(), version: z.string(), installedAt: IsoDateTime });
export type BrowserDoc = z.infer<typeof BrowserDoc>;

// ---- inferred types (one per schema constant)
export type CostUnit = z.infer<typeof CostUnit>;
export type CostLine = z.infer<typeof CostLine>;
export type QaCheck = z.infer<typeof QaCheck>;
export type RenderChunk = z.infer<typeof RenderChunk>;
