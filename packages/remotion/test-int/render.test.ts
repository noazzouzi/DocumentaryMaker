// Render integration tests (§16.2, W7 rows): bundle once, then FontSpecimen, GlProbe, one still per M1 component
// (+ the card layout, FallbackCard, every M1 transition class), every component via StyleSpecimen, the M2 layouts /
// treatments / caption variants and the M3 covers and overlaps (240 s feature timeline), a chunk through renderMedia
// (the render worker path) and render-twice determinism. Needs the shared Chrome Headless Shell; holds the machine-wide
// render lock for the whole file; concurrency ≤ 2.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMPONENT_META, type Timeline } from "@docmaker/core";
import { spawnSync } from "node:child_process";
import { computeTimeline } from "../src/compute/computeTimeline";
import { planChunks } from "../src/compute/planChunks";
import { browserExecutable, bundleEntry, chromiumOptions, decodeRgba, edgeEnergy, enableDeterministicRaster, loadRemotion, makeTmp, meanAbsDiff, regionStats, startAssetServer, writeJson, writeProjectMedia, type AssetServer } from "./helpers/harness";
import { acquireRenderLock } from "./helpers/lock";
import { buildFeatureTimeline, buildTimeline, type FeatureTimeline } from "./helpers/timelines";

type Renderer = Awaited<ReturnType<typeof loadRemotion>>["renderer"];
type Browser = Awaited<ReturnType<Renderer["openBrowser"]>>;
interface Log { type: string; text: string }

const LAYERS_ALL = { picture: true, graphics: true, captions: true, hud: true, covers: true, audio: false };
const OVERLAY_ONLY = { picture: false, graphics: true, captions: false, hud: true, covers: false, audio: false };

let renderer: Renderer;
let browser: Browser;
let serveUrl: string;
let server: AssetServer;
let release: () => Promise<void> = async () => undefined;
let tmp: { dir: string; cleanup: () => Promise<void> };
let t: Timeline;
const exe = browserExecutable();

async function still(frame: number, o: { id?: string; layers?: typeof LAYERS_ALL; format?: "png" | "jpeg"; timelineUrl?: boolean; name?: string; logs?: Log[]; timeline?: Timeline; server?: AssetServer } = {}): Promise<string> {
  const id = o.id ?? "Documentary";
  const srv = o.server ?? server;
  const inputProps = o.timelineUrl
    ? { timeline: null, timelineUrl: `${srv.url}/timeline.json`, assetBaseUrl: srv.url, mode: "render", itemId: null, scratchBanner: false, layers: o.layers ?? LAYERS_ALL }
    : { timeline: o.timeline ?? t, timelineUrl: null, assetBaseUrl: srv.url, mode: "render", itemId: null, scratchBanner: false, layers: o.layers ?? LAYERS_ALL };
  const composition = await renderer.selectComposition({ serveUrl, id, inputProps, browserExecutable: exe, chromiumOptions, puppeteerInstance: browser, logLevel: "error" });
  const fmt = o.format ?? "png";
  const out = path.join(tmp.dir, "stills", `${o.name ?? id}-${frame}-${Math.random().toString(36).slice(2, 8)}.${fmt === "png" ? "png" : "jpg"}`);
  await renderer.renderStill({
    composition, serveUrl, inputProps, frame, output: out, imageFormat: fmt, browserExecutable: exe, chromiumOptions, puppeteerInstance: browser, logLevel: "error",
    onBrowserLog: (l) => o.logs?.push({ type: l.type, text: l.text }),
  });
  return out;
}
const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const errorsOf = (logs: Log[]) => logs.filter((l) => l.type === "error" || /falling back to <OffthreadVideo>|\[docmaker\]|\[fonts\]/i.test(l.text));

beforeAll(async () => {
  ({ renderer } = await loadRemotion());
  release = await acquireRenderLock(`remotion-test-int:${process.pid}`, () => console.log("waiting for the render lock …"));
  tmp = await makeTmp("docmaker-remotion-int-");
  const { bundler } = await loadRemotion();
  serveUrl = await bundleEntry(bundler, path.join(tmp.dir, "bundle"));
  t = buildTimeline();
  const proj = path.join(tmp.dir, "project");
  await writeProjectMedia(t, proj);
  await writeJson(path.join(proj, "timeline.json"), t);
  server = await startAssetServer(proj);
  enableDeterministicRaster();
  browser = await renderer.openBrowser("chrome", { browserExecutable: exe, chromiumOptions, logLevel: "error" });
});

