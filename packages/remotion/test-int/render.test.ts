// Render integration tests (§16.2, W7 rows): bundle once, then FontSpecimen, GlProbe, one still per M1 component
// (+ the card layout, FallbackCard, every M1 transition class) and render-twice determinism. Needs the shared Chrome
// Headless Shell; holds the machine-wide render lock for the whole file; concurrency ≤ 2.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COMPONENT_META, type Timeline } from "@docmaker/core";
import { computeTimeline } from "../src/compute/computeTimeline";
import { browserExecutable, bundleEntry, chromiumOptions, decodeRgba, enableDeterministicRaster, loadRemotion, makeTmp, regionStats, startAssetServer, writeJson, writeProjectMedia, type AssetServer } from "./helpers/harness";
import { acquireRenderLock } from "./helpers/lock";
import { buildTimeline } from "./helpers/timelines";

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

async function still(frame: number, o: { id?: string; layers?: typeof LAYERS_ALL; format?: "png" | "jpeg"; timelineUrl?: boolean; name?: string; logs?: Log[] } = {}): Promise<string> {
  const id = o.id ?? "Documentary";
  const inputProps = o.timelineUrl
    ? { timeline: null, timelineUrl: `${server.url}/timeline.json`, assetBaseUrl: server.url, mode: "render", itemId: null, scratchBanner: false, layers: o.layers ?? LAYERS_ALL }
    : { timeline: t, timelineUrl: null, assetBaseUrl: server.url, mode: "render", itemId: null, scratchBanner: false, layers: o.layers ?? LAYERS_ALL };
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
