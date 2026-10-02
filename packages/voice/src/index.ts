// @docmaker/voice — public API (packages/voice/src/index.ts). Writes WAVs only under the projectDir it is given.
// §4.19 signatures are kept verbatim; additional exports are additive.
import type {
  Aligner, CostLine, Lang, LexiconEntry, LicenseInfo, Logger, RuntimeConfig, Script, Secrets, TtsProvider, VoiceProviderId,
  VoiceSettings, VoiceTrack, WordTiming,
} from "@docmaker/core";
import { alignScriptToTranscript as nwAlign, charAlignmentToWords as charsToWords } from "./align/nw";
import { editedAfterTake as editedImpl } from "./edited";
import { takeIdFor as takeIdImpl, voiceSettingsHash as settingsHashImpl } from "./hash";
import { voiceLicense as licenseImpl } from "./license";
import { runPostChain } from "./post/chain";
import { createAligner as alignerImpl, createTtsProvider as providerImpl } from "./providers/registry";
import { numberToWords as numberImpl } from "./text/numbers";
import { buildTtsText as buildImpl } from "./text/tts-text";
import { estimateTtsCost as estimateImpl, synthesizeTrack as synthImpl } from "./track";
import { importRecording as importImpl } from "./recording";
import { calibrateVoice as calibrateImpl } from "./calibrate";
import { teleprompterHtml as teleprompterImpl } from "./teleprompter";
import { MODEL_MANIFEST as MANIFEST, ensureModel as ensureImpl } from "./models";
import type { ImportRecordingInput, SynthesizeTrackInput, VoiceCtx } from "./types";

export type { ImportRecordingInput, SynthesizeTrackInput, VoiceCtx } from "./types";

// ---- text (§8.2) — ONLY the engine calls buildTtsText (script stage fills ttsText unless ttsTextEdited)
export interface TtsTextResult { ttsText: string; ttsWords: string[]; displayToTts: [number, number][] }
export function buildTtsText(spoken: string, lang: Lang, opts: { lexicon: LexiconEntry[]; expandNumbers: boolean; stripTags: boolean }): TtsTextResult {
  return buildImpl(spoken, lang, opts);
}
export function numberToWords(n: number, lang: Lang, kind: "cardinal" | "year" | "ordinal" | "decimal"): string {
  return numberImpl(n, lang, kind);
}

// ---- providers & aligners
export function createTtsProvider(id: VoiceProviderId, cfg: { config: RuntimeConfig; secrets: Secrets; logger: Logger }): TtsProvider {
  return providerImpl(id, cfg);
}
export function createAligner(id: Aligner["id"], cfg: { config: RuntimeConfig; secrets: Secrets; logger: Logger }): Aligner {
  return alignerImpl(id, cfg);
}
export function charAlignmentToWords(text: string, chars: string[], startsSec: number[], endsSec: number[]): WordTiming[] {
  return charsToWords(text, chars, startsSec, endsSec);
}
/** Needleman–Wunsch (match +2, mismatch −1, gap −1, normWord) + interpolation; returns exactly scriptWords.length timings. */
export function alignScriptToTranscript(scriptWords: string[], asr: readonly WordTiming[]): (WordTiming & { matched: boolean })[] {
  return nwAlign(scriptWords, asr);
}

// ---- takes
/** Segment cache (§8.4), stitching order (sequential per chapter), post chain, aligner fallback, deterministic takeId. */
export function synthesizeTrack(i: SynthesizeTrackInput, ctx: VoiceCtx): Promise<VoiceTrack> {
  return synthImpl(i, ctx);
}
export function estimateTtsCost(i: { script: Script; voice: VoiceSettings; segments: string[] | null; previous: VoiceTrack | null }): CostLine[] {
  return estimateImpl(i);
}
export function importRecording(i: ImportRecordingInput, ctx: VoiceCtx): Promise<VoiceTrack> {
  return importImpl(i, ctx);
}
export function voPostChain(input: string, output: string, o: { kind: "tts" | "recording"; rawFormat: { sampleRate: number; pcm: boolean } | null }, ctx: VoiceCtx): Promise<{ leadTrimMs: number; durationMs: number }> {
  return runPostChain(input, output, o, ctx);
}
export function calibrateVoice(i: { lang: Lang; voice: VoiceSettings; projectDir: string }, ctx: VoiceCtx): Promise<{ charsPerSec: number }> {
  return calibrateImpl(i, ctx);
}
export function teleprompterHtml(script: Script, o: { cps: number; mirror: boolean; lang: Lang; outdated?: string[] }): string {
  return teleprompterImpl(script, o);
}
export function voiceLicense(provider: VoiceProviderId, voiceId: string, tier: string | null): LicenseInfo {
  return licenseImpl(provider, voiceId, tier);
}
export function voiceSettingsHash(v: VoiceSettings): string {
  return settingsHashImpl(v);
}
export function takeIdFor(kind: "scratch" | "final", provider: VoiceProviderId, voiceId: string, settingsHash: string, segmentCacheKeys: string[]): string {
  return takeIdImpl(kind, provider, voiceId, settingsHash, segmentCacheKeys);
}
/** True when the active take's segment ttsTextHash ≠ hashJson(current ttsText) (computed, never stored). */
export function editedAfterTake(script: Script, take: VoiceTrack): string[] {
  return editedImpl(script, take);
}

// ---- models (setup)
export const MODEL_MANIFEST: readonly { id: string; url: string; approxBytes: number; sha256: string | null; extractTo: string }[] = MANIFEST;
export function ensureModel(id: string, ctx: VoiceCtx): Promise<string> {
  return ensureImpl(id, ctx);
} // Range resume + size verification

// ---- additive exports (helpers for the engine, web and CLI)
export { POST_CHAIN_VERSION, POST_FILTERS, decodeTo48kMono } from "./post/chain";
export { segmentCacheKey } from "./hash";
export { SyntheticProvider, SYNTHETIC_VOICES, SYNTHETIC_LICENSE, DEFAULT_CPS, planSyntheticWords } from "./providers/synthetic";
export { ElevenLabsProvider, ELEVEN_DEFAULT_MODEL, ELEVEN_MODELS, assertVoiceAllowed, personTokens } from "./providers/elevenlabs";
export type { ElevenLabsLike } from "./providers/elevenlabs";
export { SherpaProvider, loadSherpa } from "./providers/sherpa";
export { RecordingProvider, firstAsrAligner } from "./providers/registry";
export { EstimatedAligner, estimateTimings } from "./align/estimated";
export { FasterWhisperAligner } from "./align/faster-whisper";
export { WhisperCppAligner, installWhisperCppRuntime, WHISPER_CPP_VERSION } from "./align/whisper-cpp";
export { ElevenLabsForcedAligner } from "./align/elevenlabs-forced";
export { wordErrorRate, nwPairs } from "./align/nw";
export { KOKORO_VOICES, PIPER_VOICES, PIPER_DENYLIST, USER_OWNED_VOICE } from "./license";
export { CALIBRATION_TEXT } from "./text/calibration";
export { sentenceRanges } from "./text/sentences";
export { detectRetakes } from "./recording";
