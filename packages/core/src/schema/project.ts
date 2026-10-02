import { z } from "zod";
import { ChapterId, Color, Fps, IsoDate, IsoDateTime, Lang, Slug, docVersion } from "./common";

export const VoiceProviderId = z.enum(["elevenlabs", "kokoro", "piper", "synthetic", "recording"]);
export type VoiceProviderId = z.infer<typeof VoiceProviderId>;

export const LexiconEntry = z.object({
  match: z.string().min(1), // whole-word match in displayText
  say: z.string().min(1), // spoken replacement written into ttsText (may be several words)
  caseSensitive: z.boolean().default(false),
});
export type LexiconEntry = z.infer<typeof LexiconEntry>;

export const VoiceSettings = z.object({
  provider: VoiceProviderId,
  voiceId: z.string().min(1), // "auto" | ElevenLabs voice id | kokoro speaker id ("16") | piper voice ("fr_FR-gilles-low") | "synthetic-m1"
  modelId: z.string().nullable().default(null), // "eleven_multilingual_v2" (default for elevenlabs) | null
  speed: z.number().min(0.7).max(1.2).default(1.0),
  stability: z.number().min(0).max(1).default(0.45),
  similarityBoost: z.number().min(0).max(1).default(0.8),
  style: z.number().min(0).max(1).default(0.15),
  charsPerSec: z.number().positive().nullable().default(null), // calibrated; null → style.scriptProfile.charsPerSec[lang]
  lexicon: z.array(LexiconEntry).default([]),
  /** Required before a CLONED ElevenLabs voice can be used (§8.3). Never a clone of a FactSheet person. */
  cloneConsent: z.object({ declaredAt: IsoDateTime, statement: z.string().min(20) }).nullable().default(null),
  /** Recording takes only: fill segments missing from the recording with this TTS provider ("PICKUP TTS" marker). */
  pickupProvider: VoiceProviderId.nullable().default(null),
});
export type VoiceSettings = z.infer<typeof VoiceSettings>;

export const AssetProviderId = z.enum([
  "openverse", "wikimedia", "internet-archive", "nasa", "loc",
  "pexels", "pixabay", "youtube", "brave", "fal", "local", "procedural",
]);
export type AssetProviderId = z.infer<typeof AssetProviderId>;

export const LicensePolicy = z.object({
  mode: z.enum(["monetized", "personal"]).default("monetized"),
  allowNonCommercial: z.boolean().default(false),
  allowNoDerivatives: z.boolean().default(false),
  allowShareAlike: z.boolean().default(true),
  allowUnknownEditorial: z.boolean().default(false), // web image search results (Brave), undeclared imports
  allowYoutubeFairUse: z.boolean().default(true), // only effective after editorial.fairUseAcknowledged
  allowAiGenerated: z.boolean().default(true), // never for beats with people (enforced by validatePick)
});
export type LicensePolicy = z.infer<typeof LicensePolicy>;

export const RenderPresetId = z.enum(["draft", "master"]);
export type RenderPresetId = z.infer<typeof RenderPresetId>;
export const GlMode = z.enum(["auto", "swangle", "angle", "angle-egl"]);
export type GlMode = z.infer<typeof GlMode>;
export const ExportFormat = z.enum([
  "fcpxml", "xmeml-premiere", "xmeml-resolve", "otio", "markers-edl", "srt", "stems", "reference-mp4",
  "publish-kit", "editorial-report",
]);
export type ExportFormat = z.infer<typeof ExportFormat>;
export const CaptionsMode = z.enum(["burn", "srt-only", "off"]);
export type CaptionsMode = z.infer<typeof CaptionsMode>;
/** keywords = selective on-screen phrases (drama default); pop = full word-by-word burn-in (Shorts idiom, opt-in). */
export const CaptionVariant = z.enum(["keywords", "pop", "karaoke", "rail"]);
export type CaptionVariant = z.infer<typeof CaptionVariant>;
export const SfxPackId = z.enum(["procedural", "remotion-sfx-cc0", "hyperframes-pixabay", "user"]);
export const LlmProviderId = z.enum(["anthropic", "fixture"]);
export const VisionRerankMode = z.enum(["off", "selective", "all"]);

