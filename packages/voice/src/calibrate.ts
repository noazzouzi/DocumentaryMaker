// calibrateVoice (§8.7) — M2.
import type { Lang, VoiceSettings } from "@docmaker/core";
import { notImplemented } from "./notImplemented";
import type { VoiceCtx } from "./types";
export function calibrateVoice(_i: { lang: Lang; voice: VoiceSettings; projectDir: string }, _ctx: VoiceCtx): Promise<{ charsPerSec: number }> {
  throw notImplemented("voice.calibrateVoice");
}