afterAll(async () => {
  await browser?.close({ silent: true }).catch(() => undefined);
  await server?.close();
  await release();
  await tmp?.cleanup();
});

describe("compositions", () => {
  it("FontSpecimen renders every registered face without fallback warnings", async () => {
    const logs: Log[] = [];
    const file = await still(0, { id: "FontSpecimen", logs, name: "fonts" });
    expect(errorsOf(logs)).toEqual([]);
    const img = decodeRgba(file);
    expect(regionStats(img, { x: 0, y: 0, w: 1920, h: 1080 }).lumaStd).toBeGreaterThan(10);
  });

  it("GlProbe logs the unmasked renderer and draws with WebGL2", async () => {
    const logs: Log[] = [];
    await still(0, { id: "GlProbe", logs, name: "gl" });
    const line = logs.find((l) => l.text.startsWith("GL_PROBE "));
    expect(logs.some((l) => l.text.startsWith("UNMASKED_RENDERER_WEBGL="))).toBe(true);
    const r = JSON.parse(line!.text.slice("GL_PROBE ".length)) as { ok: boolean; webgl2: boolean; renderer: string };
    expect(r.webgl2).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.renderer).toMatch(/SwiftShader|ANGLE|llvmpipe|Vulkan|OpenGL/i);
  });

  it("calculateMetadata sizes the Documentary from a timelineUrl", async () => {
    const inputProps = { timeline: null, timelineUrl: `${server.url}/timeline.json`, assetBaseUrl: server.url, mode: "render", itemId: null, scratchBanner: false, layers: LAYERS_ALL };
    const c = await renderer.selectComposition({ serveUrl, id: "Documentary", inputProps, browserExecutable: exe, chromiumOptions, puppeteerInstance: browser, logLevel: "error" });
    expect(c.durationInFrames).toBe(t.durationInFrames);
    expect([c.width, c.height, c.fps]).toEqual([1920, 1080, 30]);
    expect(c.props.timeline ?? null).toBeNull(); // never returned in props
    const item = t.overlays[2]!;
    const ci = await renderer.selectComposition({ serveUrl, id: "OverlayItem", inputProps: { ...inputProps, itemId: item.id }, browserExecutable: exe, chromiumOptions, puppeteerInstance: browser, logLevel: "error" });
    expect(ci.durationInFrames).toBe(item.dur + item.enterFrames + item.exitFrames);
  });
});

describe("components (one still per M1 component, overlay layers only)", () => {
  const ids = Object.entries(COMPONENT_META).filter(([, m]) => m.milestone === "M1").map(([id]) => id);
  it("covers every M1 component", () => {
    const present = new Set(buildTimeline().overlays.map((o) => o.component));
    for (const id of ids) expect(present.has(id as never), id).toBe(true);
  });
  for (const id of ids) {
    it(`${id} renders non-empty pixels in its zone`, async () => {
      const item = t.overlays.find((o) => o.component === id)!;
      const frame = item.from + Math.min(item.dur - Math.max(1, item.exitFrames) - 1, item.enterFrames + 12);
      const logs: Log[] = [];
      const file = await still(frame, { id: "DocumentaryOverlay", layers: OVERLAY_ONLY, logs, name: id });
      expect(errorsOf(logs)).toEqual([]);
      const zoneName = (item.props as { zone?: typeof item.zone }).zone ?? item.zone;
      const zone = t.render.tokens.layout.zones[COMPONENT_META[item.component].fullFrame ? "full" : zoneName];
      const s = regionStats(decodeRgba(file), zone);
      expect(s.opaqueShare, `${id} opaque share in ${zoneName}`).toBeGreaterThan(0.02);
    });
  }

  it("FallbackCard renders the text of a component id unknown to this build instead of crashing", async () => {
    const item = t.overlays.find((o) => o.id === "ov:CH2:FutureThing:9")!;
    const logs: Log[] = [];
    const file = await still(item.from + 20, { id: "DocumentaryOverlay", layers: OVERLAY_ONLY, logs, name: "fallback" });
    expect(errorsOf(logs)).toEqual([]);
    expect(regionStats(decodeRgba(file), t.render.tokens.layout.zones.center).opaqueShare).toBeGreaterThan(0.02);
  });
});