/** "Theme the edit to the topic": produced by the style-suggestion call (or the user), merged into render tokens. */
export const ThemeOverride = z.object({
  accent: Color.nullable(),
  backdropRecipe: z.enum(["gradientGrid", "paper", "darkNoise", "blurSelf"]).nullable(),
  texture: z.enum(["none", "paper", "film", "scanlines", "halftone"]).nullable(),
  fontHeadline: z.string().nullable(), // must exist in the style's font set
});
export type ThemeOverride = z.infer<typeof ThemeOverride>;

export const PublishInfo = z.object({
  title: z.string().max(100),
  thumbnailText: z.string().max(40),
  description: z.string().max(5000),
});
export type PublishInfo = z.infer<typeof PublishInfo>;

export const Project = z.object({
  schemaVersion: docVersion("project"),
  formatVersion: z.literal(1),
  slug: Slug,
  title: z.string(),
  idea: z.string().min(3).max(500),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  languages: z.array(Lang).min(1).max(2),
  primaryLang: Lang,
  targetMinutes: z.number().min(1).max(60),
  styleId: z.string().nullable(), // null until suggested/chosen
  styleConfirmed: z.boolean(), // gate "style-confirm": outline is blocked until true
  themeOverride: ThemeOverride.nullable(),
  seed: z.number().int().min(0).max(0xffffffff),
  video: z.object({ fps: Fps, width: z.literal(1920), height: z.literal(1080) }),
  llm: z.object({
    provider: LlmProviderId,
    model: z.literal("claude-opus-5-5"),
    fixtureId: z.string().nullable(),
    refusalFallback: z.boolean(), // betas ["server-side-fallback-2026-07-01"] + fallbacks:"default"
    useBatchForRerank: z.boolean(), // R11
  }),
  voice: z.partialRecord(Lang, VoiceSettings),
  assets: z.object({
    providers: z.array(AssetProviderId), // enabled, in priority order
    offline: z.boolean(), // true → only local + procedural; HttpClient refuses every request
    licensePolicy: LicensePolicy,
    maxCandidatesPerBeat: z.number().int().min(4).max(60),
    useClip: z.boolean(), // M3: needs `docmaker setup --clip`
    visionRerank: VisionRerankMode, // "selective" = person/archival/news beats + close metadata ties only
    maxClipSeconds: z.number().min(3).max(60),
    clipFallback: z.enum(["narrated", "card"]), // when a YouTube clip is not found
    keepSourceDownloads: z.boolean(), // false → full-source yt-dlp downloads are deleted after conform
  }),
  audio: z.object({
    music: z.enum(["procedural", "library", "none"]),
    musicLibraryDir: z.string().nullable(),
    sfxPacks: z.array(SfxPackId),
    targetLufs: z.number(), // -14
    truePeakTarget: z.number(), // -1.5 (loudnorm TP)
    truePeakGate: z.number(), // -1.0 (measured after AAC)
  }),
  captions: CaptionsMode,
  captionsVariant: CaptionVariant.nullable(), // null → style.captionDNA.variant
  render: z.object({
    defaultPreset: RenderPresetId,
    gl: GlMode,
    concurrency: z.number().int().positive().nullable(), // null → min(os.availableParallelism(), 4)
    chunkSeconds: z.number().int().min(10).max(600),
  }),
  export: z.object({
    formats: z.array(ExportFormat),
    fcpxmlVersion: z.enum(["1.10", "1.11", "1.13"]),
    exportRoot: z.string().nullable(), // path prefix on the editing machine (path remap)
    overlays: z.boolean(), // ProRes 4444 per graphics item (M3)
  }),
  editorial: z.object({
    asOf: IsoDate,
    monetized: z.boolean(),
    fairUseAcknowledged: z.boolean(),
  }),
  publish: z.partialRecord(Lang, PublishInfo),
  budget: z.object({
    maxUsdPerStage: z.number().nonnegative(), // hard stop (25)
    maxUsdTotal: z.number().nonnegative(), // project cap (40)
    autoApproveUnderUsd: z.number().nonnegative(), // cost-gate auto-approval threshold (0 = always ask)
  }),
});
export type Project = z.infer<typeof Project>;

/** Fields that cannot change once any stage has produced output (PATCH rejects them with VALIDATION). */
export const LOCKED_AFTER_START = ["languages", "primaryLang", "video", "seed", "slug"] as const;

