// Render integration tests (§16.2, W8 rows): bundle reuse, GL probe = swangle, 3-chunk draft render concatenated to
// exactly 150 frames + mux + gate + render.json, chunk cache / frame ranges, master post, cancel, deterministic stills,
// FontSpecimen without fallback warnings, generated stills, ProRes 4444 overlays. Needs the shared Chrome Headless Shell
// (docs/DEV.md); never downloads one. Every Chrome call goes through the machine-wide render lock.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenderDoc, type JobEventInput, type RenderRequest, type Timeline } from "@docmaker/core";
import { withFileLock } from "@docmaker/core/node";
import { makeTimeline } from "@docmaker/core/testing";
import { closeChrome, openChrome } from "../src/chrome";
import { findBrowserExecutable } from "../src/browser";
import { commonRemotionOptions } from "../src/presets";
import { COMPOSITIONS, loadRenderer } from "../src/remotion";
import { RenderService } from "../src/service";
import { ffmpegSync, probeFrames, probeJson, quietLogger, testConfig, tmpDir } from "../test/helpers";

const RENDER_LOCK = process.env.DOCMAKER_RENDER_LOCK || "/tmp/docmaker-render.lock";
const sha = (f: string) => createHash("sha256").update(readFileSync(f)).digest("hex");
const PALETTES = [["#4a1c40", "#e07a1f"], ["#123a5a", "#7fd1ff"], ["#2f4f1f", "#d8e36b"]] as const;

