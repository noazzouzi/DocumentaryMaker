// MODEL_MANIFEST + ensureModel (§8.7) — M2.
import { notImplemented } from "./notImplemented";
import type { VoiceCtx } from "./types";
export const MODEL_MANIFEST: readonly { id: string; url: string; approxBytes: number; sha256: string | null; extractTo: string }[] = [];
export function ensureModel(_id: string, _ctx: VoiceCtx): Promise<string> {
  throw notImplemented("voice.ensureModel");
}
