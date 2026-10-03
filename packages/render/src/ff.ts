// ffmpeg/ffprobe helpers for the render pipeline (core `run`: own process group, killed as a tree on abort).
import { rename, rm } from "node:fs/promises";
import { DocmakerError, type RuntimeConfig } from "@docmaker/core";
import { run } from "@docmaker/core/node";

const tail = (s: string, n = 10) => s.split(/\r?\n/).filter((l) => l.trim() !== "" && !/^[a-z_]+=/.test(l)).slice(-n).join("\n");

export interface FfOptions { config: RuntimeConfig; signal: AbortSignal; cwd?: string; onProgress?: (outTimeMs: number) => void; code?: "RENDER_FAILED" | "MIX_FAILED" | "INTERNAL" }

/** ffmpeg -hide_banner -nostdin -y -progress pipe:2; non-zero exit → DocmakerError(code, default RENDER_FAILED). */
export async function ff(args: string[], o: FfOptions): Promise<void> {
  const r = await run(o.config.ffmpeg, ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:2", "-nostats", ...args], {
    signal: o.signal,
    cwd: o.cwd,
    onStderrLine: o.onProgress
      ? (l) => {
          const m = /^out_time_us=(\d+)$/.exec(l.trim());
          if (m) o.onProgress!(Math.round(Number(m[1]) / 1000));
        }
      : undefined,
  });
  if (r.code !== 0) throw new DocmakerError(o.code ?? "RENDER_FAILED", `ffmpeg exited with code ${r.code}: ${tail(r.stderr)}`, { details: { args } });
}

/** Runs ffmpeg into `<out>.tmp.<ext>` and renames on success (never leaves a half-written output). */
export async function ffAtomic(argsWithoutOut: string[], out: string, o: FfOptions): Promise<void> {
  const dot = out.lastIndexOf(".");
  const tmp = dot > out.lastIndexOf("/") ? `${out.slice(0, dot)}.tmp${out.slice(dot)}` : `${out}.tmp`;
  try {
    await ff([...argsWithoutOut, tmp], o);
    await rename(tmp, out);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** Number of video packets (= frames for h264/prores) without decoding: fast even on 30-minute files. */
export async function countVideoFrames(file: string, o: { config: RuntimeConfig; signal: AbortSignal; decode?: boolean }): Promise<number> {
  const field = o.decode ? "nb_read_frames" : "nb_read_packets";
  const r = await run(o.config.ffprobe, [
    "-v", "error", "-select_streams", "v:0", o.decode ? "-count_frames" : "-count_packets",
    "-show_entries", `stream=${field}`, "-of", "default=nokey=1:noprint_wrappers=1", file,
  ], { signal: o.signal });
  const n = Number.parseInt(r.stdout.trim(), 10);
  if (r.code !== 0 || !Number.isFinite(n)) throw new DocmakerError("RENDER_FAILED", `ffprobe could not count frames of ${file}: ${tail(r.stderr)}`);
  return n;
}

/** Seconds as an ffmpeg time string with microsecond precision (exact frame boundaries). */
export const secondsArg = (frames: number, fps: number): string => (frames / fps).toFixed(6);
