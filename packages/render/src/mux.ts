// One master-audio mux (§12.3): video stream copied, the snapshot mix (or digital silence) encoded to AAC 256k/48 kHz,
// cut to the exact program length (`-t frames/fps`); `apad` keeps a short mix from shortening the file.
import type { RuntimeConfig } from "@docmaker/core";
import { ffAtomic, secondsArg } from "./ff";

export function muxArgs(video: string, mix: string | null, o: { frames: number; fps: number; startFrame: number }): string[] {
  const t = secondsArg(o.frames, o.fps);
  const audioIn = mix
    ? [...(o.startFrame > 0 ? ["-ss", secondsArg(o.startFrame, o.fps)] : []), "-i", mix]
    : ["-f", "lavfi", "-t", t, "-i", "anullsrc=r=48000:cl=stereo"];
  return [
    "-i", video, ...audioIn, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-af", "apad",
    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2", "-t", t, "-movflags", "+faststart", "-f", "mp4",
  ];
}

export async function muxMaster(video: string, mix: string | null, out: string, o: {
  frames: number; fps: number; startFrame: number; config: RuntimeConfig; signal: AbortSignal; onProgress?: (pct: number) => void;
}): Promise<void> {
  const totalMs = (o.frames / o.fps) * 1000;
  await ffAtomic(muxArgs(video, mix, o), out, {
    config: o.config, signal: o.signal,
    onProgress: o.onProgress ? (ms) => o.onProgress!(Math.min(1, ms / Math.max(1, totalMs))) : undefined,
  });
}
