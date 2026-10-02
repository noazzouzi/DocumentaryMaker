// Local TTS models (§8.7): manifest + ensureModel (HTTP Range resume, size verification, sha256 when known,
// tar -xjf). Downloads through proxies were truncated twice in research: the size is always verified.
import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, mkdtemp, open, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RuntimeConfig } from "@docmaker/core";
import { DocmakerError } from "@docmaker/core";
import { run, withFileLock } from "@docmaker/core/node";
import { KOKORO_DIRNAME } from "./providers/sherpa";
import { PIPER_VOICES } from "./license";
import type { VoiceCtx } from "./types";

export interface ModelEntry { id: string; url: string; approxBytes: number; sha256: string | null; extractTo: string }

const RELEASES = "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models";
const PIPER_APPROX: Record<string, number> = { low: 30_000_000, medium: 67_000_000, high: 115_000_000 };
const KNOWN_SHA: Record<string, string> = {
  // verified downloads from the research phase (sizes 349 906 910 and 67 207 459 bytes)
  kokoro: "c5f7e2d2caf082bc1d20fb70334a61d99d20b484500aad32e7cf84c128ea3298",
  "piper:fr_FR-siwis-medium": "375909aa30842b3a4efa10b1beb1d761af792960ae6873b4d53889f96c66195b",
};

export const MODEL_MANIFEST: readonly ModelEntry[] = [
  { id: "kokoro", url: `${RELEASES}/${KOKORO_DIRNAME}.tar.bz2`, approxBytes: 349_906_910, sha256: KNOWN_SHA.kokoro!, extractTo: "kokoro" },
  ...PIPER_VOICES.map((v) => ({
    id: `piper:${v.id}`, url: `${RELEASES}/vits-piper-${v.id}.tar.bz2`,
    approxBytes: v.id === "fr_FR-siwis-medium" ? 67_207_459 : PIPER_APPROX[v.id.split("-").pop()!] ?? 67_000_000,
    sha256: KNOWN_SHA[`piper:${v.id}`] ?? null, extractTo: "piper",
  })),
];

/** Final directory of a model (what the sherpa provider loads). */
export function modelDirFor(entry: ModelEntry, modelsDir: string): string {
  if (entry.id === "kokoro") return path.join(modelsDir, "kokoro", KOKORO_DIRNAME);
  return path.join(modelsDir, entry.extractTo, entry.id.replace(/^piper:/, ""));
}

const COMPLETE = ".complete";

export interface DownloadOptions {
  signal: AbortSignal;
  offline: boolean;
  onProgress?: (bytes: number, total: number | null) => void;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
}

function totalFrom(res: Response, offset: number): number | null {
  const cr = res.headers.get("content-range");
  const m = cr ? /\/(\d+)\s*$/.exec(cr) : null;
  if (m) return Number(m[1]);
  const linked = res.headers.get("x-linked-size");
  if (linked && /^\d+$/.test(linked)) return Number(linked);
  const len = res.headers.get("content-length");
  if (len && /^\d+$/.test(len)) return Number(len) + (res.status === 206 ? offset : 0);
  return null;
}

