// importRecording (§8.6) — M2.
import type { VoiceTrack } from "@docmaker/core";
import { notImplemented } from "./notImplemented";
import type { ImportRecordingInput, VoiceCtx } from "./types";
export function importRecording(_i: ImportRecordingInput, _ctx: VoiceCtx): Promise<VoiceTrack> {
  throw notImplemented("voice.importRecording");
}
export function detectRetakes(): never {
  throw notImplemented("voice.detectRetakes");
}
