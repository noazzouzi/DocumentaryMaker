// Provider and aligner factories.
import type { Aligner, Lang, Logger, RuntimeConfig, Secrets, TtsCapabilities, TtsProvider, TtsResult, VoiceInfo, VoiceProviderId } from "@docmaker/core";
import { DocmakerError } from "@docmaker/core";
import { EstimatedAligner } from "../align/estimated";
import { FasterWhisperAligner, type FasterWhisperOptions } from "../align/faster-whisper";
import { WhisperCppAligner } from "../align/whisper-cpp";
import { ElevenLabsForcedAligner } from "../align/elevenlabs-forced";
import { ElevenLabsProvider } from "./elevenlabs";
import { SherpaProvider } from "./sherpa";
import { SyntheticProvider } from "./synthetic";

export interface ProviderCfg { config: RuntimeConfig; secrets: Secrets; logger: Logger }

/** The user's own recordings are imported (importRecording), never synthesised. */
export class RecordingProvider implements TtsProvider {
  readonly id = "recording" as const;
  async isAvailable() { return { ok: true, hint: null }; }
  async capabilities(): Promise<TtsCapabilities> {
    return { languages: ["en", "fr"], nativeWordTimestamps: false, stitching: false, maxCharsPerRequest: 0, voiceCloning: false, normalizesNumbers: true, costPer1kCharsUsd: 0, tier: null };
  }
  async listVoices(_lang?: Lang): Promise<VoiceInfo[]> { return []; }
  async synthesize(): Promise<TtsResult> {
    throw new DocmakerError("VALIDATION", "recording takes are imported from your audio files, not synthesised", { hint: "docmaker voice import <files>" });
  }
}

export function createTtsProvider(id: VoiceProviderId, cfg: ProviderCfg): TtsProvider {
  switch (id) {
    case "synthetic":
      return new SyntheticProvider({ repoRoot: cfg.config.repoRoot });
    case "elevenlabs":
      return new ElevenLabsProvider({ apiKey: cfg.secrets.elevenlabs ?? null, config: cfg.config, logger: cfg.logger });
    case "kokoro":
    case "piper":
      return new SherpaProvider(id, { config: cfg.config, logger: cfg.logger });
    case "recording":
      return new RecordingProvider();
  }
}

export function createAligner(id: Aligner["id"], cfg: ProviderCfg, opts: FasterWhisperOptions = {}): Aligner {
  switch (id) {
    case "estimated":
      return new EstimatedAligner(cfg.config);
    case "faster-whisper":
      return new FasterWhisperAligner(cfg.config, undefined, undefined, opts);
    case "whisper-cpp":
      return new WhisperCppAligner(cfg.config);
    case "elevenlabs-forced":
      return new ElevenLabsForcedAligner(new ElevenLabsProvider({ apiKey: cfg.secrets.elevenlabs ?? null, config: cfg.config, logger: cfg.logger }));
  }
}

/**
 * First available ASR aligner (faster-whisper, then whisper.cpp); null when none is installed. With localFilesOnly
 * (optional QA during synthesis) faster-whisper only counts when its model is already on disk and never downloads.
 */
export async function firstAsrAligner(cfg: ProviderCfg, prefer: "faster-whisper" | "whisper-cpp" | "auto" = "auto", opts: FasterWhisperOptions = {}): Promise<Aligner | null> {
  const order: Aligner["id"][] = prefer === "whisper-cpp" ? ["whisper-cpp"] : prefer === "faster-whisper" ? ["faster-whisper"] : ["faster-whisper", "whisper-cpp"];
  for (const id of order) {
    const a = createAligner(id, cfg, opts);
    if ((await a.isAvailable()).ok) return a;
  }
  return null;
}
