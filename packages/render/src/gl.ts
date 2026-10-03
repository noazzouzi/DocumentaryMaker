// GL probe (§12.5): render the GlProbe still with gl ∈ [angle-egl, angle, swangle] (30 s each); the composition logs
// `GL_PROBE {...}` / `UNMASKED_RENDERER_WEBGL=…`; gpu = ok && renderer is not SwiftShader/llvmpipe. The first
// GPU-backed mode wins, else swangle. Cached in <home>/gl-probe.json.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { GlProbe, stableStringify, type Logger, type RuntimeConfig } from "@docmaker/core";
import { closeChrome, openChrome } from "./chrome";
import { commonRemotionOptions, type GlMode } from "./presets";
import { COMPOSITIONS, loadRenderer, type HeadlessBrowser } from "./remotion";

export const GL_CANDIDATES: readonly GlMode[] = ["angle-egl", "angle", "swangle"];
export const GL_PROBE_TIMEOUT_MS = 30_000;
const SOFTWARE = /SwiftShader|llvmpipe|softpipe|software/i;

/** Parses the probe's console lines. */
export function parseGlProbeLogs(lines: readonly string[]): { ok: boolean; renderer: string } {
  let ok = false;
  let renderer = "";
  for (const l of lines) {
    if (l.startsWith("GL_PROBE ")) {
      try {
        const j = JSON.parse(l.slice("GL_PROBE ".length)) as { ok?: unknown; renderer?: unknown };
        ok = j.ok === true;
        if (typeof j.renderer === "string") renderer = j.renderer;
      } catch {
        /* malformed line: not ok */
      }
    } else if (l.startsWith("UNMASKED_RENDERER_WEBGL=") && !renderer) {
      const r = l.slice("UNMASKED_RENDERER_WEBGL=".length);
      if (r !== "none") renderer = r;
    }
  }
  return { ok, renderer };
}

export const isGpuRenderer = (ok: boolean, renderer: string): boolean => ok && renderer !== "" && !SOFTWARE.test(renderer);

/** Picks the result per §12.5 (first GPU-backed in candidate order, else swangle). */
export function chooseGl(results: readonly { gl: string; ok: boolean; renderer: string }[]): { chosen: GlMode; gpu: boolean } {
  for (const g of GL_CANDIDATES) {
    const r = results.find((x) => x.gl === g);
    if (r && isGpuRenderer(r.ok, r.renderer)) return { chosen: g, gpu: true };
  }
  return { chosen: "swangle", gpu: false };
}

export async function readGlProbe(config: RuntimeConfig): Promise<GlProbe | null> {
  try {
    const p = GlProbe.safeParse(JSON.parse(await readFile(config.paths.glProbe, "utf8")));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

async function probeOne(gl: GlMode, o: { serveUrl: string; exe: string; config: RuntimeConfig; signal: AbortSignal }): Promise<{ ok: boolean; renderer: string }> {
  const { selectComposition, renderStill } = await loadRenderer();
  const lines: string[] = [];
  let browser: HeadlessBrowser | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const common = commonRemotionOptions(o.exe, gl, o.config, GL_PROBE_TIMEOUT_MS);
  const attempt = (async () => {
    browser = await openChrome(o.exe, gl, { cpuRaster: false });
    const composition = await selectComposition({ ...common, serveUrl: o.serveUrl, id: COMPOSITIONS.gl, inputProps: {}, puppeteerInstance: browser });
    await renderStill({
      ...common, composition, serveUrl: o.serveUrl, inputProps: {}, frame: 0, output: null, imageFormat: "png", puppeteerInstance: browser,
      onBrowserLog: (l) => lines.push(l.text),
    });
  })();
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`gl=${gl} timed out`)), GL_PROBE_TIMEOUT_MS + 5_000);
  });
  const abort = new Promise<never>((_, reject) => o.signal.addEventListener("abort", () => reject(new Error("canceled")), { once: true }));
  try {
    await Promise.race([attempt, timeout, abort]);
    return parseGlProbeLogs(lines);
  } catch {
    attempt.catch(() => undefined);
    return { ok: false, renderer: parseGlProbeLogs(lines).renderer };
  } finally {
    if (timer) clearTimeout(timer);
    await closeChrome(browser);
  }
}

export async function runGlProbe(o: { serveUrl: string; exe: string; config: RuntimeConfig; logger: Logger; signal: AbortSignal }): Promise<GlProbe> {
  const results: GlProbe["results"] = [];
  for (const gl of GL_CANDIDATES) {
    if (o.signal.aborted) break;
    const t0 = Date.now();
    const r = await probeOne(gl, o);
    results.push({ gl, ok: r.ok, ms: Date.now() - t0, renderer: r.renderer });
    o.logger.debug("gl probe", { gl, ok: r.ok, renderer: r.renderer });
    if (isGpuRenderer(r.ok, r.renderer)) break;
  }
  const { chosen, gpu } = chooseGl(results);
  const doc = GlProbe.parse({ schemaVersion: 1, chosen, results, gpu, probedAt: new Date().toISOString() });
  if (!o.signal.aborted) {
    await mkdir(path.dirname(o.config.paths.glProbe), { recursive: true });
    const tmp = `${o.config.paths.glProbe}.tmp-${process.pid}`;
    await writeFile(tmp, stableStringify(doc));
    await rename(tmp, o.config.paths.glProbe);
  }
  return doc;
}
