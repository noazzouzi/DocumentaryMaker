// ffmpeg/ffprobe helpers for the render pipeline (core `run`: own process group, killed as a tree on abort).
import { spawn } from "node:child_process";
import { rename, rm } from "node:fs/promises";
import { DocmakerError, type RuntimeConfig } from "@docmaker/core";
import { killTree, run } from "@docmaker/core/node";

const tail = (s: string, n = 10) => s.split(/\r?\n/).filter((l) => l.trim() !== "" && !/^[a-z_]+=/.test(l)).slice(-n).join("\n");

export interface FfOptions { config: RuntimeConfig; signal: AbortSignal; cwd?: string; onProgress?: (outTimeMs: number) => void; code?: "RENDER_FAILED" | "MIX_FAILED" | "INTERNAL" }

/**
 * ffmpeg -hide_banner -nostdin -y -progress pipe:2 in its own process group; non-zero exit → DocmakerError(code,
 * default RENDER_FAILED). Unlike a plain spawn, an abort resolves only AFTER the whole tree has exited (ffmpeg flushes
 * its output on SIGTERM), so callers can delete partial files without racing the encoder.
 */
export function ff(args: string[], o: FfOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (o.signal.aborted) return reject(new DocmakerError("CANCELED", "ffmpeg canceled before start"));
    const child = spawn(o.config.ffmpeg, ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-progress", "pipe:2", "-nostats", ...args], {
      cwd: o.cwd, detached: true, stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    let buf = "";
    let aborted = false;
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (c: string) => {
      stderr = (stderr + c).slice(-64_000);
      if (!o.onProgress) return;
      buf += c;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const m = /^out_time_us=(\d+)$/.exec(buf.slice(0, i).trim());
        buf = buf.slice(i + 1);
        if (m) o.onProgress(Math.round(Number(m[1]) / 1000));
      }
    });
    const onAbort = () => {
      aborted = true;
      if (child.pid) void killTree(child.pid);
    };
    o.signal.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e: NodeJS.ErrnoException) => {
      o.signal.removeEventListener("abort", onAbort);
      reject(e.code === "ENOENT"
        ? new DocmakerError("TOOL_MISSING", `${o.config.ffmpeg} not found`, { hint: "install ffmpeg ≥ 6.1 or set DOCMAKER_FFMPEG" })
        : new DocmakerError("INTERNAL", `failed to start ffmpeg: ${e.message}`, { cause: e }));
    });
    child.on("close", (code, sig) => {
      o.signal.removeEventListener("abort", onAbort);
      if (aborted || o.signal.aborted) return reject(new DocmakerError("CANCELED", "ffmpeg canceled"));
      if (code === 0) return resolve();
      reject(new DocmakerError(o.code ?? "RENDER_FAILED", `ffmpeg exited with code ${code ?? sig}: ${tail(stderr)}`, { details: { args } }));
    });
  });
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
