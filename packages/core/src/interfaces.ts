// packages/core/src/interfaces.ts — cross-package TS interfaces (not persisted). Browser-safe (types only).
import type { Lang, LintIssue } from "./schema/common";
import type { AssetProviderId, Secrets, VoiceProviderId, VoiceSettings } from "./schema/project";
import type { AssetKind, AssetQuery, Candidate, CandidateScore } from "./schema/assets";
import type { LicenseInfo } from "./schema/license";
import type { TimingSource, WordTiming } from "./schema/voice";
import type {
  CostEstimate, GeneratedStillsRequest, GlProbe, JobEventInput, OverlayRenderRequest, Receipt, RenderRequest,
  RenderResult, StageId, StillsRequest,
} from "./schema/ops";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  child(bindings: Record<string, unknown>): Logger;
}

export interface HomePaths {
  home: string; // DOCMAKER_HOME (~/.documentarymaker)
  cache: string; // <home>/cache
  blobs: string; // <home>/cache/blobs
  httpCache: string; // <home>/cache/http
  models: string; // <home>/models/{kokoro,piper,whisper}
  ml: string; // <home>/ml (CLIP runtime installed by `setup --clip`, loaded with createRequire; M3)
  sfx: string; // <home>/sfx/<pack>/<version>/
  music: string; // <home>/music/procedural/
  styles: string; // <home>/styles/<id>/ (user style directories, auto-discovered)
  bundles: string; // <home>/bundles/<codeHash>/
  bin: string; // <home>/bin (yt-dlp standalone if no venv)
  pyVenv: string; // <home>/py/.venv
  locks: string; // <home>/locks
  logs: string; // <home>/logs
  envFile: string; // <home>/.env (secrets, 0600)
  configFile: string; // <home>/config.json (HomeConfig)
  browserFile: string; // <home>/browser.json (BrowserDoc)
  glProbe: string; // <home>/gl-probe.json
}

export interface RuntimeConfig {
  repoRoot: string; // absolute; repo files (fixtures, workers, DTDs, builtin styles) are ALWAYS located from here
  paths: HomePaths;
  projectsDir: string;
  contact: string | null; // DOCMAKER_CONTACT ?? HomeConfig.contact — sent ONLY to CONTACT_UA_HOSTS
  userAgentBase: string; // `DocumentaryMaker/<version>` (+ ` (+<homepage>)` when package.json has one)
  ffmpeg: string;
  ffprobe: string;
  offline: boolean; // true → HttpClient throws OFFLINE before opening any socket
  logLevel: "debug" | "info" | "warn" | "error";
  autoApproveUsd: number;
  browserExecutable: string | null; // from <home>/browser.json
  renderLockFile: string; // machine-wide render lock (DOCMAKER_RENDER_LOCK ?? /tmp/docmaker-render.lock)
}
/** Hosts that receive `contact: …` in the User-Agent. Everything else gets userAgentBase only. */
export const CONTACT_UA_HOSTS: readonly string[] = ["commons.wikimedia.org", "upload.wikimedia.org", "www.wikidata.org", "wikidata.org", "api.openverse.org"];

export type Progress = (pct: number, message: string, detail?: Record<string, unknown>) => void;

// ---------------------------------------------------------------- media probing / paths
export interface FfprobeStream {
  index: number; codecType: "video" | "audio" | "subtitle" | "data"; codecName: string;
  width: number | null; height: number | null; pixFmt: string | null; fps: number | null; // r_frame_rate as a number
  sampleRate: number | null; channels: number | null; durationSec: number | null; nbFrames: number | null;
}
export interface FfprobeResult { formatName: string; durationSec: number; bitRate: number | null; streams: FfprobeStream[] }

// ---------------------------------------------------------------- HTTP (assets, research verification)
export interface HttpGetOptions {
  headers?: Record<string, string>;
  timeoutMs?: number; // header timeout default 10 000
  cacheTtlSec?: number; // provider response cache (Pixabay 86 400)
  maxBytes?: number; // default 256 MiB (images/audio), video 2 GiB
  signal: AbortSignal;
}
export interface HttpClient {
  getJson<T>(url: string, opts: HttpGetOptions): Promise<T>;
  getText(url: string, opts: HttpGetOptions): Promise<string>;
  postForm<T>(url: string, form: Record<string, string>, opts: HttpGetOptions): Promise<T>;
  postJson<T>(url: string, body: unknown, opts: HttpGetOptions): Promise<T>;
  download(url: string, destPath: string, opts: HttpGetOptions): Promise<{ bytes: number; mime: string; finalUrl: string }>;
}

