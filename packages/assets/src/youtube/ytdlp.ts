// Local yt-dlp wrapper (§7.7): binary resolution, fixed flags, error mapping, search, transcripts, downloads (M3), probe.
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DocmakerError, isDocmakerError } from "@docmaker/core";
import type { RuntimeConfig, WordTiming } from "@docmaker/core";
import { ffmpeg, run, runSidecar } from "@docmaker/core/node";
import { makeTmpDir, rmrf } from "../util";
import { parseJson3, parseVtt, pickSubtitleTrack } from "./json3";

export type YtErrorCode = "YT_RATE_LIMIT" | "YT_BOT_CHECK" | "YT_FORBIDDEN" | "YT_UNAVAILABLE";

/** stderr → typed error code (null when unrecognised). */
export function mapYtError(stderr: string): YtErrorCode | null {
  if (/HTTP Error 429|Too Many Requests/i.test(stderr)) return "YT_RATE_LIMIT";
  // Age gates also say "Sign in to confirm…": they concern one video, not this machine (checked before the bot-check pattern).
  if (AGE_GATE_RE.test(stderr)) return "YT_UNAVAILABLE";
  if (/Sign in to confirm|confirm you.re not a bot|--cookies-from-browser/i.test(stderr)) return "YT_BOT_CHECK";
  if (/HTTP Error 403|403: Forbidden/i.test(stderr)) return "YT_FORBIDDEN";
  if (/Video unavailable|Private video|This video (is|has been) (private|removed|unavailable)|members-only|account associated with this video has been terminated/i.test(stderr)) return "YT_UNAVAILABLE";
  return null;
}

/** yt-dlp's age-gate messages ("Sign in to confirm your age. This video may be inappropriate for some users."). */
export const AGE_GATE_RE = /confirm your age|age[- ]restricted|inappropriate for some users/i;
const AGE_HINT = "the video is age-restricted; pick another source or import the clip manually (--file)";

const HINTS: Record<YtErrorCode, string> = {
  YT_RATE_LIMIT: "YouTube rate-limited this machine; wait a few minutes or import the clip manually",
  YT_BOT_CHECK: "YouTube asks for a bot check: run from a residential network, configure a PO-token server (DOCMAKER_YT_POT_URL), browser cookies (DOCMAKER_YT_COOKIES_BROWSER, ban risk) or import the clip manually",
  YT_FORBIDDEN: "googlevideo refused the download (typical on datacenter IPs); run locally or import the clip manually",
  YT_UNAVAILABLE: "the video is unavailable or private",
};

/** <home>/py/.venv/bin/yt-dlp, else <home>/bin/yt-dlp, else TOOL_MISSING. */
export function ytBinary(config: RuntimeConfig): string {
  const venv = path.join(config.paths.pyVenv, "bin", "yt-dlp");
  if (existsSync(venv)) return venv;
  const standalone = path.join(config.paths.bin, "yt-dlp");
  if (existsSync(standalone)) return standalone;
  throw new DocmakerError("TOOL_MISSING", "yt-dlp is not installed", { hint: "run `docmaker setup --yt-dlp`" });
}

function onPath(bin: string, env: NodeJS.ProcessEnv): boolean {
  return (env.PATH ?? "").split(path.delimiter).some((d) => d !== "" && existsSync(path.join(d, bin)));
}

/** Flags always passed (§7.7). */
export function ytBaseFlags(env: NodeJS.ProcessEnv = process.env): string[] {
  const f = ["-t", "sleep", "--no-warnings", "--newline"];
  if (!onPath("deno", env)) f.push("--js-runtimes", "node");
  const pot = env.DOCMAKER_YT_POT_URL;
  if (pot) f.push("--extractor-args", "youtube:player_client=mweb", "--extractor-args", `youtubepot-bgutilhttp:base_url=${pot}`);
  const cookies = env.DOCMAKER_YT_COOKIES_BROWSER;
  if (cookies) f.push("--cookies-from-browser", cookies);
  return f;
}

