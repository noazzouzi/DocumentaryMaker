// Render-integration harness: Remotion bundler/renderer (dependencies of @docmaker/render, loaded from there), the shared
// Chrome Headless Shell, a CORS + Range asset server, synthetic project media (ffmpeg) and PNG pixel probes.
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Timeline } from "@docmaker/core";

type Bundler = typeof import("@remotion/bundler");
type Renderer = typeof import("@remotion/renderer");

export function repoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) throw new Error("repo root (pnpm-workspace.yaml) not found");
    dir = up;
  }
}

export async function loadRemotion(): Promise<{ bundler: Bundler; renderer: Renderer }> {
  const req = createRequire(path.join(repoRoot(), "packages/render/package.json"));
  const load = async <T>(id: string): Promise<T> => (await import(pathToFileURL(req.resolve(id)).href)) as T;
  return { bundler: await load<Bundler>("@remotion/bundler"), renderer: await load<Renderer>("@remotion/renderer") };
}

export function browserExecutable(): string {
  const env = process.env.DOCMAKER_BROWSER_EXECUTABLE;
  if (env && existsSync(env)) return env;
  const shared = path.join(repoRoot(), "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell");
  if (existsSync(shared)) return shared;
  throw new Error("no Chrome Headless Shell: set DOCMAKER_BROWSER_EXECUTABLE (docs/DEV.md)");
}

export const chromiumOptions = { gl: "swangle" as const };

/**
 * Bit-exact renders need Chrome's CPU rasterizer: with GPU rasterization (SwiftShader), large glyphs (> ~160 px) and
 * some image/blend tiles vary by a few LSBs between tabs because the GPU process shares glyph/decode caches. Remotion
 * 4.0.532 exposes --disable-gpu-rasterization only through this reserved variable (open-browser.js; its only other
 * effect is an out-of-memory error message). Set before openBrowser().
 */
export function enableDeterministicRaster(): void {
  process.env.__RESERVED_IS_INSIDE_REMOTION_LAMBDA = "true";
}

export async function bundleEntry(bundler: Bundler, outDir: string): Promise<string> {
  return bundler.bundle({ entryPoint: path.join(repoRoot(), "packages/remotion/src/entry.ts"), outDir, enableCaching: false, onProgress: () => undefined });
}

function ffmpeg(args: string[]): void {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg ${args.join(" ")} failed: ${r.stderr}`);
}

const PALETTES = [["#4a1c40", "#e07a1f"], ["#123a5a", "#7fd1ff"], ["#2f4f1f", "#d8e36b"], ["#5a1414", "#ffb38a"], ["#1c1c3a", "#b48aff"]];

/** Writes synthetic media for every image/video asset of a timeline under `dir` (at each asset's projectRel). */
export async function writeProjectMedia(t: Timeline, dir: string): Promise<void> {
  let n = 0;
  for (const a of Object.values(t.assets).sort((x, y) => x.id.localeCompare(y.id))) {
    const out = path.join(dir, a.projectRel);
    await mkdir(path.dirname(out), { recursive: true });
    const [c0, c1] = PALETTES[n++ % PALETTES.length]!;
    const w = a.width ?? 1920;
    const h = a.height ?? 1080;
    if (a.kind === "image" || a.ext === "jpg" || a.ext === "png") {
      ffmpeg(["-f", "lavfi", "-i", `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}:n=2:speed=0.00001,format=yuv420p`, "-vf", `drawbox=x=${Math.round(w * 0.42)}:y=${Math.round(h * 0.3)}:w=${Math.round(w * 0.16)}:h=${Math.round(h * 0.3)}:color=white@0.85:t=fill`, "-frames:v", "1", "-q:v", "3", out]);
    } else if (a.ext === "mp4") {
      const fps = t.fps;
      const frames = a.durationFrames ?? fps * 10;
      ffmpeg(["-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=${fps}`, "-frames:v", String(frames), "-c:v", "libx264", "-preset", "ultrafast", "-crf", "32", "-pix_fmt", "yuv420p", "-g", String(fps), "-movflags", "+faststart", out]);
    } else if (a.ext === "wav") {
      ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "1", out]);
    }
  }
}

export interface AssetServer { url: string; close(): Promise<void> }

/** Read-only static server with CORS * and Range (what @remotion/media needs). Query strings (?v=) are ignored. */
export async function startAssetServer(root: string): Promise<AssetServer> {
  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "*");
    res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    const u = new URL(req.url ?? "/", "http://x");
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root) + path.sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    const size = statSync(file).size;
    const type = file.endsWith(".jpg") ? "image/jpeg" : file.endsWith(".png") ? "image/png" : file.endsWith(".mp4") ? "video/mp4" : file.endsWith(".wav") ? "audio/wav" : file.endsWith(".json") ? "application/json" : "application/octet-stream";
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", type);
    const range = req.headers.range ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range) : null;
    if (range) {
      const start = range[1] ? parseInt(range[1], 10) : Math.max(0, size - parseInt(range[2] || "0", 10));
      const end = range[1] && range[2] ? Math.min(size - 1, parseInt(range[2], 10)) : size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) });
      if (req.method === "HEAD") return void res.end();
      createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { "Content-Length": String(size) });
    if (req.method === "HEAD") return void res.end();
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

export async function makeTmp(prefix: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

export async function writeJson(file: string, v: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(v));
}

/** Decodes an image file to RGBA with ffmpeg. */
export function decodeRgba(file: string): { width: number; height: number; data: Buffer } {
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { encoding: "utf8" });
  const [w, h] = probe.stdout.trim().split(",").map((x) => parseInt(x, 10));
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !w || !h) throw new Error(`decode failed for ${file}: ${r.stderr?.toString()}`);
  return { width: w, height: h, data: r.stdout };
}

/** Stats of a rectangle of an RGBA image: opaque-pixel share and luma standard deviation. */
export function regionStats(img: { width: number; height: number; data: Buffer }, rect: { x: number; y: number; w: number; h: number }): { opaqueShare: number; lumaStd: number; meanLuma: number } {
  let n = 0;
  let opaque = 0;
  let sum = 0;
  let sum2 = 0;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(img.width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(img.height, Math.ceil(rect.y + rect.h));
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const o = (y * img.width + x) * 4;
      const a = img.data[o + 3]!;
      n++;
      if (a > 16) opaque++;
      const l = 0.2126 * img.data[o]! + 0.7152 * img.data[o + 1]! + 0.0722 * img.data[o + 2]!;
      sum += l;
      sum2 += l * l;
    }
  }
  const mean = n ? sum / n : 0;
  return { opaqueShare: n ? opaque / n : 0, lumaStd: n ? Math.sqrt(Math.max(0, sum2 / n - mean * mean)) : 0, meanLuma: mean };
}