// ---------------------------------------------------------------- assets
export interface ProviderLimits { perMin?: number; perHour?: number; perDay?: number; concurrency: number }
export interface ProviderContext { secrets: Secrets; config: RuntimeConfig; logger: Logger; http: HttpClient; signal: AbortSignal }
export interface AssetProvider {
  readonly id: AssetProviderId;
  readonly kinds: readonly AssetKind[];
  readonly needsKey: boolean;
  readonly paid: boolean; // true → cost gate; excluded from live search unless allowPaid
  readonly costPerCallUsd: number;
  readonly limits: ProviderLimits;
  isConfigured(secrets: Secrets, config: RuntimeConfig): boolean;
  search(q: AssetQuery, ctx: ProviderContext): Promise<{ candidate: Candidate; raw: unknown }[]>;
  /** Fetch ORIGINAL bytes to destDir (yt-dlp, http, generator…). Conform + freeze happen in the registry. */
  fetchOriginal(c: Candidate, destDir: string, ctx: ProviderContext): Promise<{ path: string; mime: string }>;
}
export interface RerankInput {
  beatId: string;
  visualQuery: string;
  narration: string; // beat text (primary lang)
  visualKind: string;
  identityHint: string; // provenance-only identity (e.g. "Commons P180=Q37175"); vision never identifies people
}
export interface Reranker {
  rerank(
    input: RerankInput,
    candidates: Candidate[],
    thumbPaths: string[], // local JPEG thumbnails ≤ 768 px, same order
    signal: AbortSignal,
  ): Promise<{
    scores: Pick<CandidateScore, "vision" | "technical" | "watermark" | "nsfw" | "focal" | "safeCrop" | "notes">[];
    receipt: Receipt | null;
  }>;
}

// ---------------------------------------------------------------- voice
export interface VoiceInfo {
  id: string; name: string; lang: Lang; gender: "male" | "female" | "unknown"; provider: VoiceProviderId;
  license: LicenseInfo; // Piper CC-BY → attribution; ElevenLabs → PROVIDER-TERMS (+ free-tier attribution/nc)
  cloned: boolean; // ElevenLabs cloned/professional voices → VoiceSettings.cloneConsent required
}
export interface TtsCapabilities {
  languages: Lang[];
  nativeWordTimestamps: boolean;
  stitching: boolean;
  maxCharsPerRequest: number;
  voiceCloning: boolean;
  normalizesNumbers: boolean; // false → buildTtsText expands numbers
  costPer1kCharsUsd: number;
  tier: string | null; // ElevenLabs subscription tier ("free" → non-commercial + attribution warning)
}
export interface TtsRequest {
  segmentId: string;
  text: string; // ttsText
  ttsWords: string[]; // tokens of ttsText (alignment targets)
  lang: Lang;
  voice: VoiceSettings;
  previousText?: string;
  nextText?: string;
  previousRequestIds?: string[]; // ElevenLabs, ≤3 (slice(-3)), < 2 h old
  seed?: number;
}
export interface TtsResult {
  segmentId: string;
  audioPath: string; // raw provider output (any rate/format); the post chain converts to 48 kHz mono
  durationMs: number;
  words: WordTiming[] | null; // one per ttsWord, relative to audio start; null → run an Aligner
  timingSource: TimingSource;
  providerRequestId: string | null;
  charsBilled: number;
}
export interface TtsProvider {
  readonly id: VoiceProviderId;
  isAvailable(): Promise<{ ok: boolean; hint: string | null }>;
  capabilities(): Promise<TtsCapabilities>;
  listVoices(lang?: Lang): Promise<VoiceInfo[]>;
  synthesize(req: TtsRequest, outPath: string, signal: AbortSignal): Promise<TtsResult>;
}
export interface Aligner {
  readonly id: "estimated" | "faster-whisper" | "whisper-cpp" | "elevenlabs-forced";
  isAvailable(): Promise<{ ok: boolean; hint: string | null }>;
  /** Free transcription (recordings, YouTube fallback). */
  transcribe(audioPath: string, lang: Lang, namesPrompt: string, signal: AbortSignal): Promise<WordTiming[]>;
  /** Script-guided: returns exactly ttsWords.length timings (NW + interpolation). */
  align(audioPath: string, ttsWords: string[], lang: Lang, signal: AbortSignal): Promise<WordTiming[]>;
}

// ---------------------------------------------------------------- render (the engine never imports @docmaker/render; DI)
export interface RenderHandlers { onEvent(e: JobEventInput): void; signal: AbortSignal }
export interface RenderClient {
  render(req: RenderRequest, h: RenderHandlers): Promise<RenderResult>;
  renderStills(req: StillsRequest, h: RenderHandlers): Promise<string[]>;
  renderOverlays(req: OverlayRenderRequest, h: RenderHandlers): Promise<{ itemId: string; file: string }[]>; // M3
  renderGeneratedStills(req: GeneratedStillsRequest, h: RenderHandlers): Promise<{ clipId: string; file: string }[]>; // PNG for NLE export
  probeGl(force?: boolean): Promise<GlProbe>;
  close(): Promise<void>;
}

// ---------------------------------------------------------------- costs
export interface CostTracker {
  /** Persist an estimate; returns it with planHash. */
  estimate(e: Omit<CostEstimate, "schemaVersion" | "id" | "createdAt" | "planHash">, inputsHash: string): Promise<CostEstimate>;
  /** Idempotence for paid calls: same fingerprint → reuse stored output, never pay twice. */
  findReceipt(fingerprint: string): Promise<Receipt | null>;
  record(r: Omit<Receipt, "createdAt" | "jobId">): Promise<Receipt>;
  spentUsd(stage: StageId, lang: Lang | null): number; // in the current job
  spentTotalUsd(): number; // whole project (receipts.ndjson)
  /** Throws BUDGET_EXCEEDED when spend > max(1.5 × approved estimate, estimate + $1), > maxUsdPerStage, or > maxUsdTotal. */
  assertWithinBudget(stage: StageId, lang: Lang | null): void;
}

// ---------------------------------------------------------------- linters
export type Linter<T> = (value: T) => LintIssue[];
