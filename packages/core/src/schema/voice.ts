import { z } from "zod";
import { IsoDateTime, Lang, Ms, SegmentId, Sha256, TakeId, WordId, docVersion } from "./common";
import { VoiceProviderId } from "./project";
import { LicenseInfo } from "./license";

/** Provider/ASR-level timing, before mapping to script word ids. */
export const WordTiming = z.object({
  text: z.string(),
  startMs: Ms,
  endMs: Ms,
  confidence: z.number().min(0).max(1).nullable(),
});
export type WordTiming = z.infer<typeof WordTiming>;

export const TimingSource = z.enum(["provider", "aligned", "interpolated", "estimated", "synthetic"]);
export type TimingSource = z.infer<typeof TimingSource>;

/** Timing of one DISPLAY word (script word id), relative to its segment file start. Shifted times are clamped ≥ 0. */
export const TimedWord = z.object({
  wordId: WordId,
  text: z.string(),
  startMs: Ms,
  endMs: Ms,
  confidence: z.number().min(0).max(1).nullable(),
  source: TimingSource,
});
export type TimedWord = z.infer<typeof TimedWord>;

export const SegmentTake = z.object({
  segmentId: SegmentId,
  mode: z.enum(["narration", "clip-narrated"]),
  file: z.string(), // project-relative: voice/<lang>/<takeId>/seg/<segmentId>.wav (48 kHz mono s16, post-chain)
  sha256: Sha256,
  durationMs: Ms,
  ttsText: z.string(),
  ttsTextHash: Sha256, // hashJson(ttsText)
  cacheKey: Sha256, // §8.4 segment cache key (provider|voice|settings|ttsTextHash|context|POST_CHAIN_VERSION)
  leadTrimMs: Ms, // leading silence removed (words already shifted)
  words: z.array(TimedWord),
  providerRequestId: z.string().nullable(),
  asrWer: z.number().min(0).nullable(), // round-trip QA when an ASR is available
  pickup: z.boolean(), // recording take: segment synthesised by pickupProvider ("PICKUP TTS" marker)
});
export type SegmentTake = z.infer<typeof SegmentTake>;

export const VoiceTrack = z.object({
  schemaVersion: docVersion("voiceTrack"),
  id: TakeId, // deterministic: (take|scratch)-<sha12(provider|voiceId|settingsHash|sorted segment cacheKeys)>
  kind: z.enum(["scratch", "final"]), // scratch = free synthetic/estimated take used for preview before the paid take
  lang: Lang,
  provider: VoiceProviderId,
  voiceId: z.string(),
  modelId: z.string().nullable(),
  settingsHash: Sha256,
  license: LicenseInfo, // voice licence (Piper CC-BY → attribution; ElevenLabs tier) → credits "Voice" group
  createdAt: IsoDateTime,
  segments: z.array(SegmentTake),
  missingSegmentIds: z.array(SegmentId), // e.g. the user recording did not cover them
  charsBilled: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  timing: z.object({ source: TimingSource, meanConfidence: z.number().nullable() }),
  notes: z.array(z.string()),
});
export type VoiceTrack = z.infer<typeof VoiceTrack>;

export const ActiveTake = z.object({
  schemaVersion: docVersion("activeTake"),
  lang: Lang,
  takeId: TakeId,
  setAt: IsoDateTime,
});
export type ActiveTake = z.infer<typeof ActiveTake>;
