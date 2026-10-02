// Deterministic hashes: voice settings, segment cache keys (§8.4) and take ids (§8.9).
import type { VoiceProviderId, VoiceSettings } from "@docmaker/core";
import { hashJson, sha12, sha256Hex } from "@docmaker/core";
import { POST_CHAIN_VERSION } from "./post/chain";

/** Hash of the settings that change the audio. charsPerSec only matters for the synthetic voice (its timing). */
export function voiceSettingsHash(v: VoiceSettings): string {
  return hashJson({
    provider: v.provider,
    voiceId: v.voiceId,
    modelId: v.modelId ?? null,
    speed: v.speed ?? 1,
    stability: v.stability ?? null,
    similarityBoost: v.similarityBoost ?? null,
    style: v.style ?? null,
    charsPerSec: v.provider === "synthetic" ? (v.charsPerSec ?? null) : null,
  });
}

/** sha256(provider|voiceId|modelId|settingsHash|ttsTextHash|contextKey|POST_CHAIN_VERSION). */
export function segmentCacheKey(o: { provider: VoiceProviderId; voiceId: string; modelId: string | null; settingsHash: string; ttsTextHash: string; contextKey: string }): string {
  return sha256Hex([o.provider, o.voiceId, o.modelId ?? "", o.settingsHash, o.ttsTextHash, o.contextKey, `post${POST_CHAIN_VERSION}`].join("|"));
}

/** `<take|scratch>-<sha12(provider|voiceId|settingsHash|sorted cacheKeys)>` — an all-cache-hit re-run gives the same id. */
export function takeIdFor(kind: "scratch" | "final", provider: VoiceProviderId, voiceId: string, settingsHash: string, segmentCacheKeys: string[]): string {
  const prefix = kind === "scratch" ? "scratch" : "take";
  return `${prefix}-${sha12([provider, voiceId, settingsHash, ...[...segmentCacheKeys].sort()].join("|"))}`;
}
