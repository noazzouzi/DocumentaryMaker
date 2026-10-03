// Unit-test helpers: temp dirs, a RuntimeConfig rooted in them, and synthetic media via ffmpeg (no Chrome, no network).
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createLogger, homePaths } from "@docmaker/core/node";
import type { RuntimeConfig } from "@docmaker/core";

export async function tmpDir(prefix = "docmaker-render-test-"): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export function repoRoot(): string {
  return path.resolve(import.meta.dirname, "../../..");
}

export function testConfig(home: string, over: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    repoRoot: repoRoot(), paths: homePaths(home), projectsDir: path.join(home, "projects"), contact: null,
    userAgentBase: "DocumentaryMaker/test", ffmpeg: "ffmpeg", ffprobe: "ffprobe", offline: true, logLevel: "error",
    autoApproveUsd: 0, browserExecutable: null, renderLockFile: path.join(home, "render.lock"), ...over,
  };
}

export const quietLogger = () => createLogger({ level: "error", sink: () => undefined });

export function ffmpegSync(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")}: ${r.stderr}`);
}

export function probeFrames(file: string): number {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number.parseInt(r.stdout.trim(), 10);
}

export function probeJson(file: string): { format: { duration: string }; streams: { codec_type: string; codec_name: string; width?: number; height?: number; sample_rate?: string; channels?: number; duration?: string }[] } {
  const r = spawnSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8" });
  return JSON.parse(r.stdout);
}

/** A muted h264-ts chunk of `frames` frames (like Remotion's h264-ts output). */
export function makeTsChunk(file: string, frames: number, o: { fps?: number; color?: string; size?: string } = {}): void {
  ffmpegSync(["-f", "lavfi", "-i", `color=c=${o.color ?? "red"}:s=${o.size ?? "320x180"}:r=${o.fps ?? 30}`, "-frames:v", String(frames), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-f", "mpegts", file]);
}
