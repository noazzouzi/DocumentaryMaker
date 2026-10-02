// ElevenLabs forced alignment (§8.5, M3; paid ≈ $0.22/h): known script text + audio → word timings.
import type { Aligner, Lang, WordTiming } from "@docmaker/core";
import { DocmakerError } from "@docmaker/core";
import type { ElevenLabsProvider } from "../providers/elevenlabs";
import { alignScriptToTranscript } from "./nw";

export const FORCED_ALIGNMENT_USD_PER_HOUR = 0.22;

export class ElevenLabsForcedAligner implements Aligner {
  readonly id = "elevenlabs-forced" as const;
  constructor(private readonly provider: ElevenLabsProvider) {}
  isAvailable() { return this.provider.isAvailable(); }
  async transcribe(): Promise<WordTiming[]> {
    throw new DocmakerError("VALIDATION", "forced alignment needs the script text; use align()");
  }
  async align(audioPath: string, ttsWords: string[], _lang: Lang, _signal: AbortSignal): Promise<WordTiming[]> {
    const words = await this.provider.forcedAlign(audioPath, ttsWords.join(" "));
    return alignScriptToTranscript(ttsWords, words).map(({ matched: _m, ...w }) => w);
  }
}