/** Minimal child environment (§17.1): PATH, HOME, proxies; never API keys. */
function childEnv(): NodeJS.ProcessEnv {
  const keep = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "NO_PROXY", "no_proxy", "ALL_PROXY", "SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "NODE_EXTRA_CA_CERTS"];
  const env: NodeJS.ProcessEnv = {};
  for (const k of keep) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

export interface YtCtx { config: RuntimeConfig; signal: AbortSignal; logger?: { debug(m: string, x?: Record<string, unknown>): void; warn(m: string, x?: Record<string, unknown>): void }; onProgress?: (pct: number) => void }

/** Runs yt-dlp; maps failures; retries YT_RATE_LIMIT after 60 s (≤ 2). */
export async function ytRun(args: string[], ctx: YtCtx, o?: { retryDelayMs?: number }): Promise<string> {
  if (ctx.config.offline) throw new DocmakerError("OFFLINE", "offline mode: YouTube is disabled");
  const bin = ytBinary(ctx.config);
  const delay = o?.retryDelayMs ?? 60_000;
  for (let attempt = 0; ; attempt++) {
    const r = await run(bin, [...ytBaseFlags(), ...args], {
      signal: ctx.signal, env: childEnv(),
      onStdoutLine: ctx.onProgress
        ? (l) => {
            const m = /^download:\s*([\d.]+)%/.exec(l.trim());
            if (m) ctx.onProgress!(Number(m[1]) / 100);
          }
        : undefined,
    });
    if (r.code === 0) return r.stdout;
    const code = mapYtError(r.stderr);
    if (code === "YT_RATE_LIMIT" && attempt < 2) {
      ctx.logger?.warn("yt-dlp rate limited; retrying in 60 s", { attempt });
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        ctx.signal.addEventListener("abort", () => { clearTimeout(t); reject(new DocmakerError("CANCELED", "canceled")); }, { once: true });
      });
      continue;
    }
    const tail = r.stderr.split("\n").filter((l) => l.trim()).slice(-4).join("\n");
    if (code) throw new DocmakerError(code, `yt-dlp: ${tail || code}`, { hint: AGE_GATE_RE.test(r.stderr) ? AGE_HINT : HINTS[code] });
    throw new DocmakerError("PROVIDER_ERROR", `yt-dlp failed (code ${r.code}): ${tail}`);
  }
}

export interface YtSearchHit { id: string; title: string; durationSec: number; channel: string; channelVerified: boolean; views: number }

/** Parses `--flat-playlist -J` output (a playlist with entries) or `--dump-json` lines. */
export function parseYtSearch(stdout: string): YtSearchHit[] {
  const text = stdout.trim();
  let entries: Record<string, unknown>[] = [];
  try {
    const j = JSON.parse(text) as { entries?: Record<string, unknown>[] };
    entries = Array.isArray(j.entries) ? j.entries : [j as Record<string, unknown>];
  } catch {
    entries = text.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => JSON.parse(l) as Record<string, unknown>);
  }
  return entries
    .filter((e) => typeof e.id === "string" && (e.ie_key === undefined || e.ie_key === "Youtube"))
    .map((e) => ({
      id: String(e.id), title: String(e.title ?? ""), durationSec: Number(e.duration ?? 0) || 0,
      channel: String(e.channel ?? e.uploader ?? ""), channelVerified: e.channel_is_verified === true, views: Number(e.view_count ?? 0) || 0,
    }));
}

export async function ytSearch(q: string, ctx: YtCtx): Promise<YtSearchHit[]> {
  const out = await ytRun([`ytsearch10:${q}`, "--flat-playlist", "-J"], ctx);
  return parseYtSearch(out);
}

/** A YouTube video id: exactly 11 characters of [A-Za-z0-9_-]. Anything else never reaches a URL or a file path. */
export const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
export function assertYtId(videoId: string): string {
  if (!YT_ID_RE.test(videoId)) throw new DocmakerError("VALIDATION", "invalid YouTube video id");
  return videoId;
}

export const ytUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

export async function ytInfo(videoId: string, ctx: YtCtx): Promise<Record<string, unknown>> {
  const out = await ytRun(["-J", "--skip-download", ytUrl(videoId)], ctx);
  return JSON.parse(out) as Record<string, unknown>;
}