export const NewProjectInput = z.object({
  idea: z.string().min(3).max(500),
  slug: Slug.optional(),
  languages: z.array(Lang).min(1).max(2).default(["en"]),
  primaryLang: Lang.optional(), // default languages[0]
  targetMinutes: z.number().min(1).max(60).default(20),
  styleId: z.string().nullable().default(null), // a value here also sets styleConfirmed=true
  llm: LlmProviderId.default("anthropic"),
  fixtureId: z.string().nullable().default(null),
  seed: z.number().int().min(0).max(0xffffffff).optional(), // default fnv1a32(slug)
});
export type NewProjectInput = z.input<typeof NewProjectInput>;

/** Options a job may carry. Every key a stage reads MUST be part of that stage's inputs hash (§5.3). */
export const JobOptions = z.object({
  onlyChapters: z.array(ChapterId).nullable().optional(), // demo / chapter-range work; hashed by layout, direct, mix, render
  frameRange: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).nullable().optional(),
  newRequest: z.boolean().optional(), // bypass paid receipts (one call)
  forceOverwriteEdits: z.boolean().optional(), // allow regenerating user-edited/locked chapters
  replanChapters: z.array(ChapterId).optional(), // beats: LLM re-plan of these chapters
  chapters: z.array(ChapterId).optional(), // script: (re)write only these chapters
  segments: z.array(z.string()).optional(), // voice: re-synthesise only these segments
  retryBad: z.boolean().optional(),
  allowPaid: z.boolean().optional(), // live asset search may use paid providers (after an inline confirm)
  timelineOnly: z.boolean().optional(), // export without reference mp4
  overlays: z.boolean().optional(),
  takeKind: z.enum(["scratch", "final"]).optional(),
  pickupTts: z.boolean().optional(),
});
export type JobOptions = z.infer<typeof JobOptions>;

// ---- environment / secrets (never persisted, never logged)
export const ENV_KEYS = {
  anthropic: "ANTHROPIC_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  pexels: "PEXELS_API_KEY",
  pixabay: "PIXABAY_API_KEY",
  fal: "FAL_KEY",
  brave: "BRAVE_API_KEY",
  openverseClientId: "OPENVERSE_CLIENT_ID",
  openverseClientSecret: "OPENVERSE_CLIENT_SECRET",
  youtubeDataApi: "YOUTUBE_API_KEY",
  remotionLicense: "REMOTION_LICENSE_KEY",
} as const;
export type SecretName = keyof typeof ENV_KEYS;
export type Secrets = Readonly<Partial<Record<SecretName, string>>>;

export const ENV_SETTINGS = {
  home: "DOCMAKER_HOME", // default ~/.documentarymaker
  projects: "DOCMAKER_PROJECTS", // default <repoRoot>/projects
  repoRoot: "DOCMAKER_REPO_ROOT", // default: nearest ancestor of cwd containing pnpm-workspace.yaml
  contact: "DOCMAKER_CONTACT", // Wikimedia UA contact (URL or email); set by the user, never auto-filled
  logLevel: "DOCMAKER_LOG_LEVEL",
  ffmpeg: "DOCMAKER_FFMPEG", // default "ffmpeg"
  ffprobe: "DOCMAKER_FFPROBE",
  offline: "DOCMAKER_OFFLINE", // "1" forces offline everywhere
  autoApproveUsd: "DOCMAKER_AUTO_APPROVE_USD",
  cacheMaxGb: "DOCMAKER_CACHE_MAX_GB",
  ytPotUrl: "DOCMAKER_YT_POT_URL",
  ytCookiesBrowser: "DOCMAKER_YT_COOKIES_BROWSER",
  renderLock: "DOCMAKER_RENDER_LOCK", // default /tmp/docmaker-render.lock (machine-wide)
  browserExecutable: "DOCMAKER_BROWSER_EXECUTABLE", // overrides <home>/browser.json (shared Chrome Headless Shell)
  liveTests: "DOCMAKER_LIVE_TESTS", // "1" enables network/paid tests (never in CI)
} as const;

// ---- inferred types (one per schema constant)
export type SfxPackId = z.infer<typeof SfxPackId>;
export type LlmProviderId = z.infer<typeof LlmProviderId>;
export type VisionRerankMode = z.infer<typeof VisionRerankMode>;
