// packages/core/src/node/proc.ts — child processes, each in its OWN process group (detached) so cancel kills the tree.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FfprobeResult, FfprobeStream, RuntimeConfig } from "../interfaces";
import { ErrorCode } from "../schema/ops";
import { DocmakerError } from "../util/errors";
import { pidAlive, sleep } from "./fsutil";

export interface RunOptions {
  signal: AbortSignal; cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number;
  onStderrLine?: (l: string) => void; onStdoutLine?: (l: string) => void; input?: string;
}

function groupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Abort → SIGTERM to -pid (group), SIGKILL after 3 s. */
export async function killTree(pid: number): Promise<void> {
  const send = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig);
    } catch {
      try { process.kill(pid, sig); } catch { /* already gone */ }
    }
  };
  send("SIGTERM");
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (!groupAlive(pid) && !pidAlive(pid)) return;
    await sleep(50);
  }
  send("SIGKILL");
}

function lineSplitter(cb: ((l: string) => void) | undefined) {
  let buf = "";
  return {
    push(chunk: string) {
      if (!cb) return;
      buf += chunk;
      let i: number;
      while ((i = buf.search(/\r?\n|\r/)) >= 0) {
        const line = buf.slice(0, i);
        const m = /\r?\n|\r/.exec(buf.slice(i))!;
        buf = buf.slice(i + m[0].length);
        cb(line);
      }
    },
    flush() {
      if (cb && buf !== "") cb(buf);
      buf = "";
    },
  };
}

/** Runs a command; resolves with its exit code and output (non-zero codes are returned, not thrown). */
export function run(cmd: string, args: string[], opts: RunOptions): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (opts.signal.aborted) return reject(new DocmakerError("CANCELED", `${path.basename(cmd)} canceled before start`));
    const child = spawn(cmd, args, {
      cwd: opts.cwd, env: opts.env ?? process.env, detached: true, stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const outLines = lineSplitter(opts.onStdoutLine);
    const errLines = lineSplitter(opts.onStderrLine);
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      opts.signal.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      if (child.pid) void killTree(child.pid);
      finish(() => reject(new DocmakerError("CANCELED", `${path.basename(cmd)} canceled`)));
    };
    opts.signal.addEventListener("abort", onAbort, { once: true });
    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        if (child.pid) void killTree(child.pid);
        finish(() => reject(new DocmakerError("INTERNAL", `${path.basename(cmd)} timed out after ${opts.timeoutMs} ms`, { retryable: true, details: { stderr: stderr.slice(-4000) } })));
      }, opts.timeoutMs);
    }
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c: string) => { stdout += c; outLines.push(c); });
    child.stderr.on("data", (c: string) => { stderr += c; errLines.push(c); });
    child.on("error", (e: NodeJS.ErrnoException) => {
      finish(() => reject(e.code === "ENOENT"
        ? new DocmakerError("TOOL_MISSING", `${cmd} not found`, { hint: `install ${path.basename(cmd)} or fix PATH`, cause: e })
        : new DocmakerError("INTERNAL", `failed to start ${cmd}: ${e.message}`, { cause: e })));
    });
    child.on("close", (code, sig) => {
      outLines.flush();
      errLines.flush();
      finish(() => resolve({ code: code ?? (sig ? 128 : 1), stdout, stderr }));
    });
    child.stdin.on("error", () => { /* EPIPE when the child exits early */ });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

function tail(s: string, n = 12): string {
  return s.split(/\r?\n/).filter((l) => l.trim() !== "").slice(-n).join("\n");
}

/** ffmpeg with -hide_banner -nostdin -y -progress pipe:2; non-zero exit → DocmakerError. */
export async function ffmpeg(args: string[], opts: { config: RuntimeConfig; signal: AbortSignal; onProgress?: (outTimeMs: number) => void }): Promise<void> {
  const r = await run(opts.config.ffmpeg, ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:2", "-nostats", ...args], {
    signal: opts.signal,
    onStderrLine: opts.onProgress
      ? (l) => {
          const m = /^out_time_(?:us|ms)=(\d+)$/.exec(l.trim());
          if (m) opts.onProgress!(Math.round(Number(m[1]) / 1000));
        }
      : undefined,
  });
  if (r.code !== 0) {
    throw new DocmakerError("INTERNAL", `ffmpeg exited with code ${r.code}: ${tail(r.stderr.replace(/^[a-z_]+=.*$/gm, ""))}`, { details: { args } });
  }
}