describe("every component (StyleSpecimen, sample props)", () => {
  it("renders all 25 components without errors, each visibly different", async () => {
    const logs: Log[] = [];
    const inputProps = { render: t.render, lang: "en" };
    const c = await renderer.selectComposition({ serveUrl, id: "StyleSpecimen", inputProps, browserExecutable: exe, chromiumOptions, puppeteerInstance: browser, logLevel: "error" });
    expect(c.durationInFrames).toBe(25);
    const hashes: string[] = [];
    for (let f = 0; f < c.durationInFrames; f++) {
      const out = path.join(tmp.dir, "stills", `specimen-${f}.jpg`);
      await renderer.renderStill({ composition: c, serveUrl, inputProps, frame: f, output: out, imageFormat: "jpeg", browserExecutable: exe, chromiumOptions, puppeteerInstance: browser, logLevel: "error", onBrowserLog: (l) => logs.push({ type: l.type, text: l.text }) });
      hashes.push(sha(out));
    }
    expect(errorsOf(logs)).toEqual([]);
    expect(new Set(hashes).size).toBe(25);
  });
});

describe("picture", () => {
  it("card layout: framed photo over a drifting backdrop", async () => {
    const card = t.video.find((c) => c.layout === "card")!;
    const file = await still(card.from + Math.floor(card.dur / 2), { layers: { ...LAYERS_ALL, graphics: false, captions: false, hud: false }, name: "card" });
    const img = decodeRgba(file);
    const corner = regionStats(img, { x: 0, y: 0, w: 120, h: 120 });
    const centre = regionStats(img, { x: 760, y: 340, w: 400, h: 400 });
    expect(Math.abs(corner.meanLuma - centre.meanLuma)).toBeGreaterThan(15);
  });

  it("transitions of every M1 class render around their cuts; dips are black on the switch frame", async () => {
    const ct = computeTimeline(t);
    expect(ct.warnings).toEqual([]);
    const logs: Log[] = [];
    const frames = new Set<number>();
    for (const [id, e] of Object.entries(ct.entries)) {
      const c = t.video.find((v) => v.id === id)!;
      frames.add(c.from - 2).add(c.from).add(c.from + Math.min(3, e.frames - 1));
    }
    for (const w of ct.covers) frames.add(w.cut);
    const overlap = t.video.find((v) => v.transitionIn.kind === "overlap")!;
    frames.add(overlap.from);
    for (const f of [...frames].sort((a, b) => a - b)) await still(f, { logs, format: "jpeg", name: "transition" });
    expect(errorsOf(logs)).toEqual([]);
    const dip = ct.covers.find((w) => w.presentation === "dipToBlack")!;
    const dipFile = await still(dip.cut, { layers: { ...LAYERS_ALL, graphics: false, captions: false, hud: false }, name: "dip" });
    expect(regionStats(decodeRgba(dipFile), { x: 0, y: 0, w: 1920, h: 1080 }).meanLuma).toBeLessThan(6);
  });
});

