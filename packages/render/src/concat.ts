// Chunk concatenation (§12.3): ffmpeg concat demuxer with -c copy (verified frame-exact on muted h264-ts chunks), then
// a frame-count check; a mismatch falls back to ONE re-encoding concat, and a second mismatch is RENDER_FAILED.
import { rm, writeFile } from "node:fs/promises";
import { DocmakerError, type Logger, type RuntimeConfig } from "@docmaker/core";
import { countVideoFrames, ffAtomic } from "./ff";

/** concat demuxer list line (single quotes escaped the ffmpeg way). */
export const concatListLine = (file: string): string => `file '${file.replace(/'/g, "'\\''")}'`;

export interface ConcatOptions {
  config: RuntimeConfig; signal: AbortSignal; logger: Logger;
  expectedFrames: number; fps: number;
  /** re-encode settings for the fallback path */
  x264Preset: string; crf: number;
  onProgress?: (pct: number) => void;
}

export async function concatChunks(files: readonly string[], out: string, o: ConcatOptions): Promise<{ frames: number; reencoded: boolean }> {
  if (files.length === 0) throw new DocmakerError("RENDER_FAILED", "nothing to concatenate");
  const list = `${out}.concat.txt`;
  await writeFile(list, files.map(concatListLine).join("\n") + "\n");
  const totalMs = (o.expectedFrames / o.fps) * 1000;
  const onProgress = o.onProgress ? (ms: number) => o.onProgress!(Math.min(1, ms / Math.max(1, totalMs))) : undefined;
  try {
    await ffAtomic(["-f", "concat", "-safe", "0", "-i", list, "-map", "0:v:0", "-c", "copy", "-movflags", "+faststart", "-f", "mp4"], out, { config: o.config, signal: o.signal, onProgress });
    let frames = await countVideoFrames(out, o);
    if (frames === o.expectedFrames) return { frames, reencoded: false };
    o.logger.warn("stream-copy concat is not frame-exact; re-encoding", { frames, expected: o.expectedFrames });
    await ffAtomic([
      "-f", "concat", "-safe", "0", "-i", list, "-map", "0:v:0", "-c:v", "libx264", "-preset", o.x264Preset, "-crf", String(o.crf),
      "-pix_fmt", "yuv420p", "-fps_mode", "cfr", "-r", String(o.fps), "-frames:v", String(o.expectedFrames), "-movflags", "+faststart", "-f", "mp4",
    ], out, { config: o.config, signal: o.signal, onProgress });
    frames = await countVideoFrames(out, o);
    if (frames !== o.expectedFrames) throw new DocmakerError("RENDER_FAILED", `concatenated video has ${frames} frames, expected ${o.expectedFrames}`);
    return { frames, reencoded: true };
  } finally {
    await rm(list, { force: true });
  }
}
