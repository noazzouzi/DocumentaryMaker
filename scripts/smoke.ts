// scripts/smoke.ts — P0 smoke test (SPEC §2.4), run with `pnpm smoke` (tsx). Both steps run under the machine-wide
// render lock (withFileLock(config.renderLockFile)):
//   1. bundle() @docmaker/remotion/entry into a temp dir (enableCaching:false); render makeTimeline({seconds:5}) as
//      3 muted h264-ts chunks; concat with the ffmpeg concat demuxer; assert 150 frames with ffprobe -count_frames;
//   2. `pnpm --filter @docmaker/web build` (Next 16, Turbopack) of the skeleton web app.
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DocmakerError } from "@docmaker/core";
import { ffmpeg, ffprobeJson, loadRuntime, run, withFileLock } from "@docmaker/core/node";
import { makeTimeline } from "@docmaker/core/testing";

type Bundler = typeof import("@remotion/bundler");
type Renderer = typeof import("@remotion/renderer");

const t0 = Date.now();
const log = (msg: string) => process.stdout.write(`[smoke +${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}\n`);
const { config } = loadRuntime({ cwd: process.cwd() });
const repoRoot = config.repoRoot;
const signal = new AbortController().signal;

// Remotion's Node packages are dependencies of @docmaker/render (pnpm does not hoist them to the root).
const fromRender = createRequire(path.join(repoRoot, "packages/render/package.json"));
const load = async <T>(id: string): Promise<T> => (await import(pathToFileURL(fromRender.resolve(id)).href)) as T;

function browserExecutable(): string | null {
  if (config.browserExecutable) return config.browserExecutable;
  const shared = path.join(repoRoot, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell");
  return existsSync(shared) ? shared : null;
}

async function renderSmoke(): Promise<void> {
  const exe = browserExecutable();
  if (!exe) throw new DocmakerError("TOOL_MISSING", "no Chrome Headless Shell", { hint: "set DOCMAKER_BROWSER_EXECUTABLE (see docs/DEV.md)" });
  const { bundle } = await load<Bundler>("@remotion/bundler");
  const { renderMedia, selectComposition } = await load<Renderer>("@remotion/renderer");
  const tmp = await mkdtemp(path.join(os.tmpdir(), "docmaker-smoke-"));
  try {
    log("bundling packages/remotion/src/entry.ts …");
    const serveUrl = await bundle({
      entryPoint: path.join(repoRoot, "packages/remotion/src/entry.ts"),
      outDir: path.join(tmp, "bundle"),
      enableCaching: false,
      onProgress: () => undefined,
    });
    const timeline = makeTimeline({ seconds: 5 });
    const inputProps = {
      timeline, timelineUrl: null, assetBaseUrl: "", mode: "render", itemId: null, scratchBanner: false,
      layers: { picture: true, graphics: true, captions: true, hud: true, covers: true, audio: true },
    };
    const chromiumOptions = { gl: "swangle" as const };
    const composition = await selectComposition({ serveUrl, id: "Documentary", inputProps, browserExecutable: exe, chromiumOptions });
    if (composition.durationInFrames !== 150) throw new Error(`calculateMetadata gave ${composition.durationInFrames} frames, want 150`);
    const ranges: [number, number][] = [[0, 49], [50, 99], [100, 149]];
    const chunks: string[] = [];
    for (const [i, frameRange] of ranges.entries()) {
      const out = path.join(tmp, `chunk-${i}.ts`);
      await renderMedia({
        composition, serveUrl, inputProps, codec: "h264-ts", muted: true, frameRange, outputLocation: out,
        browserExecutable: exe, chromiumOptions, concurrency: 2, logLevel: "error",
      });
      chunks.push(out);
      log(`chunk ${i} rendered (frames ${frameRange[0]}–${frameRange[1]})`);
    }
    const list = path.join(tmp, "concat.txt");
    await writeFile(list, chunks.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
    const final = path.join(tmp, "final.mp4");
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", "-movflags", "+faststart", final], { config, signal });
    const probe = await ffprobeJson(final, { config, signal, countFrames: true });
    const v = probe.streams.find((s) => s.codecType === "video");
    if (!v) throw new Error("final.mp4 has no video stream");
    if (v.nbFrames !== 150) throw new Error(`final.mp4 has ${v.nbFrames} frames, want 150`);
    if (probe.streams.some((s) => s.codecType === "audio")) throw new Error("chunks must be muted");
    log(`✓ render: 3 chunks → ${v.nbFrames} frames, ${v.codecName} ${v.width}×${v.height} @ ${v.fps} fps, ${probe.durationSec.toFixed(3)} s`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function webSmoke(): Promise<void> {
  log("next build (apps/web) …");
  const r = await run("pnpm", ["--filter", "@docmaker/web", "build"], {
    signal, cwd: repoRoot, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" }, timeoutMs: 900_000,
  });
  if (r.code !== 0) {
    process.stderr.write(r.stdout.slice(-4000) + "\n" + r.stderr.slice(-4000) + "\n");
    throw new Error(`next build failed (exit ${r.code})`);
  }
  log("✓ web: next build succeeded");
}

try {
  await withFileLock(config.renderLockFile, `smoke:${process.pid}`, async () => {
    await renderSmoke();
    await webSmoke();
  }, { signal, onWait: () => log(`waiting for the render lock ${config.renderLockFile} …`) });
  log("✓ smoke passed");
} catch (e) {
  process.stderr.write(`✗ smoke failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
  process.exit(1);
}