describe("M2 layouts, treatments and caption variants; M3 covers and overlaps (240 s feature timeline)", () => {
  let ft: FeatureTimeline;
  let fserver: AssetServer;
  const PICTURE_COVERS = { picture: true, graphics: false, captions: false, hud: false, covers: true, audio: false };
  const CAPTIONS_ONLY = { picture: false, graphics: false, captions: true, hud: false, covers: false, audio: false };
  const logs: Log[] = [];
  const shot = async (frame: number, name: string, layers = PICTURE_COVERS) => decodeRgba(await still(frame, { timeline: ft.t, server: fserver, layers, logs, name }));
  const FULL = { x: 0, y: 0, w: 1920, h: 1080 };

  beforeAll(async () => {
    ft = buildFeatureTimeline();
    const proj = path.join(tmp.dir, "feature-project");
    await writeProjectMedia(ft.t, proj);
    fserver = await startAssetServer(proj);
  });
  afterAll(async () => {
    await fserver?.close();
  });

  it("is a clean timeline for computeTimeline (no downgraded transitions)", () => {
    const ct = computeTimeline(ft.t);
    expect(ct.warnings).toEqual([]);
    expect(ct.covers.filter((w) => ft.covers.some((c) => c.clipId === w.clipId)).map((w) => w.presentation).sort()).toEqual(ft.covers.map((c) => c.key).sort());
    const trans = ct.chapters.flatMap((c) => c.series).filter((x) => x.type === "trans" && ft.overlaps.some((o) => o.clipId === x.clipId));
    expect(trans.map((x) => (x.type === "trans" ? x.presentation : "")).sort()).toEqual(ft.overlaps.map((o) => o.key).sort());
  });

  it("dotWipe and iris are black on the frame before the cut and on the cut frame", async () => {
    for (const key of ["dotWipe", "iris"]) {
      const c = ft.covers.find((x) => x.key === key)!;
      for (const f of [c.cut - 1, c.cut]) expect(regionStats(await shot(f, key), FULL).maxLuma, `${key} @${f}`).toBeLessThan(8);
      expect(regionStats(await shot(c.cut - Math.floor(c.d / 2), `${key}-edge`), FULL).meanLuma, `${key} edge frame`).toBeGreaterThan(20);
    }
  });

  it("paperRip covers the frame with paper before the cut and tears it open after", async () => {
    const c = ft.covers.find((x) => x.key === "paperRip")!;
    const covered = regionStats(await shot(c.cut - 1, "paperRip"), FULL);
    expect(covered.meanLuma).toBeGreaterThan(170);
    expect(covered.lumaStd).toBeLessThan(30);
    expect(covered.meanChroma).toBeLessThan(40);
    const torn = await shot(c.cut + 3, "paperRip-torn");
    const middle = regionStats(torn, { x: 760, y: 0, w: 400, h: 1080 });
    const sides = regionStats(torn, { x: 0, y: 0, w: 120, h: 1080 });
    expect(Math.abs(middle.meanLuma - sides.meanLuma)).toBeGreaterThan(10); // B shows through the tear, paper on the sides
  });

  it("filmBurn over-exposes the splice; whipStreaks smears it", async () => {
    const fb = ft.covers.find((x) => x.key === "filmBurn")!;
    expect(regionStats(await shot(fb.cut, "filmBurn"), FULL).meanLuma).toBeGreaterThan(200);
    const ws = ft.covers.find((x) => x.key === "whipStreaks")!;
    const smear = regionStats(await shot(ws.cut, "whipStreaks"), FULL);
    const plain = regionStats(await shot(ws.cut - Math.floor(ws.d / 2) - 1, "whipStreaks-before"), FULL);
    expect(smear.meanLuma - plain.meanLuma).toBeGreaterThan(40);
  });

  it("push / wipe / blurDissolve: the cut frame is between A and B; blurDissolve softens it", async () => {
    for (const o of ft.overlaps) {
      const a = await shot(o.cut - o.d / 2 - 1, `${o.key}-a`);
      const mid = await shot(o.cut, `${o.key}-mid`);
      const b = await shot(o.cut + o.d / 2, `${o.key}-b`);
      expect(meanAbsDiff(mid, a), `${o.key} mid vs A`).toBeGreaterThan(3);
      expect(meanAbsDiff(mid, b), `${o.key} mid vs B`).toBeGreaterThan(3);
      if (o.key === "blurDissolve") expect(edgeEnergy(mid)).toBeLessThan(0.8 * Math.min(edgeEnergy(a), edgeEnergy(b)));
      if (o.key === "wipe") {
        // wipe from the right: at the half-way frame the right half already shows B, the left half still A
        expect(meanAbsDiff(mid, b)).toBeLessThan(meanAbsDiff(a, b));
      }
    }
  });

  it("pip: white 4 px stroke around a 76 %-wide frame over the backdrop, source chip inside", async () => {
    const c = ft.layouts.find((x) => x.key === "pip")!;
    const img = await shot(c.from + 30, "pip");
    const width = 0.76 * 1920;
    const left = (1920 - width) / 2;
    const stroke = regionStats(img, { x: left - 4, y: 300, w: 4, h: 480 });
    expect(stroke.maxLuma).toBeGreaterThan(230);
    const backdrop = regionStats(img, { x: 20, y: 300, w: 150, h: 480 });
    expect(backdrop.meanLuma).toBeLessThan(stroke.meanLuma - 40);
  });

  it("contain-blur: a sharp contained portrait over its dark blurred copy", async () => {
    const c = ft.layouts.find((x) => x.key === "contain-blur")!;
    const img = await shot(c.from + 20, "contain-blur");
    const side = regionStats(img, { x: 40, y: 200, w: 360, h: 680 });
    const centre = regionStats(img, { x: 700, y: 200, w: 520, h: 680 });
    expect(side.meanLuma).toBeLessThan(0.75 * centre.meanLuma);
    expect(side.meanLuma).toBeGreaterThan(3); // the blurred copy, not ink
  });

  it("split-left / split-right: the clip on its half, an accent divider in the middle", async () => {
    for (const key of ["split-left", "split-right"]) {
      const c = ft.layouts.find((x) => x.key === key)!;
      const img = await shot(c.from + 20, key);
      const [r, g, b] = regionStats(img, { x: 958, y: 100, w: 4, h: 880 }).meanRgb;
      expect(r, key).toBeGreaterThan(190);
      expect(g, key).toBeGreaterThan(150);
      expect(b, key).toBeLessThan(110);
    }
  });

  it("treatments: bw has no chroma (split-tone skipped), archival and duotone render", async () => {
    const at = (key: string) => ft.layouts.find((x) => x.key === key)!;
    const centre = { x: 300, y: 150, w: 1320, h: 780 };
    const bw = regionStats(await shot(at("bw").from + 20, "bw"), centre);
    const none = regionStats(await shot(at("none").from + 20, "none"), centre);
    expect(bw.meanChroma).toBeLessThan(5);
    expect(none.meanChroma).toBeGreaterThan(15);
    for (const key of ["archival", "duotone"]) expect(regionStats(await shot(at(key).from + 20, key), centre).lumaStd, key).toBeGreaterThan(5);
  });

  it("karaoke / rail / clip / translation captions render in the caption band", async () => {
    const band = ft.t.render.tokens.layout.zones.captionBand;
    for (const c of ft.captions) {
      const img = await shot(c.from + Math.min(c.dur - 1, 8), `cap-${c.variant}`, CAPTIONS_ONLY);
      expect(regionStats(img, band).opaqueShare, c.variant).toBeGreaterThan(0.01);
      expect(regionStats(img, { x: 0, y: 0, w: 1920, h: 600 }).opaqueShare, `${c.variant} stays in its band`).toBeLessThan(0.001);
    }
  });

  it("logged no errors", () => {
    expect(errorsOf(logs)).toEqual([]);
  });
});