export async function ytFetchTranscript(videoId: string, lang: string, ctx: YtCtx, opts?: { allowLocalAsr?: boolean; onLocalAsr?: () => void }): Promise<{ words: WordTiming[]; kind: "manual" | "asr-orig" | "asr" | "translated" | "local-asr" | "none"; lang: string | null }> {
  const info = await ytInfo(videoId, ctx);
  const track = pickSubtitleTrack(info as Parameters<typeof pickSubtitleTrack>[0], lang);
  if (track) {
    const tmp = await makeTmpDir("ytsubs");
    try {
      await ytRun(["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", track.key, "--sub-format", "json3/vtt", "-o", path.join(tmp, "%(id)s.%(ext)s"), ytUrl(videoId)], ctx);
      const files = await readdir(tmp);
      const j3 = files.find((f) => f.endsWith(".json3"));
      const vtt = files.find((f) => f.endsWith(".vtt"));
      let words: WordTiming[] = [];
      if (j3) words = parseJson3(JSON.parse(await readFile(path.join(tmp, j3), "utf8")));
      else if (vtt) words = parseVtt(await readFile(path.join(tmp, vtt), "utf8"));
      if (words.length > 0) return { words, kind: track.kind, lang: track.key };
    } finally {
      await rmrf(tmp);
    }
  }
  // No usable subtitles: transcribe the audio locally when the Python sidecar (faster-whisper) is installed.
  const durationSec = Number(info.duration ?? 0) || 0;
  if ((opts?.allowLocalAsr ?? true) && sidecarReady(ctx.config) && durationSec > 0 && durationSec <= LOCAL_ASR_MAX_SEC) {
    opts?.onLocalAsr?.();
    try {
      const words = await ytLocalAsr(videoId, lang, ctx);
      if (words.length > 0) return { words, kind: "local-asr", lang: lang || null };
    } catch (e) {
      if (isDocmakerError(e) && e.code === "CANCELED") throw e;
      ctx.logger?.warn("local transcription failed", { videoId, error: (e as Error).message });
    }
  }
  return { words: [], kind: "none", lang: null };
}

/** Local ASR is only worth it for videos up to 30 min (the passage search reads the top 5 results). */
export const LOCAL_ASR_MAX_SEC = 30 * 60;

export function sidecarReady(config: RuntimeConfig): boolean {
  return existsSync(path.join(config.paths.pyVenv, "bin", "python"));
}

