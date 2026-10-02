// @docmaker/voice — public API (packages/voice/src/index.ts). Writes WAVs only under the projectDir it is given.
// P0 API stub (SPEC §4.19): every function throws DocmakerError("INTERNAL", "not implemented: …") until its owner lands it.
import { notImplemented } from "./notImplemented";
import type {
  Aligner, CostLine, CostTracker, Lang, LexiconEntry, LicenseInfo, Logger, Progress, RuntimeConfig, Script, Secrets,
  TtsProvider, VoiceProviderId, VoiceSettings, VoiceTrack, WordTiming,
} from "@docmaker/core";

export interface VoiceCtx { config: RuntimeConfig; secrets: Secrets; logger: Logger; signal: AbortSignal; progress: Progress; costs: CostTracker }

// ---- text (§8.2) — ONLY the engine calls buildTtsText (script stage fills ttsText unless ttsTextEdited)
export interface TtsTextResult { ttsText: string; ttsWords: string[]; displayToTts: [number, number][] }
export function buildTtsText(spoken: string, lang: Lang, opts: { lexicon: LexiconEntry[]; expandNumbers: boolean; stripTags: boolean }): TtsTextResult {
  throw notImplemented("voice.buildTtsText");
}
export function numberToWords(n: number, lang: Lang, kind: "cardinal" | "year" | "ordinal" | "decimal"): string {
  throw notImplemented("voice.numberToWords");
}

// ---- providers & aligners
export function createTtsProvider(id: VoiceProviderId, cfg: { config: RuntimeConfig; secrets: Secrets; logger: Logger }): TtsProvider {
  throw notImplemented("voice.createTtsProvider");
}
export function createAligner(id: Aligner["id"], cfg: { config: RuntimeConfig; secrets: Secrets; logger: Logger }): Aligner {
  throw notImplemented("voice.createAligner");
}
export function charAlignmentToWords(text: string, chars: string[], startsSec: number[], endsSec: number[]): WordTiming[] {
  throw notImplemented("voice.charAlignmentToWords");
}
/** Needleman–Wunsch (match +2, mismatch −1, gap −1, normWord) + interpolation; returns exactly scriptWords.length timings. */
export function alignScriptToTranscript(scriptWords: string[], asr: readonly WordTiming[]): (WordTiming & { matched: boolean })[] {
  throw notImplemented("voice.alignScriptToTranscript");
}

// ---- takes
export interface SynthesizeTrackInput {
  lang: Lang; script: Script; voice: VoiceSettings; kind: "scratch" | "final";
  clipNarrated: string[]; // clip segment ids narrated as fallback (spokenText(seg, "clip-narrated"))
  segments: string[] | null; // null = all; else re-synthesise only these (others reused from `previous`)
  previous: VoiceTrack | null; projectDir: string; styleCps: number; retryBad: boolean;
}
/** Segment cache (§8.4), stitching order (sequential per chapter), post chain, aligner fallback, deterministic takeId. */
export function synthesizeTrack(i: SynthesizeTrackInput, ctx: VoiceCtx): Promise<VoiceTrack> {
  throw notImplemented("voice.synthesizeTrack");
}
export function estimateTtsCost(i: { script: Script; voice: VoiceSettings; segments: string[] | null; previous: VoiceTrack | null }): CostLine[] {
  throw notImplemented("voice.estimateTtsCost");
}
export interface ImportRecordingInput {
  lang: Lang; script: Script; files: string[]; mode: "global" | "per-segment"; // per-segment: files named <segmentId>.* (or uploaded per segment)
  aligner: "faster-whisper" | "whisper-cpp" | "auto"; previous: VoiceTrack | null; projectDir: string;
  pickup: { provider: VoiceProviderId; voice: VoiceSettings } | null; // fill missing segments ("PICKUP TTS")
}
export function importRecording(i: ImportRecordingInput, ctx: VoiceCtx): Promise<VoiceTrack> {
  throw notImplemented("voice.importRecording");
}
export function voPostChain(input: string, output: string, o: { kind: "tts" | "recording"; rawFormat: { sampleRate: number; pcm: boolean } | null }, ctx: VoiceCtx): Promise<{ leadTrimMs: number; durationMs: number }> {
  throw notImplemented("voice.voPostChain");
}
export function calibrateVoice(i: { lang: Lang; voice: VoiceSettings; projectDir: string }, ctx: VoiceCtx): Promise<{ charsPerSec: number }> {
  throw notImplemented("voice.calibrateVoice");
}
export function teleprompterHtml(script: Script, o: { cps: number; mirror: boolean; lang: Lang }): string {
  throw notImplemented("voice.teleprompterHtml");
}
export function voiceLicense(provider: VoiceProviderId, voiceId: string, tier: string | null): LicenseInfo {
  throw notImplemented("voice.voiceLicense");
}
export function voiceSettingsHash(v: VoiceSettings): string {
  throw notImplemented("voice.voiceSettingsHash");
}
export function takeIdFor(kind: "scratch" | "final", provider: VoiceProviderId, voiceId: string, settingsHash: string, segmentCacheKeys: string[]): string {
  throw notImplemented("voice.takeIdFor");
}
/** True when the active take's segment ttsTextHash ≠ hashJson(current ttsText) (computed, never stored). */
export function editedAfterTake(script: Script, take: VoiceTrack): string[] {
  throw notImplemented("voice.editedAfterTake");
}

// ---- models (setup)
export const MODEL_MANIFEST: readonly { id: string; url: string; approxBytes: number; sha256: string | null; extractTo: string }[] = [];
export function ensureModel(id: string, ctx: VoiceCtx): Promise<string> {
  throw notImplemented("voice.ensureModel");
} // Range resume + size verification
