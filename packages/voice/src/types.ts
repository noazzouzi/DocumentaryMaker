// Public input types of @docmaker/voice (re-exported by index.ts; §4.19 fields kept verbatim, extras are optional).
import type { Aligner, CostTracker, Lang, Logger, Progress, RuntimeConfig, Script, Secrets, TtsProvider, VoiceProviderId, VoiceSettings, VoiceTrack } from "@docmaker/core";

export interface VoiceCtx { config: RuntimeConfig; secrets: Secrets; logger: Logger; signal: AbortSignal; progress: Progress; costs: CostTracker }

export interface SynthesizeTrackInput {
  lang: Lang; script: Script; voice: VoiceSettings; kind: "scratch" | "final";
  clipNarrated: string[]; // clip segment ids narrated as fallback (spokenText(seg, "clip-narrated"))
  segments: string[] | null; // null = all; else re-synthesise only these (others reused from `previous`)
  previous: VoiceTrack | null; projectDir: string; styleCps: number; retryBad: boolean;
  /** Optional (additive): FactSheet person names + aliases — a cloned voice named after one of them is refused. */
  personNames?: string[];
  /** Optional (additive, tests/DI): provider instance used instead of createTtsProvider(voice.provider). */
  provider?: TtsProvider;
  /** Optional (additive): ASR aligner for QA/alignment; undefined = auto-detect, null = none. */
  asr?: Aligner | null;
}

export interface ImportRecordingInput {
  lang: Lang; script: Script; files: string[]; mode: "global" | "per-segment"; // per-segment: files named <segmentId>.* (or uploaded per segment)
  aligner: "faster-whisper" | "whisper-cpp" | "auto"; previous: VoiceTrack | null; projectDir: string;
  pickup: { provider: VoiceProviderId; voice: VoiceSettings } | null; // fill missing segments ("PICKUP TTS")
  /** Optional (additive): clip segment ids narrated by the user (clip-narrated mode). */
  clipNarrated?: string[];
  /** Optional (additive, tests/DI): ASR aligner instance used instead of the installed one. */
  asr?: Aligner;
  /** Optional (additive, tests/DI): pickup provider instance. */
  pickupProvider?: TtsProvider;
  /** Optional (additive): names to bias the ASR (FactSheet people, places). */
  namesPrompt?: string;
}
