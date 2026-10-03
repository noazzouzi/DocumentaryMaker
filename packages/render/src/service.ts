// RenderService (§12.3–§12.6): one render per machine (render lock + free-memory wait), bundle once per code hash,
// Chrome reused for every chunk, chapter-aligned muted h264-ts chunks cached by chunk-relative slice hash, frame-exact
// concat, master post (lut3d + grain), one AAC master mux with the exact length, post-AAC true-peak gate, render.json.
// Inputs are bound to what was hashed: the timeline bytes are read once and served from memory at a content-addressed
// URL (the snapshot on disk may be rewritten by a later render job while this one waits or renders), and the mix is
// pinned (hardlink, else copy) before the slot wait, so chunk hashes, pixels and the muxed audio always agree.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, link, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  canonicalJson, DocmakerError, docHash, GeneratedStillsRequest, isDocmakerError, OverlayRenderRequest, P, RenderDoc, RenderRequest,
  sha12, stableStringify, StillsRequest, Timeline, type GlProbe, type JobEventInput, type Lang, type Logger, type RenderChunk,
  type RenderClient, type RenderHandlers, type RenderResult, type RuntimeConfig,
} from "@docmaker/core";
import { sha256File, withFileLock } from "@docmaker/core/node";
import { computeTimeline, planChunks, sliceHash } from "@docmaker/remotion/compute";
import { createAssetServer, resolveRequestPath, type AssetServer } from "./assetServer";
import { ensureBrowserExecutable } from "./browser";
import { computeCodeHash, ensureBundleBuilt, isBundleReady, bundleDir } from "./bundle";
import { closeChrome, openChrome } from "./chrome";
import { concatChunks } from "./concat";
import { readGlProbe, runGlProbe } from "./gl";
import { loudnessGate } from "./loudnessGate";
import { cachedLutCube } from "./lut";
import { muxMaster } from "./mux";
import { masterPost } from "./post";
import { chunkHashPreset, commonRemotionOptions, PRESETS, presetRenderOptions, resolveConcurrency, type GlMode } from "./presets";
import { ProgressTracker } from "./progress";
import { COMPOSITIONS, loadRenderer, type BrowserLog, type HeadlessBrowser } from "./remotion";
import { buildContactSheets, frameLabel } from "./sheets";

export interface RenderServiceOptions { config: RuntimeConfig; logger: Logger; enableBundleCache?: boolean /* tests: false */ }

/** Layers of a full render (§12.3: all true except audio — the mix is muxed by ffmpeg). */
export const RENDER_LAYERS = { picture: true, graphics: true, captions: true, hud: true, covers: true, audio: false } as const;
/** Layers of an overlay-only render (ProRes 4444 overlays, M3). */
export const OVERLAY_LAYERS = { picture: false, graphics: true, captions: false, hud: true, covers: false, audio: false } as const;
export const MEMORY_FREE_MIN = 0.15;
const MEMORY_WAIT_MAX_MS = 10 * 60_000;
const DEFAULT_TARGET_LUFS = -14;
const DEFAULT_GATE_DBTP = -1;
const MAX_LOG_EVENTS = 40;