const num = (x: unknown): number | null => {
  if (x === undefined || x === null || x === "" || x === "N/A") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const rate = (x: unknown): number | null => {
  if (typeof x !== "string") return null;
  const [a, b] = x.split("/").map(Number);
  if (!Number.isFinite(a) || !b) return null;
  return a! / b;
};

export async function ffprobeJson(file: string, opts: { config: RuntimeConfig; signal: AbortSignal; countFrames?: boolean }): Promise<FfprobeResult> {
  const args = ["-v", "error", "-print_format", "json", "-show_format", "-show_streams"];
  if (opts.countFrames) args.push("-count_frames");
  args.push(file);
  const r = await run(opts.config.ffprobe, args, { signal: opts.signal });
  if (r.code !== 0) throw new DocmakerError("INTERNAL", `ffprobe failed on ${path.basename(file)}: ${tail(r.stderr)}`);
  const j = JSON.parse(r.stdout) as { format?: Record<string, unknown>; streams?: Record<string, unknown>[] };
  const streams: FfprobeStream[] = (j.streams ?? []).map((s) => ({
    index: Number(s.index ?? 0),
    codecType: (["video", "audio", "subtitle"].includes(String(s.codec_type)) ? s.codec_type : "data") as FfprobeStream["codecType"],
    codecName: String(s.codec_name ?? ""),
    width: num(s.width),
    height: num(s.height),
    pixFmt: typeof s.pix_fmt === "string" ? s.pix_fmt : null,
    fps: s.codec_type === "video" ? rate(s.r_frame_rate) : null,
    sampleRate: num(s.sample_rate),
    channels: num(s.channels),
    durationSec: num(s.duration),
    nbFrames: opts.countFrames ? num(s.nb_read_frames) ?? num(s.nb_frames) : num(s.nb_frames),
  }));
  return {
    formatName: String(j.format?.format_name ?? ""),
    durationSec: num(j.format?.duration) ?? 0,
    bitRate: num(j.format?.bit_rate),
    streams,
  };
}

/** <pyVenv>/bin/python -m docmaker_sidecar <cmd> --in <tmp> --out <tmp>; missing venv → TOOL_MISSING. */
export async function runSidecar<T>(
  cmd: "asr" | "piper-align" | "beats" | "energy" | "cuts",
  input: unknown,
  opts: { config: RuntimeConfig; signal: AbortSignal; timeoutMs?: number; onProgress?: (pct: number, msg: string) => void },
): Promise<T> {
  const python = path.join(opts.config.paths.pyVenv, "bin", "python");
  if (!existsSync(python)) {
    throw new DocmakerError("TOOL_MISSING", "the Python sidecar is not set up", { hint: "run `docmaker setup --python`" });
  }
  const dir = await mkdtemp(path.join(os.tmpdir(), "docmaker-sidecar-"));
  const inFile = path.join(dir, "in.json");
  const outFile = path.join(dir, "out.json");
  try {
    await writeFile(inFile, JSON.stringify(input));
    const pyRoot = path.join(opts.config.repoRoot, "python");
    const r = await run(python, ["-m", "docmaker_sidecar", cmd, "--in", inFile, "--out", outFile], {
      signal: opts.signal,
      cwd: pyRoot,
      timeoutMs: opts.timeoutMs,
      env: { ...process.env, PYTHONPATH: pyRoot, PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" },
      onStderrLine: opts.onProgress
        ? (l) => {
            const m = /^PROGRESS\s+([\d.]+)\s*(.*)$/.exec(l);
            if (m) opts.onProgress!(Math.max(0, Math.min(1, Number(m[1]))), m[2] ?? "");
          }
        : undefined,
    });
    if (r.code !== 0) {
      // the dispatcher writes {"error": <ErrorCode>, "message"} to out.json on a handled failure (§8.8): keep its code
      let err: { error?: unknown; message?: unknown } | null = null;
      try {
        err = JSON.parse(await readFile(outFile, "utf8")) as { error?: unknown; message?: unknown };
      } catch {
        /* no error JSON */
      }
      const code = ErrorCode.safeParse(err?.error);
      if (code.success) {
        throw new DocmakerError(code.data, typeof err?.message === "string" ? err.message : `sidecar ${cmd} failed`, {
          hint: code.data === "TOOL_MISSING" || code.data === "MODEL_MISSING" ? "run `docmaker setup --python`" : undefined,
          details: { stderr: tail(r.stderr) },
        });
      }
      throw new DocmakerError("INTERNAL", `sidecar ${cmd} failed (code ${r.code}): ${tail(r.stderr)}`);
    }
    return JSON.parse(await readFile(outFile, "utf8")) as T;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