/** Synthetic media for every image/video asset of a timeline (at each asset's projectRel). */
function writeProjectMedia(t: Timeline, dir: string): void {
  let n = 0;
  for (const a of Object.values(t.assets).sort((x, y) => x.id.localeCompare(y.id))) {
    const out = path.join(dir, a.projectRel);
    const [c0, c1] = PALETTES[n++ % PALETTES.length]!;
    const w = a.width ?? 1920;
    const h = a.height ?? 1080;
    mkdirSync(path.dirname(out), { recursive: true });
    if (a.kind === "image" || a.ext === "jpg" || a.ext === "png") {
      ffmpegSync(["-f", "lavfi", "-i", `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:x0=0:y0=0:x1=${w}:y1=${h}:n=2:speed=0.00001,format=yuv420p`, "-vf", `drawbox=x=${Math.round(w * 0.4)}:y=${Math.round(h * 0.3)}:w=${Math.round(w * 0.2)}:h=${Math.round(h * 0.3)}:color=white@0.85:t=fill`, "-frames:v", "1", "-q:v", "3", out]);
    } else if (a.ext === "mp4") {
      ffmpegSync(["-f", "lavfi", "-i", `testsrc2=size=${w}x${h}:rate=${t.fps}`, "-frames:v", String(a.durationFrames ?? t.fps * 10), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-g", String(t.fps), out]);
    } else if (a.ext === "wav") {
      ffmpegSync(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "1", out]);
    }
  }
}

const exeEnv = process.env.DOCMAKER_BROWSER_EXECUTABLE;
let home: Awaited<ReturnType<typeof tmpDir>>;
let projectDir: string;
let service: RenderService;
let timeline: Timeline;
let config: ReturnType<typeof testConfig>;
const signal = new AbortController().signal;

function request(over: Partial<RenderRequest> = {}): RenderRequest {
  const preset = over.preset ?? "draft";
  return {
    slug: "w8-render-int", lang: "en", preset, projectDir, timelineRel: `render/en/${preset}/snapshot/timeline.json`, mixRel: `render/en/${preset}/snapshot/mix.wav`,
    outRel: `render/en/${preset}/final.mp4`, frameRange: null, chunkSeconds: 2, gl: "auto", concurrency: 2, grain: 0, lutCube: null, ...over,
  };
}
function handlers(events: JobEventInput[], s: AbortSignal = signal) {
  return { onEvent: (e: JobEventInput) => void events.push(e), signal: s };
}
const progressOf = (events: JobEventInput[]) => events.filter((e): e is Extract<JobEventInput, { type: "progress" }> => e.type === "progress");

beforeAll(async () => {
  home = await tmpDir("docmaker-render-int-");
  const exe = (exeEnv && existsSync(exeEnv) ? exeEnv : null) ?? (await findBrowserExecutable(testConfig(home.dir)));
  if (!exe) throw new Error("no Chrome Headless Shell: export DOCMAKER_BROWSER_EXECUTABLE (docs/DEV.md)");
  config = testConfig(path.join(home.dir, "home"), { browserExecutable: exe, renderLockFile: RENDER_LOCK, offline: true });
  service = new RenderService({ config, logger: quietLogger(), enableBundleCache: false });
  projectDir = path.join(home.dir, "project");
  timeline = makeTimeline({ seconds: 5 });
  writeProjectMedia(timeline, projectDir);
  for (const preset of ["draft", "master"]) {
    const snap = path.join(projectDir, `render/en/${preset}/snapshot`);
    await mkdir(snap, { recursive: true });
    await writeFile(path.join(snap, "timeline.json"), JSON.stringify(timeline));
    // a level-varying, slightly hot "mix" (5 s, s24 stereo 48 kHz) so the post-AAC gate has work to do
    ffmpegSync(["-f", "lavfi", "-i", "aevalsrc='0.5*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.7*t))+0.3*sin(2*PI*1650*t)*(0.5+0.5*sin(2*PI*3*t))':s=48000:d=5", "-ac", "2", "-c:a", "pcm_s24le", path.join(snap, "mix.wav")]);
  }
  await writeFile(path.join(projectDir, "project.json"), JSON.stringify({ audio: { targetLufs: -14, truePeakGate: -1 } }));
});

afterAll(async () => {
  await service?.close();
  await home?.cleanup();
});

describe("bundle (§16.2.1)", () => {
  it("builds once and reuses <home>/bundles/<codeHash>", async () => {
    const a = await service.ensureBundle(signal);
    expect(a.serveUrl).toBe(path.join(config.paths.bundles, a.codeHash));
    const index = path.join(a.serveUrl, "index.html");
    const m0 = statSync(index).mtimeMs;
    const t0 = Date.now();
    const b = await service.ensureBundle(signal);
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(b).toEqual(a);
    expect(statSync(index).mtimeMs).toBe(m0);
    expect((await readdir(config.paths.bundles)).filter((d) => d.includes(".tmp-"))).toEqual([]);
  });
});

describe("GL probe (§16.2.6)", () => {
  it("chooses swangle on this CPU-only host and caches the result", async () => {
    const p = await service.probeGl(true);
    expect(p.chosen).toBe("swangle");
    expect(p.gpu).toBe(false);
    const sw = p.results.find((r) => r.gl === "swangle")!;
    expect(sw.ok).toBe(true);
    expect(sw.renderer).toMatch(/SwiftShader|ANGLE/i);
    expect(existsSync(config.paths.glProbe)).toBe(true);
    expect(await service.probeGl()).toEqual(p);
  });
});

describe("render (§12.3, §16.2.2)", () => {
  let firstHashes: string[] = [];

  it("draft: 3 muted h264-ts chunks → concat = 150 frames, AAC master mux, gate, render.json", async () => {
    const events: JobEventInput[] = [];
    const r = await service.render(request(), handlers(events));
    expect(r.frames).toBe(150);
    expect(r.durationInFrames).toBe(150);
    expect(r.gl).toBe("swangle");
    expect(r.chunks.map((c) => [c.from, c.to, c.cached])).toEqual([[0, 49, false], [50, 99, false], [100, 149, false]]);
    firstHashes = r.chunks.map((c) => c.hash);
    for (const c of r.chunks) {
      expect(c.file).toBe(`render/en/draft/chunks/${c.hash}.ts`);
      const p = probeJson(path.join(projectDir, c.file));
      expect(p.streams.map((s) => s.codec_type)).toEqual(["video"]); // muted chunks
    }
    const final = path.join(projectDir, r.outFile);
    expect(probeFrames(final)).toBe(150);
    const p = probeJson(final);
    const v = p.streams.find((s) => s.codec_type === "video")!;
    const a = p.streams.find((s) => s.codec_type === "audio")!;
    expect([v.codec_name, v.width, v.height]).toEqual(["h264", 960, 540]);
    expect([a.codec_name, a.sample_rate, a.channels]).toEqual(["aac", "48000", 2]);
    expect(Number(p.format.duration)).toBeGreaterThan(4.98);
    expect(Number(p.format.duration)).toBeLessThan(5.05);
    expect(r.loudness).not.toBeNull();
    expect(r.loudness!.truePeakDbtp).toBeLessThanOrEqual(-1);
    const doc = RenderDoc.parse(JSON.parse(readFileSync(path.join(projectDir, "render/en/draft/render.json"), "utf8")));
    expect(doc).toMatchObject({ lang: "en", preset: "draft", frames: 150, codeHash: r.codeHash, onlyChapters: null });
    expect(doc.mixHash).toMatch(/^[0-9a-f]{64}$/);
    // progress: monotonic, ends at 1, chunk messages with frame details
    const pr = progressOf(events);
    expect(pr.length).toBeGreaterThan(3);
    for (let i = 1; i < pr.length; i++) expect(pr[i]!.pct).toBeGreaterThanOrEqual(pr[i - 1]!.pct);
    expect(pr.at(-1)!.pct).toBe(1);
    expect(pr.some((e) => /^chunk \d\/3/.test(e.message) && typeof e.detail.renderedFrames === "number")).toBe(true);
    expect(events.filter((e) => e.type === "artifact").map((e) => (e as { path: string }).path)).toContain("render/en/draft/final.mp4");
    // no intermediates left behind
    expect((await readdir(path.join(projectDir, "render/en/draft"))).sort()).toEqual(["chunks", "final.mp4", "render.json", "snapshot"]);
  });

  it("re-render hits the chunk cache; a frame range reuses the identical chunk and clips the others", async () => {
    const again = await service.render(request(), handlers([]));
    expect(again.chunks.map((c) => c.cached)).toEqual([true, true, true]);
    expect(again.chunks.map((c) => c.hash)).toEqual(firstHashes);
    expect(probeFrames(path.join(projectDir, again.outFile))).toBe(150);
    const ranged = await service.render(request({ frameRange: [40, 99], outRel: "render/en/draft/range.mp4" }), handlers([]));
    expect(ranged.frames).toBe(60);
    expect(ranged.chunks.map((c) => [c.from, c.to, c.cached])).toEqual([[40, 49, false], [50, 99, true]]);
    expect(probeFrames(path.join(projectDir, "render/en/draft/range.mp4"))).toBe(60);
    const d = Number(probeJson(path.join(projectDir, "render/en/draft/range.mp4")).format.duration);
    expect(d).toBeGreaterThan(1.98);
    expect(d).toBeLessThan(2.05);
  });

  it("master: full scale with lut3d + grain post (LUT generated from grade.lut)", async () => {
    const events: JobEventInput[] = [];
    const r = await service.render(request({ preset: "master", frameRange: [0, 29], grain: 4 }), handlers(events));
    expect(r.frames).toBe(30);
    const final = path.join(projectDir, r.outFile);
    const v = probeJson(final).streams.find((s) => s.codec_type === "video")!;
    expect([v.width, v.height]).toEqual([1920, 1080]);
    expect(probeFrames(final)).toBe(30);
    expect(progressOf(events).some((e) => e.detail.phase === "post")).toBe(true);
    expect((await readdir(path.join(config.paths.cache, "luts"))).filter((f) => f.endsWith(".cube"))).toHaveLength(1);
  });

  it("cancel: aborting mid-chunk rejects CANCELED, deletes the partial chunk and writes no output", async () => {
    const ac = new AbortController();
    const events: JobEventInput[] = [];
    const h = {
      onEvent: (e: JobEventInput) => {
        events.push(e);
        if (e.type === "progress" && e.detail.phase === "chunks" && typeof e.detail.renderedFrames === "number" && e.detail.renderedFrames > 3) ac.abort();
      },
      signal: ac.signal,
    };
    await expect(service.render(request({ preset: "master", outRel: "render/en/master/canceled.mp4", grain: 0 }), h)).rejects.toMatchObject({ code: "CANCELED" });
    const chunkDir = path.join(projectDir, "render/en/master/chunks");
    expect((await readdir(chunkDir)).filter((f) => f.includes(".tmp"))).toEqual([]);
    expect(existsSync(path.join(projectDir, "render/en/master/canceled.mp4"))).toBe(false);
    expect(existsSync(RENDER_LOCK) ? JSON.parse(readFileSync(RENDER_LOCK, "utf8")).pid : null).not.toBe(process.pid);
  });

  it("refuses an out-of-range frame range and a missing mix", async () => {
    await expect(service.render(request({ frameRange: [100, 150] }), handlers([]))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(service.render(request({ mixRel: "render/en/draft/snapshot/nope.wav" }), handlers([]))).rejects.toMatchObject({ code: "UPSTREAM_MISSING" });
  });
});

describe("stills (§12.6, §16.2.3 determinism)", () => {
  it("renders the same frames twice bit-identically and builds a labelled contact sheet", async () => {
    const frames = [0, 37, 74, 120];
    const req = { projectDir, timelineRel: "render/en/draft/snapshot/timeline.json", frames, scale: 0.5 };
    const a = await service.renderStills({ ...req, outDir: path.join(home.dir, "stills-a"), sheet: { cols: 2, width: 320, label: true } }, handlers([]));
    const b = await service.renderStills({ ...req, outDir: path.join(home.dir, "stills-b"), sheet: null }, handlers([]));
    expect(a.map((f) => path.basename(f))).toEqual(["frame-000000.jpg", "frame-000037.jpg", "frame-000074.jpg", "frame-000120.jpg", "sheet-01.jpg"]);
    expect(b).toHaveLength(4);
    expect(a.slice(0, 4).map(sha)).toEqual(b.map(sha));
    const sheet = probeJson(a[4]!).streams[0]!;
    expect([sheet.width, sheet.height]).toEqual([8 + 2 * 328, 8 + 2 * 188]);
  });
});

describe("compositions", () => {
  it("FontSpecimen renders without font fallback warnings (§16.2.4)", async () => {
    const { serveUrl } = await service.ensureBundle(signal);
    const logs: string[] = [];
    await withFileLock(RENDER_LOCK, `render-int-fonts:${process.pid}`, async () => {
      const b = await openChrome(config.browserExecutable!, "swangle", { cpuRaster: true });
      try {
        const r = await loadRenderer();
        const common = commonRemotionOptions(config.browserExecutable!, "swangle", config);
        const composition = await r.selectComposition({ ...common, serveUrl, id: COMPOSITIONS.fonts, inputProps: {}, puppeteerInstance: b });
        await r.renderStill({ ...common, composition, serveUrl, inputProps: {}, frame: 0, output: path.join(home.dir, "fonts.png"), imageFormat: "png", puppeteerInstance: b, onBrowserLog: (l) => logs.push(`${l.type}: ${l.text}`) });
      } finally {
        await closeChrome(b);
      }
    }, { signal });
    expect(logs.filter((l) => /^error|\[fonts\]|fallback/i.test(l))).toEqual([]);
    expect(statSync(path.join(home.dir, "fonts.png")).size).toBeGreaterThan(10_000);
  });

  it("renderGeneratedStills: one 1920×1080 PNG per generated/solid source, content-addressed and cached", async () => {
    const t2: Timeline = structuredClone(timeline);
    t2.video[0] = { ...t2.video[0]!, source: { kind: "solid", color: "#C0392B" } };
    t2.video[1] = { ...t2.video[1]!, source: { kind: "generated", recipe: "gradientGrid", text: "1637", palette: ["#101820", "#F2AA4C"], seed: 7 } };
    const rel = "render/en/draft/snapshot/timeline-generated.json";
    await writeFile(path.join(projectDir, rel), JSON.stringify(t2));
    const outDir = path.join(home.dir, "generated");
    const events: JobEventInput[] = [];
    const req = { projectDir, timelineRel: rel, clipIds: [t2.video[0]!.id, t2.video[1]!.id, "v:missing:0"], outDir };
    const r = await service.renderGeneratedStills(req, handlers(events));
    expect(r.map((x) => x.clipId)).toEqual([t2.video[0]!.id, t2.video[1]!.id]);
    for (const x of r) {
      const s = probeJson(x.file).streams[0]!;
      expect([s.codec_name, s.width, s.height]).toEqual(["png", 1920, 1080]);
    }
    expect(events.some((e) => e.type === "log" && e.message.includes("v:missing:0"))).toBe(true);
    const m = statSync(r[0]!.file).mtimeMs;
    const again = await service.renderGeneratedStills(req, handlers([]));
    expect(again).toEqual(r);
    expect(statSync(r[0]!.file).mtimeMs).toBe(m);
  });

  it("renderOverlays (M3): ProRes 4444 with alpha per overlay item", async () => {
    const item = [...timeline.overlays].sort((a, b) => a.dur + a.enterFrames + a.exitFrames - (b.dur + b.enterFrames + b.exitFrames))[0];
    expect(item).toBeDefined();
    const outDir = path.join(home.dir, "overlays");
    const r = await service.renderOverlays({ projectDir, timelineRel: "render/en/draft/snapshot/timeline.json", itemIds: [item!.id], outDir }, handlers([]));
    expect(r).toHaveLength(1);
    const v = probeJson(r[0]!.file).streams.find((s) => s.codec_type === "video")! as { codec_name: string; width?: number } & Record<string, unknown>;
    expect(v.codec_name).toBe("prores");
    expect(v.pix_fmt).toMatch(/^yuva444p1[02]le$/); // ffmpeg decodes ProRes 4444 (encoded yuva444p10le) as 12-bit; "a" = alpha
    expect(probeFrames(r[0]!.file)).toBe(item!.dur + item!.enterFrames + item!.exitFrames);
    expect(probeJson(r[0]!.file).streams.some((s) => s.codec_type === "audio")).toBe(false);
  });
});