/** Allowlist of the render asset server (§12.3) + the exact timeline path when it lives elsewhere. */
export function renderAllowList(timelineRel?: string): RegExp[] {
  const allow = [/^media\//, /^program\//, /^voice\//, /^render\/[a-z]+\/[a-z]+\/snapshot\//];
  if (timelineRel) allow.push(new RegExp(`^${timelineRel.replace(/^\/+/, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  return allow;
}

/** planChunks ∩ frameRange (inclusive bounds). */
export function chunksInRange(chunks: readonly { from: number; to: number }[], range: readonly [number, number] | null): { index: number; from: number; to: number }[] {
  const out: { index: number; from: number; to: number }[] = [];
  for (const c of chunks) {
    const from = range ? Math.max(c.from, range[0]) : c.from;
    const to = range ? Math.min(c.to, range[1]) : c.to;
    if (to >= from) out.push({ index: out.length, from, to });
  }
  return out;
}

const toDocErr = (e: unknown, code: "RENDER_FAILED" | "INTERNAL", msg: string): DocmakerError =>
  isDocmakerError(e) ? e : new DocmakerError(code, `${msg}: ${e instanceof Error ? e.message : String(e)}`, { cause: e, retryable: true });

export async function readTimelineFile(projectDir: string, rel: string): Promise<Timeline> {
  return (await readTimelineSnapshot(projectDir, rel)).timeline;
}

/** A timeline bound to its bytes: parsed once, hashed, and served by the asset server from memory at `urlPath`. */
export interface TimelineSnapshot { timeline: Timeline; bytes: Buffer; sha256: string; urlPath: string }
const TORN_READ_ATTEMPTS = 3;
const TORN_READ_DELAY_MS = 150;

/**
 * Reads a timeline once. Unparsable JSON is re-read a few times (a snapshot being rewritten in place reads torn:
 * copyFile truncates first) before it is reported. The URL path is content-addressed, so a page can only ever fetch
 * the exact bytes the caller hashed.
 */
export async function readTimelineSnapshot(projectDir: string, rel: string): Promise<TimelineSnapshot> {
  const abs = path.join(projectDir, rel);
  for (let attempt = 1; ; attempt++) {
    let bytes: Buffer;
    try {
      bytes = await readFile(abs);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new DocmakerError("UPSTREAM_MISSING", `missing ${abs}`);
      throw new DocmakerError("VALIDATION", `unreadable timeline ${abs}: ${e instanceof Error ? e.message : String(e)}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch (e) {
      if (attempt < TORN_READ_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, TORN_READ_DELAY_MS));
        continue;
      }
      throw new DocmakerError("VALIDATION", `unreadable JSON ${abs}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const p = Timeline.safeParse(raw);
    if (!p.success) throw new DocmakerError("VALIDATION", `${rel} is not a valid timeline: ${p.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { timeline: p.data, bytes, sha256, urlPath: `_snapshot/timeline-${sha256.slice(0, 16)}.json` };
  }
}

/**
 * Digest of the bytes of every style font the timeline references by a server-relative URL (user-style fonts are
 * served by path: a file replaced under the same name changes nothing in the timeline). "" when there are none.
 */
export async function styleFontsDigest(t: Timeline, projectDir: string, stylesDir: string): Promise<string> {
  const rows: [string, string][] = [];
  for (const f of t.render.fonts) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(f.url)) continue; // absolute URL: not served by us, nothing to hash
    const r = resolveRequestPath(f.url, { root: projectDir, allow: renderAllowList(), mounts: { styles: stylesDir } });
    rows.push([f.url, r.kind === "file" ? await sha256File(r.file).catch(() => "missing") : "unresolved"]);
  }
  return rows.length ? sha12(canonicalJson(rows)) : "";
}

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * Pins a file for the duration of one render: a hardlink (else a copy) under a job-private name. The snapshot mix is
 * replaced by unlink + link when another render job snapshots, so the pinned inode keeps this job's exact audio.
 */
export async function pinFile(src: string, dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  for (const f of await readdir(dir).catch(() => [] as string[])) {
    const m = /^pin-(\d+)-/.exec(f);
    if (m && Number(m[1]) !== process.pid && !pidAlive(Number(m[1]))) await rm(path.join(dir, f), { force: true });
  }
  const dest = path.join(dir, `pin-${process.pid}-${randomUUID().slice(0, 8)}${path.extname(src)}`);
  try {
    await link(src, dest);
  } catch {
    await copyFile(src, dest);
  }
  return dest;
}

/** Removes a pin, and its directory once no other job holds one (nothing is left behind in render/<lang>/<preset>/). */
export async function unpinFile(pinned: string): Promise<void> {
  await rm(pinned, { force: true });
  await rmdir(path.dirname(pinned)).catch(() => undefined); // ENOTEMPTY: another job's pin
}

/** Mix targets from project.json (`audio.targetLufs`, `audio.truePeakGate`), else the spec defaults (−14 LUFS, −1 dBTP). */
async function audioTargets(projectDir: string): Promise<{ targetLufs: number; gateDbtp: number }> {
  try {
    const j = JSON.parse(await readFile(path.join(projectDir, P.project), "utf8")) as { audio?: { targetLufs?: unknown; truePeakGate?: unknown } };
    const t = j.audio?.targetLufs;
    const g = j.audio?.truePeakGate;
    return { targetLufs: typeof t === "number" && Number.isFinite(t) ? t : DEFAULT_TARGET_LUFS, gateDbtp: typeof g === "number" && Number.isFinite(g) ? g : DEFAULT_GATE_DBTP };
  } catch {
    return { targetLufs: DEFAULT_TARGET_LUFS, gateDbtp: DEFAULT_GATE_DBTP };
  }
}

const safeName = (id: string): string => id.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "_").slice(0, 120);

function abortError(what: string): DocmakerError {
  return new DocmakerError("CANCELED", `${what} canceled`);
}

/** Content address of a generated/solid still (v2: + renderer code hash, GL backend and style font bytes). */
export function generatedStillKey(source: unknown, tokens: unknown, ctx: { codeHash: string; gl: GlMode; fonts: string }): string {
  return sha12(canonicalJson({ v: 2, codeHash: ctx.codeHash, gl: ctx.gl, fonts: ctx.fonts, source, tokens }));
}

export class RenderService {
  readonly config: RuntimeConfig;
  readonly logger: Logger;
  readonly enableBundleCache: boolean;
  private readonly lockHeld = new AsyncLocalStorage<boolean>();
  private readonly live = new Set<{ close(): Promise<void> }>();
  private closed = false;

  constructor(o: RenderServiceOptions) {
    this.config = o.config;
    this.logger = o.logger.child({ pkg: "render" });
    this.enableBundleCache = o.enableBundleCache ?? true;
  }

  // ------------------------------------------------------------------ infrastructure
  private assertOpen(): void {
    if (this.closed) throw new DocmakerError("INTERNAL", "RenderService is closed");
  }