/** faster-whisper pieces → words: a piece without a leading space continues the previous word; punctuation-only pieces attach. */
export function mergeAsrPieces(pieces: readonly { text: string; startMs: number; endMs: number; p: number | null }[]): WordTiming[] {
  const out: WordTiming[] = [];
  for (const w of pieces) {
    if (!w.text.trim()) continue;
    const startMs = Math.max(0, Math.round(w.startMs));
    const endMs = Math.max(startMs, Math.round(w.endMs));
    const conf = w.p === null || w.p === undefined ? null : Math.max(0, Math.min(1, w.p));
    const last = out[out.length - 1];
    if (last && (!/^\s/u.test(w.text) || /^\s*[.,!?;:…»"”]+\s*$/u.test(w.text))) {
      last.text += w.text.trim();
      last.endMs = Math.max(last.endMs, endMs);
      if (conf !== null) last.confidence = last.confidence === null ? conf : Math.min(last.confidence, conf);
      continue;
    }
    out.push({ text: w.text.trim(), startMs, endMs, confidence: conf });
  }
  return out;
}

/** bestaudio (yt-dlp) → 16 kHz mono WAV → sidecar `asr` (faster-whisper, word timestamps). */
export async function ytLocalAsr(videoId: string, lang: string, ctx: YtCtx): Promise<WordTiming[]> {
  assertYtId(videoId);
  const tmp = await makeTmpDir("ytasr");
  try {
    await ytRun(["-f", "ba/b", "--progress-template", "download:%(progress._percent_str)s", "-o", path.join(tmp, "%(id)s.%(ext)s"), ytUrl(videoId)], ctx);
    const src = (await readdir(tmp)).find((f) => f.startsWith(videoId));
    if (!src) throw new DocmakerError("PROVIDER_ERROR", "yt-dlp produced no audio");
    const wav = path.join(tmp, "audio.wav");
    await ffmpeg(["-i", path.join(tmp, src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { config: ctx.config, signal: ctx.signal });
    const base = (lang || "").split("-")[0]!.toLowerCase();
    const out = await runSidecar<{ words: { text: string; startMs: number; endMs: number; p: number | null }[] }>("asr", {
      audio: wav, lang: /^[a-z]{2,3}$/.test(base) ? base : null, model: "large-v3-turbo", initialPrompt: null, vad: true, beamSize: 5,
      computeType: "int8", threads: 4, modelsDir: path.join(ctx.config.paths.models, "whisper", "fw"),
    }, { config: ctx.config, signal: ctx.signal, timeoutMs: 2 * 3600_000 });
    return mergeAsrPieces(out.words ?? []);
  } finally {
    await rmrf(tmp);
  }
}

export const WHOLE_VIDEO_MAX_SEC = 15 * 60;
const FORMAT = "bv*[height<=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]";

/** M3. ≤ 15 min (or sectionMs null) → whole video, cached by id under <home>/cache/yt; else a section with handles already applied. */
export async function ytDownload(videoId: string, o: { sectionMs: [number, number] | null; outDir: string; durationSec?: number | null }, ctx: YtCtx): Promise<string> {
  assertYtId(videoId);
  const cacheDir = path.join(ctx.config.paths.cache, "yt");
  const whole = o.sectionMs === null || (o.durationSec ?? Infinity) <= WHOLE_VIDEO_MAX_SEC;
  await mkdir(whole ? cacheDir : o.outDir, { recursive: true });
  if (whole) {
    const cached = ytCachePath(ctx.config, videoId);
    try {
      if ((await stat(cached)).size > 0) return cached;
    } catch { /* not cached */ }
    const tmp = await makeTmpDir("ytdl");
    try {
      await ytRun(["-f", FORMAT, "-t", "mp4", "--progress-template", "download:%(progress._percent_str)s", "-o", path.join(tmp, "%(id)s.%(ext)s"), ytUrl(videoId)], ctx);
      const f = (await readdir(tmp)).find((x) => x.endsWith(".mp4"));
      if (!f) throw new DocmakerError("PROVIDER_ERROR", "yt-dlp produced no mp4");
      await rename(path.join(tmp, f), cached).catch(async (e: NodeJS.ErrnoException) => {
        if (e.code !== "EXDEV") throw e;
        const { copyFile } = await import("node:fs/promises");
        await copyFile(path.join(tmp, f), cached);
      });
      return cached;
    } finally {
      await rmrf(tmp);
    }
  }
  const [s, e] = o.sectionMs!;
  const tag = `${videoId}_${s}-${e}`;
  const fmt = (ms: number) => (ms / 1000).toFixed(3);
  await ytRun(["-f", FORMAT, "-t", "mp4", "--download-sections", `*${fmt(s)}-${fmt(e)}`, "--force-keyframes-at-cuts", "--progress-template", "download:%(progress._percent_str)s", "-o", path.join(o.outDir, `${tag}.%(ext)s`), ytUrl(videoId)], ctx);
  const f = (await readdir(o.outDir)).find((x) => x.startsWith(tag) && x.endsWith(".mp4"));
  if (!f) throw new DocmakerError("PROVIDER_ERROR", "yt-dlp produced no mp4 section");
  return path.join(o.outDir, f);
}

/** Deletes a cached full-source download (keepSourceDownloads:false). */
export async function dropYtSource(config: RuntimeConfig, videoId: string): Promise<void> {
  await rm(ytCachePath(config, videoId), { force: true });
}

/** <home>/cache/yt/<id>.mp4 — the id is validated and the result must stay inside the cache directory. */
export function ytCachePath(config: RuntimeConfig, videoId: string): string {
  const dir = path.resolve(config.paths.cache, "yt");
  const file = path.resolve(dir, `${assertYtId(videoId)}.mp4`);
  if (path.dirname(file) !== dir) throw new DocmakerError("VALIDATION", "invalid YouTube video id");
  return file;
}

/** A long-lived public video used by `doctor`. */
export const YT_PROBE_VIDEO = "jNQXAC9IVRw";

export async function ytProbe(ctx: YtCtx): Promise<"ok" | "bot-check" | "403" | "missing" | "offline"> {
  if (ctx.config.offline) return "offline";
  try {
    ytBinary(ctx.config);
  } catch {
    return "missing";
  }
  try {
    await ytRun(["-J", "--skip-download", ytUrl(YT_PROBE_VIDEO)], ctx, { retryDelayMs: 0 });
    return "ok";
  } catch (e) {
    if (!isDocmakerError(e)) return "offline";
    switch (e.code) {
      case "YT_BOT_CHECK":
      case "YT_RATE_LIMIT":
        return "bot-check";
      case "YT_FORBIDDEN":
        return "403";
      case "TOOL_MISSING":
        return "missing";
      case "CANCELED":
        throw e;
      default:
        return "offline";
    }
  }
}

/** The 11-character id at the start of `s` (as yt-dlp matches it), null when `s` does not start with a well-formed id. */
function leadingId(s: string | null | undefined): string | null {
  const m = /^([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/.exec(s ?? "");
  return m ? m[1]! : null;
}

/** YouTube video id from a URL (watch?v=, youtu.be/, shorts/, embed/, live/, v/). Only ids matching YT_ID_RE are returned: the
 *  id becomes a file name in <home>/cache/yt, so a decoded `v=abc…/../../x` must never pass through. */
export function parseYoutubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
    if (h === "youtu.be") return leadingId(u.pathname.slice(1));
    if (h === "youtube.com" || h === "music.youtube.com") {
      const v = u.searchParams.get("v");
      if (v !== null) return leadingId(v);
      const m = /^\/(?:shorts|embed|live|v)\/(.*)$/.exec(u.pathname);
      return m ? leadingId(m[1]) : null;
    }
    return null;
  } catch { /* not a URL */ }
  return YT_ID_RE.test(url) ? url : null;
}