describe("render worker path", () => {
  it("renders a chapter-aligned chunk through renderMedia (timelineUrl, h264-ts, muted, concurrency 2) to exactly its frames", async () => {
    const chunks = planChunks(computeTimeline(t), 300);
    const ch = chunks[1]!;
    const range: [number, number] = [ch.from, Math.min(ch.to, ch.from + 89)];
    const inputProps = { timeline: null, timelineUrl: `${server.url}/timeline.json`, assetBaseUrl: server.url, mode: "render", itemId: null, scratchBanner: false, layers: { ...LAYERS_ALL, audio: false } };
    const composition = await renderer.selectComposition({ serveUrl, id: "Documentary", inputProps, browserExecutable: exe, chromiumOptions, puppeteerInstance: browser, logLevel: "error" });
    const out = path.join(tmp.dir, "chunk.ts");
    const t0 = performance.now();
    let slowest: { frame: number; time: number }[] = [];
    await renderer.renderMedia({
      composition, serveUrl, inputProps, codec: "h264-ts", muted: true, frameRange: range, outputLocation: out, browserExecutable: exe, chromiumOptions,
      puppeteerInstance: browser, concurrency: 2, logLevel: "error", onSlowestFrames: (s) => { slowest = s.map((x) => ({ frame: x.frame, time: Math.round(x.time) })); },
    });
    const n = range[1] - range[0] + 1;
    const ms = performance.now() - t0;
    console.log(`renderMedia ${n} frames in ${Math.round(ms)} ms (${(n / (ms / 1000)).toFixed(1)} fps); slowest`, slowest.slice(0, 4));
    const probe = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames,width,height", "-of", "csv=p=0", out], { encoding: "utf8" });
    const [w, h, frames] = probe.stdout.trim().split(",").map((x) => parseInt(x, 10));
    expect([w, h]).toEqual([1920, 1080]);
    expect(frames).toBe(n);
  });
});

describe("determinism", () => {
  it("renders frames twice (sequential, then 2 in parallel) to identical PNGs", async () => {
    const frames = [0, 37, 74, 120, 290, 360];
    const a: string[] = [];
    for (const f of frames) a.push(sha(await still(f, { timelineUrl: true, name: "det-a" })));
    const b: string[] = new Array<string>(frames.length);
    for (let i = 0; i < frames.length; i += 2) {
      const pair = frames.slice(i, i + 2);
      const files = await Promise.all(pair.map((f) => still(f, { timelineUrl: true, name: "det-b" })));
      files.forEach((file, j) => (b[i + j] = sha(file)));
    }
    expect(b).toEqual(a);
  });
});