  /** Machine-wide render slot (re-entrant within this service's async context) + free-memory wait. */
  private async withRenderSlot<T>(owner: string, signal: AbortSignal, onWait: (what: "render-slot" | "memory") => void, fn: () => Promise<T>): Promise<T> {
    if (this.lockHeld.getStore()) return fn();
    return withFileLock(this.config.renderLockFile, `render:${owner}:${process.pid}`, async () => {
      await this.waitForMemory(signal, () => onWait("memory"));
      return this.lockHeld.run(true, fn);
    }, { signal, onWait: () => onWait("render-slot") });
  }

  private async waitForMemory(signal: AbortSignal, onWait: () => void): Promise<void> {
    const t0 = Date.now();
    let warned = false;
    while (os.freemem() / os.totalmem() < MEMORY_FREE_MIN) {
      if (signal.aborted) throw abortError("render");
      if (Date.now() - t0 > MEMORY_WAIT_MAX_MS) {
        this.logger.warn("free memory still below 15 % after 10 min; rendering anyway");
        return;
      }
      if (!warned) {
        warned = true;
        onWait();
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  private track<T extends { close(): Promise<void> }>(x: T): T {
    this.live.add(x);
    return x;
  }
  private async release(x: { close(): Promise<void> } | null | undefined): Promise<void> {
    if (!x) return;
    this.live.delete(x);
    await x.close().catch(() => undefined);
  }
  private readonly browsers = new Map<HeadlessBrowser, { close(): Promise<void> }>();
  private async browser(exe: string, gl: GlMode): Promise<HeadlessBrowser> {
    const b = await openChrome(exe, gl, { cpuRaster: gl === "swangle" });
    const handle = { close: () => closeChrome(b) };
    this.browsers.set(b, handle);
    this.live.add(handle);
    return b;
  }
  private async closeBrowser(b: HeadlessBrowser | null): Promise<void> {
    if (!b) return;
    const handle = this.browsers.get(b);
    this.browsers.delete(b);
    if (handle) this.live.delete(handle);
    await closeChrome(b);
  }
  /** Asset server of a render; the timeline is served from the snapshot's bytes only (content-addressed path). */
  private async server(projectDir: string, snap: TimelineSnapshot): Promise<AssetServer> {
    return this.track(await createAssetServer({
      root: projectDir, allow: renderAllowList(), mounts: { styles: this.config.paths.styles }, memory: { [snap.urlPath]: snap.bytes },
    }));
  }

  private logEmitter(emit: (e: JobEventInput) => void) {
    let n = 0;
    const seen = new Set<string>();
    return (l: BrowserLog) => {
      const relevant = l.type === "error" || l.type === "warning" || /fallback|cors|failed to load|media|\[docmaker\]|\[fonts\]/i.test(l.text);
      if (!relevant || seen.has(l.text) || n >= MAX_LOG_EVENTS) return;
      seen.add(l.text);
      n++;
      emit({ type: "log", level: l.type === "error" ? "error" : "warn", message: `browser: ${l.text.slice(0, 500)}`, stage: "render" });
    };
  }

  private async gl(requested: "auto" | GlMode, signal: AbortSignal, probeIfMissing: boolean): Promise<{ gl: GlMode; gpu: boolean }> {
    if (requested === "auto") {
      const probe = probeIfMissing ? await this.probeGlLocked(false, signal) : await readGlProbe(this.config);
      return probe ? { gl: probe.chosen, gpu: probe.gpu } : { gl: "swangle", gpu: false };
    }
    const cached = await readGlProbe(this.config);
    return { gl: requested, gpu: !!cached && cached.gpu && cached.chosen === requested };
  }

  private async bundleLocked(signal: AbortSignal, onProgress?: (pct: number) => void): Promise<{ serveUrl: string; codeHash: string }> {
    const r = await ensureBundleBuilt({ config: this.config, logger: this.logger, enableCaching: this.enableBundleCache, signal, onProgress });
    return { serveUrl: r.serveUrl, codeHash: r.codeHash };
  }

  // ------------------------------------------------------------------ public API
  /** codeHash = sha256(sorted path+sha of packages/remotion/src/**, packages/core/src/** + pinned remotion/@fontsource versions). */
  async ensureBundle(signal: AbortSignal): Promise<{ serveUrl: string; codeHash: string }> {
    this.assertOpen();
    const codeHash = await computeCodeHash(this.config.repoRoot);
    if (isBundleReady(this.config, codeHash)) return { serveUrl: bundleDir(this.config, codeHash), codeHash };
    return this.withRenderSlot("bundle", signal, () => this.logger.info("waiting for the render slot (bundle)"), () => this.bundleLocked(signal));
  }

  async render(reqIn: RenderRequest, h: RenderHandlers): Promise<RenderResult> {
    this.assertOpen();
    const parsed = RenderRequest.safeParse(reqIn);
    if (!parsed.success) throw new DocmakerError("VALIDATION", `invalid RenderRequest: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    const req = parsed.data;
    const t0 = Date.now();
    const { config } = this;
    const signal = h.signal;
    const lang: Lang = req.lang;
    const preset = PRESETS[req.preset];
    const emit = (e: JobEventInput) => {
      try {
        h.onEvent(e);
      } catch (err) {
        this.logger.warn("render event handler threw", { err: String(err) });
      }
    };

    // read once: the chunk hashes AND the pages' timeline (served from these bytes) come from this one snapshot
    const snap = await readTimelineSnapshot(req.projectDir, req.timelineRel);
    const timeline = snap.timeline;
    const ct = computeTimeline(timeline);
    const N = ct.durationInFrames;
    const fps = timeline.fps;
    if (req.frameRange) {
      const [a, b] = req.frameRange;
      if (a < 0 || b < a || b >= N) throw new DocmakerError("VALIDATION", `frameRange [${a}, ${b}] outside [0, ${N - 1}]`);
    }
    const mixSrc = req.mixRel ? path.join(req.projectDir, req.mixRel) : null;
    if (mixSrc && !existsSync(mixSrc)) throw new DocmakerError("UPSTREAM_MISSING", `mix not found: ${req.mixRel}`);
    const lutCube = preset.post ? req.lutCube ?? (timeline.grade.lut ? await cachedLutCube(config, timeline.grade.lut) : null) : null;
    if (lutCube && !existsSync(lutCube)) throw new DocmakerError("UPSTREAM_MISSING", `LUT not found: ${lutCube}`);
    const grain = preset.post ? req.grain : 0;
    const doPost = preset.post && (lutCube !== null || grain > 0);
    const progress = new ProgressTracker(emit, lang, doPost ? [] : ["post"]);
    const targets = await audioTargets(req.projectDir);
    const renderDir = path.join(req.projectDir, P.renderDir(lang, req.preset));
    const chunkDir = path.join(renderDir, "chunks");
    const outAbs = path.join(req.projectDir, req.outRel);
    // pinned before the slot wait: a later render job of this lang/preset re-links the snapshot mix meanwhile
    const mixAbs = mixSrc ? await pinFile(mixSrc, path.join(renderDir, "pins")) : null;
    try {
      return await this.withRenderSlot(`${req.slug}:${lang}:${req.preset}`, signal, (what) => {
        progress.update("bundle", 0, what === "memory" ? "waiting for free memory" : "waiting for the render slot", { waiting: what }, true);
      }, async () => {
        if (signal.aborted) throw abortError("render");
        const { gl, gpu } = await this.gl(req.gl, signal, true);
        progress.update("bundle", 0, "bundling", {}, true);
        const { serveUrl, codeHash } = await this.bundleLocked(signal, (p) => progress.update("bundle", p, "bundling"));
        progress.update("bundle", 1, "bundle ready", { codeHash: codeHash.slice(0, 12) }, true);
        const exe = await ensureBrowserExecutable(config, { download: false, signal });
        await mkdir(chunkDir, { recursive: true });
        await mkdir(path.dirname(outAbs), { recursive: true });
        await this.removeStaleTemps(chunkDir);

        const server = await this.server(req.projectDir, snap);
        let browser: HeadlessBrowser | null = null;
        const intermediates: string[] = [];
        try {
          browser = await this.browser(exe, gl);
          const r = await loadRenderer();
          const common = commonRemotionOptions(exe, gl, config);
          const inputProps = {
            timeline: null, timelineUrl: `${server.url}/${snap.urlPath}`, assetBaseUrl: server.url, mode: "render",
            layers: { ...RENDER_LAYERS }, itemId: null, scratchBanner: false,
          };
          const onBrowserLog = this.logEmitter(emit);
          const composition = await r.selectComposition({ ...common, serveUrl, id: COMPOSITIONS.doc, inputProps, puppeteerInstance: browser, onBrowserLog });
          if (composition.durationInFrames !== N || composition.fps !== fps) {
            throw new DocmakerError("RENDER_FAILED", `composition metadata (${composition.durationInFrames} f @ ${composition.fps}) differs from computeTimeline (${N} f @ ${fps})`);
          }
          const planned = chunksInRange(planChunks(ct, req.chunkSeconds * fps), req.frameRange);
          const total = planned.reduce((s, c) => s + (c.to - c.from + 1), 0);
          const concurrency = resolveConcurrency(req.concurrency);
          const renderOpts = presetRenderOptions(req.preset, { gpu });
          const hashPreset = chunkHashPreset(req.preset, { gl, encoder: renderOpts, fonts: await styleFontsDigest(timeline, req.projectDir, config.paths.styles) });

          // ---- chunks
          const chunks: RenderChunk[] = [];
          let doneUnits = 0; // Σ rendered + encoded frames of finished chunks
          const tChunks = Date.now();
          let renderedSoFar = 0;
          for (const c of planned) {
            if (signal.aborted) throw abortError("render");
            const frames = c.to - c.from + 1;
            const hash = sliceHash(timeline, c.from, c.to, { codeHash, preset: hashPreset, premount: fps });
            const file = path.join(req.projectDir, P.renderChunk(lang, req.preset, hash));
            const tc = Date.now();
            const label = `chunk ${c.index + 1}/${planned.length}`;
            if (existsSync(file) && (await stat(file)).size > 0) {
              chunks.push({ index: c.index, from: c.from, to: c.to, file: path.relative(req.projectDir, file), hash, cached: true, ms: 0 });
              doneUnits += 2 * frames;
              renderedSoFar += frames;
              progress.update("chunks", doneUnits / (2 * total), `${label} (cached)`, { chunk: c.index, cached: true, renderedFrames: renderedSoFar, encodedFrames: renderedSoFar });
              continue;
            }
            const tmp = file.replace(/\.ts$/, ".tmp.ts");
            let lastErr: unknown = null;
            for (let attempt = 1; attempt <= 2; attempt++) {
              const { cancelSignal, cancel } = r.makeCancelSignal();
              const onAbort = () => cancel();
              signal.addEventListener("abort", onAbort, { once: true });
              try {
                const res = await r.renderMedia({
                  ...common, ...renderOpts, composition, serveUrl, inputProps, frameRange: [c.from, c.to], outputLocation: tmp, overwrite: true,
                  concurrency, puppeteerInstance: browser, cancelSignal, onBrowserLog,
                  onProgress: (p) => {
                    const units = doneUnits + p.renderedFrames + p.encodedFrames;
                    const elapsed = (Date.now() - tChunks) / 1000;
                    const rendered = renderedSoFar + p.renderedFrames;
                    const rate = elapsed > 0 ? rendered / elapsed : 0;
                    progress.update("chunks", units / (2 * total), label, {
                      chunk: c.index, renderedFrames: rendered, encodedFrames: renderedSoFar + p.encodedFrames,
                      fps: Math.round(rate * 10) / 10, etaSec: rate > 0 ? Math.round((total - rendered) / rate) : null,
                    });
                  },
                });
                await rename(tmp, file);
                const slow = res.slowestFrames.slice(0, 3).map((s) => `${s.frame}:${Math.round(s.time)}ms`).join(", ");
                this.logger.debug("chunk rendered", { chunk: c.index, from: c.from, to: c.to, ms: Date.now() - tc, slowestFrames: slow });
                lastErr = null;
                break;
              } catch (e) {
                await rm(tmp, { force: true });
                if (signal.aborted) throw abortError("render");
                lastErr = e;
                this.logger.warn("chunk render failed", { chunk: c.index, attempt, err: e instanceof Error ? e.message : String(e) });
                if (attempt < 2) {
                  // the likeliest transient failure on a long master is a crashed/disconnected Chrome: retry on a fresh one
                  await this.closeBrowser(browser).catch(() => undefined);
                  browser = null;
                  browser = await this.browser(exe, gl);
                }
              } finally {
                signal.removeEventListener("abort", onAbort);
              }
            }
            if (lastErr) throw toDocErr(lastErr, "RENDER_FAILED", `chunk ${c.index} (frames ${c.from}–${c.to}) failed`);
            chunks.push({ index: c.index, from: c.from, to: c.to, file: path.relative(req.projectDir, file), hash, cached: false, ms: Date.now() - tc });
            doneUnits += 2 * frames;
            renderedSoFar += frames;
            progress.update("chunks", doneUnits / (2 * total), label, { chunk: c.index, renderedFrames: renderedSoFar, encodedFrames: renderedSoFar }, true);
          }
          await this.closeBrowser(browser);
          browser = null;
          await this.release(server);

          // ---- concat
          if (signal.aborted) throw abortError("render");
          const videoMp4 = path.join(renderDir, "video.mp4");
          intermediates.push(videoMp4);
          progress.update("concat", 0, "concatenating chunks", {}, true);
          const cat = await concatChunks(chunks.map((c) => path.join(req.projectDir, c.file)), videoMp4, {
            config, signal, logger: this.logger, expectedFrames: total, fps,
            x264Preset: PRESETS[req.preset].x264Preset ?? "medium", crf: PRESETS[req.preset].crf ?? 18,
            onProgress: (p) => progress.update("concat", p, "concatenating chunks"),
          });
          if (cat.reencoded) emit({ type: "log", level: "warn", message: "chunk concat was re-encoded (stream copy was not frame-exact)", stage: "render" });
          progress.update("concat", 1, "concatenated", { frames: cat.frames }, true);

          // ---- master post
          let video = videoMp4;
          if (doPost) {
            const postMp4 = path.join(renderDir, "video.post.mp4");
            intermediates.push(postMp4);
            progress.update("post", 0, "master post (grade + grain)", {}, true);
            await masterPost(videoMp4, postMp4, {
              lutCube, grain, config, signal, totalMs: (total / fps) * 1000,
              onProgress: (p) => progress.update("post", p, "master post (grade + grain)"),
            });
            video = postMp4;
            progress.update("post", 1, "master post done", {}, true);
          }

          // ---- mux + gate
          progress.update("mux", 0, "muxing the master audio", {}, true);
          const startFrame = req.frameRange ? req.frameRange[0] : 0;
          await muxMaster(video, mixAbs, outAbs, { frames: total, fps, startFrame, config, signal, onProgress: (p) => progress.update("mux", p * 0.6, "muxing the master audio") });
          let loudness: RenderResult["loudness"] = null;
          if (mixAbs) {
            progress.update("mux", 0.6, "true-peak gate", {}, true);
            const g = await loudnessGate(outAbs, { gateDbtp: targets.gateDbtp, targetLufs: targets.targetLufs, config, signal, durationSec: total / fps });
            loudness = { integratedLufs: g.integratedLufs, truePeakDbtp: g.truePeakDbtp, gateAttempts: g.attempts };
            if (!g.ok) {
              emit({ type: "log", level: "warn", message: `LOUDNESS_GATE: ${g.integratedLufs.toFixed(1)} LUFS / ${g.truePeakDbtp.toFixed(1)} dBTP after ${g.attempts} attempt(s) (target ${targets.targetLufs} LUFS, gate ${targets.gateDbtp} dBTP)`, stage: "render" });
            }
          }
          for (const f of intermediates) await rm(f, { force: true });
          // only a whole-programme render prunes: a frame range or an onlyChapters preview must not evict the full render's chunks
          if (!req.frameRange && timeline.onlyChapters === null) await this.pruneChunks(chunkDir, new Set(chunks.map((c) => path.basename(c.file))));

          const result: RenderResult = {
            outFile: req.outRel, durationInFrames: N, frames: total, chunks, renderMs: Date.now() - t0, gl, codeHash, loudness,
          };
          const doc = RenderDoc.parse({
            ...result, schemaVersion: 1, lang, preset: req.preset, timelineHash: docHash(timeline),
            mixHash: mixAbs ? await sha256File(mixAbs) : null, onlyChapters: timeline.onlyChapters, createdAt: new Date().toISOString(),
          });
          const docAbs = path.join(req.projectDir, P.renderDoc(lang, req.preset));
          await mkdir(path.dirname(docAbs), { recursive: true });
          await writeFile(`${docAbs}.tmp`, stableStringify(doc));
          await rename(`${docAbs}.tmp`, docAbs);
          progress.update("mux", 1, "render done", { frames: total, ms: result.renderMs }, true);
          emit({ type: "artifact", stage: "render", lang, path: req.outRel, kind: "video" });
          emit({ type: "artifact", stage: "render", lang, path: P.renderDoc(lang, req.preset), kind: "render-doc" });
          return result;
        } catch (e) {
          for (const f of intermediates) await rm(f, { force: true });
          if (signal.aborted) throw abortError("render");
          throw toDocErr(e, "RENDER_FAILED", "render failed");
        } finally {
          await this.closeBrowser(browser);
          await this.release(server);
        }
      });
    } finally {
      if (mixAbs) await unpinFile(mixAbs);
    }
  }

  private async removeStaleTemps(dir: string): Promise<void> {
    for (const f of await readdir(dir).catch(() => [] as string[])) if (/\.tmp\.ts$/.test(f)) await rm(path.join(dir, f), { force: true });
  }

  /** After a full render, cached chunks that no longer belong to the timeline are deleted. */
  private async pruneChunks(dir: string, keep: Set<string>): Promise<void> {
    for (const f of await readdir(dir).catch(() => [] as string[])) {
      if (/^[0-9a-f]+\.ts$/.test(f) && !keep.has(f)) await rm(path.join(dir, f), { force: true });
    }
  }

  async renderStills(reqIn: StillsRequest, h: RenderHandlers): Promise<string[]> {
    this.assertOpen();
    const req = StillsRequest.parse(reqIn);
    const snap = await readTimelineSnapshot(req.projectDir, req.timelineRel);
    const timeline = snap.timeline;
    const N = computeTimeline(timeline).durationInFrames;
    const bad = req.frames.filter((f) => f < 0 || f >= N);
    if (bad.length) throw new DocmakerError("VALIDATION", `still frames outside [0, ${N - 1}]: ${bad.slice(0, 5).join(", ")}`);
    const frames = [...new Set(req.frames)];
    if (frames.length === 0) return [];
    await mkdir(req.outDir, { recursive: true });
    const emit = h.onEvent.bind(h);
    return this.withRenderSlot("stills", h.signal, () => this.logger.info("waiting for the render slot (stills)"), async () => {
      const { gl } = await this.gl("auto", h.signal, false);
      const { serveUrl } = await this.bundleLocked(h.signal);
      const exe = await ensureBrowserExecutable(this.config, { download: false, signal: h.signal });
      const server = await this.server(req.projectDir, snap);
      let browser: HeadlessBrowser | null = null;
      try {
        browser = await this.browser(exe, gl);
        const r = await loadRenderer();
        const common = commonRemotionOptions(exe, gl, this.config);
        const inputProps = {
          timeline: null, timelineUrl: `${server.url}/${snap.urlPath}`, assetBaseUrl: server.url, mode: "render",
          layers: { ...RENDER_LAYERS }, itemId: null, scratchBanner: false,
        };
        const onBrowserLog = this.logEmitter(emit);
        const composition = await r.selectComposition({ ...common, serveUrl, id: COMPOSITIONS.doc, inputProps, puppeteerInstance: browser, onBrowserLog });
        const files: string[] = [];
        for (const [i, frame] of frames.entries()) {
          if (h.signal.aborted) throw abortError("stills");
          const out = path.join(req.outDir, `frame-${String(frame).padStart(6, "0")}.jpg`);
          const { cancelSignal, cancel } = r.makeCancelSignal();
          const onAbort = () => cancel();
          h.signal.addEventListener("abort", onAbort, { once: true });
          try {
            await r.renderStill({
              ...common, composition, serveUrl, inputProps, frame, output: out, overwrite: true, imageFormat: "jpeg", jpegQuality: 90,
              scale: req.scale, puppeteerInstance: browser, cancelSignal, onBrowserLog,
            });
          } catch (e) {
            if (h.signal.aborted) throw abortError("stills");
            throw toDocErr(e, "RENDER_FAILED", `still ${frame} failed`);
          } finally {
            h.signal.removeEventListener("abort", onAbort);
          }
          files.push(out);
          emit({ type: "progress", stage: "qa", lang: timeline.lang, pct: (i + 1) / (frames.length + (req.sheet ? 1 : 0)), message: `still ${i + 1}/${frames.length}`, detail: { frame } });
        }
        if (!req.sheet) return files;
        const sheets = await buildContactSheets(
          files.map((file, i) => ({ file, label: req.sheet!.label ? frameLabel(frames[i]!, timeline.fps) : null })),
          { cols: req.sheet.cols, width: req.sheet.width, outDir: req.outDir },
        );
        return [...files, ...sheets];
      } finally {
        await this.closeBrowser(browser);
        await this.release(server);
      }
    });
  }

  async renderOverlays(reqIn: OverlayRenderRequest, h: RenderHandlers): Promise<{ itemId: string; file: string }[]> {
    this.assertOpen();
    const req = OverlayRenderRequest.parse(reqIn);
    const snap = await readTimelineSnapshot(req.projectDir, req.timelineRel);
    const timeline = snap.timeline;
    const byId = new Map(timeline.overlays.map((o) => [o.id, o]));
    const ids = [...new Set(req.itemIds)].filter((id) => {
      if (byId.has(id)) return true;
      h.onEvent({ type: "log", level: "warn", message: `overlay ${id} not in the timeline; skipped`, stage: "export" });
      return false;
    });
    if (ids.length === 0) return [];
    await mkdir(req.outDir, { recursive: true });
    return this.withRenderSlot("overlays", h.signal, () => this.logger.info("waiting for the render slot (overlays)"), async () => {
      const { gl } = await this.gl("auto", h.signal, false);
      const { serveUrl } = await this.bundleLocked(h.signal);
      const exe = await ensureBrowserExecutable(this.config, { download: false, signal: h.signal });
      const server = await this.server(req.projectDir, snap);
      let browser: HeadlessBrowser | null = null;
      try {
        browser = await this.browser(exe, gl);
        const r = await loadRenderer();
        const common = commonRemotionOptions(exe, gl, this.config);
        const onBrowserLog = this.logEmitter(h.onEvent.bind(h));
        const out: { itemId: string; file: string }[] = [];
        for (const [i, itemId] of ids.entries()) {
          if (h.signal.aborted) throw abortError("overlays");
          const inputProps = {
            timeline: null, timelineUrl: `${server.url}/${snap.urlPath}`, assetBaseUrl: server.url, mode: "render",
            layers: { ...OVERLAY_LAYERS }, itemId, scratchBanner: false,
          };
          const composition = await r.selectComposition({ ...common, serveUrl, id: COMPOSITIONS.item, inputProps, puppeteerInstance: browser, onBrowserLog });
          // ids that sanitise to the same name (e.g. "a/b" and "a_b") get a short hash of the raw id
          const clash = ids.some((other) => other !== itemId && safeName(other) === safeName(itemId));
          const file = path.join(req.outDir, `${safeName(itemId)}${clash ? `-${sha12(itemId).slice(0, 6)}` : ""}.mov`);
          const tmp = file.replace(/\.mov$/, ".tmp.mov");
          const { cancelSignal, cancel } = r.makeCancelSignal();
          const onAbort = () => cancel();
          h.signal.addEventListener("abort", onAbort, { once: true });
          try {
            await r.renderMedia({
              ...common, ...presetRenderOptions("overlay", { gpu: false }), composition, serveUrl, inputProps, outputLocation: tmp, overwrite: true,
              concurrency: resolveConcurrency(null), puppeteerInstance: browser, cancelSignal, onBrowserLog,
            });
            await rename(tmp, file);
          } catch (e) {
            await rm(tmp, { force: true });
            if (h.signal.aborted) throw abortError("overlays");
            throw toDocErr(e, "RENDER_FAILED", `overlay ${itemId} failed`);
          } finally {
            h.signal.removeEventListener("abort", onAbort);
          }
          out.push({ itemId, file });
          h.onEvent({ type: "progress", stage: "export", lang: timeline.lang, pct: (i + 1) / ids.length, message: `overlay ${i + 1}/${ids.length}`, detail: { itemId } });
        }
        return out;
      } finally {
        await this.closeBrowser(browser);
        await this.release(server);
      }
    });
  }

  async renderGeneratedStills(reqIn: GeneratedStillsRequest, h: RenderHandlers): Promise<{ clipId: string; file: string }[]> {
    this.assertOpen();
    const req = GeneratedStillsRequest.parse(reqIn);
    const timeline = await readTimelineFile(req.projectDir, req.timelineRel);
    const byId = new Map(timeline.video.map((v) => [v.id, v]));
    // the key covers everything that changes the PNG: renderer code (GeneratedBackdrop, Remotion), GL backend, style
    // font bytes, the source and the tokens — stills persist in export/<lang>.generated across exports and upgrades
    const keyCtx = {
      codeHash: await computeCodeHash(this.config.repoRoot), gl: (await this.gl("auto", h.signal, false)).gl,
      fonts: await styleFontsDigest(timeline, req.projectDir, this.config.paths.styles),
    };
    const jobs: { clipId: string; file: string; source: unknown }[] = [];
    for (const clipId of new Set(req.clipIds)) {
      const v = byId.get(clipId);
      if (!v || (v.source.kind !== "generated" && v.source.kind !== "solid")) {
        h.onEvent({ type: "log", level: "warn", message: `clip ${clipId} has no generated/solid source; no still rendered`, stage: "export" });
        continue;
      }
      // content-addressed: identical sources share one PNG (and survive re-exports)
      const file = path.join(req.outDir, `gen-${generatedStillKey(v.source, timeline.render, keyCtx)}.png`);
      jobs.push({ clipId, file, source: v.source });
    }
    await mkdir(req.outDir, { recursive: true });
    const todo = [...new Map(jobs.filter((j) => !existsSync(j.file)).map((j) => [j.file, j])).values()];
    if (todo.length > 0) {
      await this.withRenderSlot("generated-stills", h.signal, () => this.logger.info("waiting for the render slot (generated stills)"), async () => {
        const { gl } = await this.gl("auto", h.signal, false);
        const { serveUrl } = await this.bundleLocked(h.signal);
        const exe = await ensureBrowserExecutable(this.config, { download: false, signal: h.signal });
        let browser: HeadlessBrowser | null = null;
        try {
          browser = await this.browser(exe, gl);
          const r = await loadRenderer();
          const common = commonRemotionOptions(exe, gl, this.config);
          for (const [i, j] of todo.entries()) {
            if (h.signal.aborted) throw abortError("generated stills");
            const inputProps = { source: j.source, tokens: timeline.render };
            const composition = await r.selectComposition({ ...common, serveUrl, id: COMPOSITIONS.still, inputProps, puppeteerInstance: browser });
            const tmp = j.file.replace(/\.png$/, ".tmp.png");
            try {
              await r.renderStill({ ...common, composition, serveUrl, inputProps, frame: 0, output: tmp, overwrite: true, imageFormat: "png", puppeteerInstance: browser });
              await rename(tmp, j.file);
            } catch (e) {
              await rm(tmp, { force: true });
              if (h.signal.aborted) throw abortError("generated stills");
              throw toDocErr(e, "RENDER_FAILED", `generated still for ${j.clipId} failed`);
            }
            h.onEvent({ type: "progress", stage: "export", lang: timeline.lang, pct: (i + 1) / todo.length, message: `generated still ${i + 1}/${todo.length}`, detail: { clipId: j.clipId } });
          }
        } finally {
          await this.closeBrowser(browser);
        }
      });
    }
    return jobs.map((j) => ({ clipId: j.clipId, file: j.file }));
  }

  private async probeGlLocked(force: boolean, signal: AbortSignal): Promise<GlProbe> {
    if (!force) {
      const cached = await readGlProbe(this.config);
      if (cached) return cached;
    }
    const { serveUrl } = await this.bundleLocked(signal);
    const exe = await ensureBrowserExecutable(this.config, { download: false, signal });
    const probe = await runGlProbe({ serveUrl, exe, config: this.config, logger: this.logger, signal });
    if (signal.aborted) throw abortError("gl probe");
    this.logger.info("gl probe", { chosen: probe.chosen, gpu: probe.gpu });
    return probe;
  }

  async probeGl(force?: boolean): Promise<GlProbe> {
    this.assertOpen();
    if (!force) {
      const cached = await readGlProbe(this.config);
      if (cached) return cached;
    }
    const signal = new AbortController().signal;
    return this.withRenderSlot("gl-probe", signal, () => this.logger.info("waiting for the render slot (gl probe)"), () => this.probeGlLocked(force ?? false, signal));
  }

  async close(): Promise<void> {
    this.closed = true;
    const all = [...this.live];
    this.live.clear();
    await Promise.all(all.map((x) => x.close().catch(() => undefined)));
  }
}

/** Same semantics as RenderService; used by the CLI, the job worker and tests. */
export class InProcessRenderClient implements RenderClient {
  readonly service: RenderService;
  constructor(o: RenderServiceOptions) {
    this.service = new RenderService(o);
  }
  render(req: RenderRequest, h: RenderHandlers) { return this.service.render(req, h); }
  renderStills(req: StillsRequest, h: RenderHandlers) { return this.service.renderStills(req, h); }
  renderOverlays(req: OverlayRenderRequest, h: RenderHandlers) { return this.service.renderOverlays(req, h); }
  renderGeneratedStills(req: GeneratedStillsRequest, h: RenderHandlers) { return this.service.renderGeneratedStills(req, h); }
  probeGl(force?: boolean) { return this.service.probeGl(force); }
  close() { return this.service.close(); }
}