/** Downloads url → dest with Range resume across attempts; verifies the final size (and sha256 when given). */
export async function downloadResumable(url: string, dest: string, o: DownloadOptions & { sha256?: string | null }): Promise<number> {
  if (o.offline) throw new DocmakerError("OFFLINE", `cannot download ${url} in offline mode`);
  const f = o.fetchImpl ?? fetch;
  await mkdir(path.dirname(dest), { recursive: true });
  let total: number | null = null;
  const attempts = o.maxAttempts ?? 6;
  for (let attempt = 1; ; attempt++) {
    const have = existsSync(dest) ? (await stat(dest)).size : 0;
    if (total !== null && have === total) break;
    if (total !== null && have > total) { await rm(dest, { force: true }); continue; }
    let res: Response;
    try {
      res = await f(url, { headers: have > 0 ? { Range: `bytes=${have}-` } : {}, signal: o.signal, redirect: "follow" });
    } catch (e) {
      if (o.signal.aborted) throw new DocmakerError("CANCELED", "download canceled");
      if (attempt >= attempts) throw new DocmakerError("PROVIDER_ERROR", `download failed: ${url}: ${e instanceof Error ? e.message : String(e)}`, { retryable: true, cause: e });
      continue;
    }
    if (res.status === 416 && have > 0) { total = have; break; }
    if (!res.ok) throw new DocmakerError("PROVIDER_ERROR", `download failed: HTTP ${res.status} for ${url}`, { retryable: res.status >= 500 });
    const append: boolean = res.status === 206 && have > 0;
    total = totalFrom(res, append ? have : 0) ?? total;
    const fh = await open(dest, append ? "a" : "w");
    let written: number = append ? have : 0;
    try {
      const reader = res.body?.getReader();
      if (!reader) throw new Error("empty body");
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        await fh.write(value);
        written += value.byteLength;
        o.onProgress?.(written, total);
      }
    } catch (e) {
      if (o.signal.aborted) throw new DocmakerError("CANCELED", "download canceled");
      if (attempt >= attempts) throw new DocmakerError("PROVIDER_ERROR", `download interrupted: ${url} (${written} bytes)`, { retryable: true, cause: e });
      continue; // resume with a Range request
    } finally {
      await fh.close();
    }
    if (total === null) { total = written; break; }
    if (written === total) break;
    if (attempt >= attempts) {
      throw new DocmakerError("PROVIDER_ERROR", `download truncated: ${url} (${written} of ${total} bytes)`, { retryable: true, hint: "retry `docmaker setup`; the download resumes where it stopped" });
    }
  }
  const size = (await stat(dest)).size;
  if (total !== null && size !== total) throw new DocmakerError("PROVIDER_ERROR", `size mismatch for ${url}: ${size} ≠ ${total}`);
  if (o.sha256) {
    const h = createHash("sha256");
    await new Promise<void>((resolve, reject) => createReadStream(dest).on("data", (c) => h.update(c)).on("end", () => resolve()).on("error", reject));
    const got = h.digest("hex");
    if (got !== o.sha256) {
      await rm(dest, { force: true });
      throw new DocmakerError("PROVIDER_ERROR", `checksum mismatch for ${path.basename(dest)}`, { details: { expected: o.sha256, got } });
    }
  }
  return size;
}

/** Downloads + extracts one manifest entry into modelsDir; idempotent (a `.complete` marker). Returns the model dir. */
export async function installModel(entry: ModelEntry, modelsDir: string, config: Pick<RuntimeConfig, "offline">, o: Omit<DownloadOptions, "offline">): Promise<string> {
  const finalDir = modelDirFor(entry, modelsDir);
  if (existsSync(path.join(finalDir, COMPLETE))) return finalDir;
  const archive = path.join(modelsDir, ".downloads", path.basename(new URL(entry.url).pathname));
  await downloadResumable(entry.url, archive, { ...o, offline: config.offline, sha256: entry.sha256 });
  const parent = path.join(modelsDir, entry.extractTo);
  await mkdir(parent, { recursive: true });
  const tmp = await mkdtemp(path.join(parent, ".extract-"));
  try {
    const r = await run("tar", ["-xjf", archive, "-C", tmp], { signal: o.signal });
    if (r.code !== 0) throw new DocmakerError("PROVIDER_ERROR", `could not extract ${path.basename(archive)}: ${r.stderr.slice(-400)}`);
    const top = (await readdir(tmp)).filter((x) => !x.startsWith("."));
    const src = top.length === 1 ? path.join(tmp, top[0]!) : tmp;
    await rm(finalDir, { recursive: true, force: true });
    await rename(src, finalDir);
    await writeFile(path.join(finalDir, COMPLETE), `${new Date().toISOString()}\n${entry.url}\n`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  await rm(archive, { force: true });
  return finalDir;
}

export async function ensureModel(id: string, ctx: VoiceCtx): Promise<string> {
  const entry = MODEL_MANIFEST.find((m) => m.id === id || m.id === `piper:${id}`);
  if (!entry) throw new DocmakerError("VALIDATION", `unknown model "${id}"`, { hint: `known: ${MODEL_MANIFEST.map((m) => m.id).join(", ")}` });
  const dir = modelDirFor(entry, ctx.config.paths.models);
  if (existsSync(path.join(dir, COMPLETE))) return dir;
  const lock = path.join(ctx.config.paths.locks, `model-${entry.id.replace(/[^a-zA-Z0-9_.-]/g, "_")}.lock`);
  return withFileLock(lock, `ensureModel ${entry.id}`, () => installModel(entry, ctx.config.paths.models, ctx.config, {
    signal: ctx.signal,
    onProgress: (b, t) => ctx.progress(t ? Math.min(0.99, b / t) : 0, `downloading ${entry.id}`, { bytes: b, total: t }),
  }), { signal: ctx.signal });
}
