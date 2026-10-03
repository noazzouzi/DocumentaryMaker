// conformForNle + writeExportBundle on real files (ffmpeg): single source of truth for framing (pixel check from
// VisualSource.crop / focal), picks.json is never opened (fs spy), audio conform, mirrored RL sweeps, hardlinks,
// cache + stale cleanup, and a full bundle that passes the DTDs. Skipped when ffmpeg/ffprobe are missing.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { P, type Timeline } from "@docmaker/core";
import { createLogger, loadRuntime, readWav, readWavHeader } from "@docmaker/core/node";
import { makeTimeline } from "@docmaker/core/testing";
import {
  conformForNle, exportReadme, mirroredSfxKey, pictureKey, stemKey, writeExportBundle, type ConformMap, type ExportCtx,
} from "../src/index";
import { HAS_FFMPEG, HAS_XMLLINT, xmllint } from "./helpers";

const touched = vi.hoisted(() => [] as string[]);
vi.mock("node:fs/promises", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs/promises")>();
  const spy = <F extends (...a: never[]) => unknown>(fn: F) => ((...a: Parameters<F>) => { touched.push(String(a[0])); return fn(...a); }) as F;
  return { ...orig, default: orig, readFile: spy(orig.readFile), open: spy(orig.open), stat: spy(orig.stat), copyFile: spy(orig.copyFile), link: spy(orig.link), readdir: spy(orig.readdir) };
});
vi.mock("node:fs", async (importOriginal) => {
  const orig = await importOriginal<typeof import("node:fs")>();
  const spy = <F extends (...a: never[]) => unknown>(fn: F) => ((...a: Parameters<F>) => { touched.push(String(a[0])); return fn(...a); }) as F;
  return { ...orig, default: orig, readFileSync: spy(orig.readFileSync), openSync: spy(orig.openSync), createReadStream: spy(orig.createReadStream) };
});

const ff = (args: string[]) => execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "pipe" });
/** Mean RGB of a picture over a grid of cells (decoded by ffmpeg). */
function cells(file: string, cols: number, rows: number): [number, number, number][] {
  const raw = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", `scale=${cols}:${rows}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const out: [number, number, number][] = [];
  for (let i = 0; i < cols * rows; i++) out.push([raw[i * 3]!, raw[i * 3 + 1]!, raw[i * 3 + 2]!]);
  return out;
}
const near = (c: [number, number, number], ref: [number, number, number], tol = 40) => c.every((v, i) => Math.abs(v - ref[i]!) <= tol);
const RED: [number, number, number] = [255, 0, 0];
const GREEN: [number, number, number] = [0, 255, 0];
const BLUE: [number, number, number] = [0, 0, 255];
const YELLOW: [number, number, number] = [255, 255, 0];

describe.skipIf(!HAS_FFMPEG)("conformForNle on real media", () => {
  const root = path.join(os.tmpdir(), `w9-conform-${process.pid}`);
  const projectDir = path.join(root, "Projet tulipes é");
  const exportDir = path.join(projectDir, "export", "en");
  let t: Timeline;
  let ctx: ExportCtx;
  let conformed: ConformMap;
  let cropClipId = "";
  let focalClipId = "";
  const logs: string[] = [];

  beforeAll(async () => {
    mkdirSync(projectDir, { recursive: true });
    const { config } = loadRuntime({ env: { ...process.env, DOCMAKER_HOME: path.join(root, "home"), DOCMAKER_PROJECTS: path.join(root, "projects") } });
    ctx = { config, logger: createLogger({ level: "debug", sink: (l) => logs.push(l) }), signal: new AbortController().signal };
    t = makeTimeline({ seconds: 12 });
    // decoy: the exporter must never read the asset picks
    mkdirSync(path.join(projectDir, "assets"), { recursive: true });
    writeFileSync(path.join(projectDir, P.picks), "{ not json");
    // a 1600×1200 picture with four coloured quadrants: TL red, TR green, BL blue, BR yellow
    const quad = path.join(root, "quad.png");
    ff(["-f", "lavfi", "-i", "color=red:s=800x600", "-f", "lavfi", "-i", "color=0x00FF00:s=800x600", "-f", "lavfi", "-i", "color=blue:s=800x600", "-f", "lavfi", "-i", "color=yellow:s=800x600",
      "-filter_complex", "[0][1]hstack[t];[2][3]hstack[b];[t][b]vstack", "-frames:v", "1", quad]);
    for (const a of Object.values(t.assets)) {
      const f = path.join(projectDir, a.projectRel);
      mkdirSync(path.dirname(f), { recursive: true });
      if (a.kind === "image") {
        ff(["-i", quad, "-q:v", "2", f]);
        a.width = 1600;
        a.height = 1200;
      } else if (a.kind === "video") {
        ff(["-f", "lavfi", "-i", "testsrc2=s=1280x720:r=25:d=3", "-f", "lavfi", "-i", "sine=f=330:d=3:sample_rate=44100", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", f]);
      } else if (a.id === t.audio.music[0]?.assetId) {
        ff(["-f", "lavfi", "-i", "sine=f=220:d=4:sample_rate=48000", "-ac", "2", "-c:a", "pcm_s16le", f]); // already conformed → hardlink
      } else if (t.audio.sfx.some((s) => s.assetId === a.id)) {
        ff(["-f", "lavfi", "-i", "sine=f=880:d=1:sample_rate=48000", "-af", "pan=stereo|c0=c0|c1=0*c0", "-c:a", "pcm_s16le", f]); // left only
      } else {
        ff(["-f", "lavfi", "-i", "sine=f=440:d=2:sample_rate=44100", "-c:a", "pcm_s16le", f]); // 44.1 kHz VO
      }
    }
    // framing under test: an explicit crop (top-right quadrant) and a focal point (bottom-left)
    const imgs = t.video.filter((c) => c.source.kind === "image");
    const [a, b] = [imgs[0]!, imgs.find((c) => c.source.kind === "image" && c.id !== imgs[0]!.id && c.source.assetId !== (imgs[0]!.source as { assetId: string }).assetId) ?? imgs[1]!];
    a.layout = "cover";
    b.layout = "cover";
    a.source = { ...(a.source as Extract<Timeline["video"][number]["source"], { kind: "image" }>), crop: { x: 0.5, y: 0, w: 0.5, h: 0.5 } };
    b.source = { ...(b.source as Extract<Timeline["video"][number]["source"], { kind: "image" }>), crop: null, focal: { x: 0, y: 1 } };
    cropClipId = a.id;
    focalClipId = b.id;
    if (t.audio.sfx[0]) t.audio.sfx[0].panSweep = "RL";
    const stems: Record<string, string> = {};
    for (const s of ["vo", "music", "sfx", "clip"]) {
      const f = path.join(projectDir, P.stem("en", s as "vo"));
      mkdirSync(path.dirname(f), { recursive: true });
      ff(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "12", "-c:a", "pcm_s16le", f]);
      stems[s] = f;
    }
    touched.length = 0;
    conformed = await conformForNle(t, { projectDir, exportDir, generatedStills: {}, overlays: null, stems }, ctx);
  }, 120_000);

  afterAll(() => {
    if (existsSync(root)) execFileSync("rm", ["-rf", root]);
  });

  it("never opens picks.json (the Timeline is the single source of truth)", () => {
    expect(touched.length).toBeGreaterThan(0);
    expect(touched.filter((p) => /picks\.json/.test(p))).toEqual([]);
  });

  it("the crop rect of VisualSource is what the conformed still shows (pixel check)", () => {
    const clip = t.video.find((c) => c.id === cropClipId)!;
    const cm = conformed[pictureKey(clip)]!;
    expect(cm.kind).toBe("image");
    expect([cm.width, cm.height]).toEqual([1920, 1080]);
    const px = cells(cm.localPath, 8, 4);
    expect(px.every((c) => near(c, GREEN))).toBe(true);
  });

  it("without a crop the cover window follows the focal point", () => {
    const clip = t.video.find((c) => c.id === focalClipId)!;
    const px = cells(conformed[pictureKey(clip)]!.localPath, 4, 4);
    // 1600×1200 covered to 1920×1440, window anchored at the bottom: top row still in the red/green half
    expect(near(px[0]!, RED)).toBe(true);
    expect(near(px[3]!, GREEN)).toBe(true);
    expect(near(px[12]!, BLUE)).toBe(true);
    expect(near(px[15]!, YELLOW)).toBe(true);
  });

  it("every file has a unique ASCII-safe NNN_slug_id8 name; stems live in stems/", () => {
    const names = readdirSync(path.join(exportDir, "media")).filter((f) => !f.startsWith("."));
    expect(names.length).toBeGreaterThan(3);
    for (const n of names) expect(n).toMatch(/^\d{3}_[a-z0-9-]+_[0-9a-f]{8}\.(jpg|png|mp4|wav)$/);
    expect(new Set(names).size).toBe(names.length);
    for (const s of ["vo", "music", "sfx", "clip"]) expect(conformed[stemKey(s)]!.localPath).toBe(path.join(exportDir, "stems", `${s}.wav`));
  });

  it("generated sources get a 1920×1080 PNG even without a rendered still", () => {
    const g = t.video.find((c) => c.source.kind === "generated");
    if (!g) return;
    const cm = conformed[`gen:${g.id}`]!;
    expect(cm.localPath.endsWith(".png")).toBe(true);
    expect([cm.width, cm.height]).toEqual([1920, 1080]);
  });

  it("video is re-framed to 1920×1080 at the timeline fps", () => {
    const v = t.video.find((c) => c.source.kind === "video");
    if (!v) return;
    const cm = conformed[pictureKey(v)]!;
    expect([cm.kind, cm.width, cm.height]).toEqual(["video", 1920, 1080]);
    const fps = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", cm.localPath]).toString().trim();
    expect(fps).toBe(`${t.fps}/1`);
  });

  it("audio becomes 48 kHz PCM WAV (VO mono); conformed WAVs are hardlinked, not copied", async () => {
    const vo = conformed[t.audio.vo[0]!.assetId]!;
    const h = await readWavHeader(vo.localPath);
    expect([h.sampleRate, h.channels, h.bitsPerSample]).toEqual([48000, 1, 16]);
    expect(vo.durationFrames).toBe(Math.round(2 * t.fps));
    const mus = t.audio.music[0]!;
    const src = path.join(projectDir, t.assets[mus.assetId]!.projectRel);
    expect(statSync(conformed[mus.assetId]!.localPath).ino).toBe(statSync(src).ino);
  });

  it("RL pan sweeps use a channel-mirrored copy", async () => {
    const s = t.audio.sfx[0];
    if (!s) return;
    const w = await readWav(conformed[mirroredSfxKey(s.assetId)]!.localPath);
    const rms = (ch: Float32Array) => Math.sqrt(ch.reduce((a, v) => a + v * v, 0) / ch.length);
    expect(rms(w.data[0]!)).toBeLessThan(0.001);
    expect(rms(w.data[1]!)).toBeGreaterThan(0.05);
  });

  it("a second run reuses every conformed file; dropped media are cleaned up", async () => {
    const files = Object.values(conformed).map((c) => c.localPath);
    const before = files.map((f) => statSync(f).mtimeMs);
    const again = await conformForNle(t, { projectDir, exportDir, generatedStills: {}, overlays: null, stems: {} }, ctx);
    const nonStem = Object.keys(conformed).filter((k) => !k.startsWith("stem:"));
    expect(Object.keys(again)).toEqual(nonStem);
    for (const k of nonStem) {
      expect(again[k]!.localPath).toBe(conformed[k]!.localPath);
      expect(statSync(again[k]!.localPath).mtimeMs).toBe(before[files.indexOf(conformed[k]!.localPath)]);
    }
    // remove one picture clip's framing → its file disappears on the next run
    const t2 = structuredClone(t);
    const victim = t2.video.find((c) => c.id === cropClipId)!;
    const victimFile = conformed[pictureKey(victim)]!.localPath;
    victim.source = { ...(victim.source as Extract<Timeline["video"][number]["source"], { kind: "image" }>), crop: { x: 0, y: 0.5, w: 0.5, h: 0.5 } };
    const third = await conformForNle(t2, { projectDir, exportDir, generatedStills: {}, overlays: null, stems: {} }, ctx);
    expect(existsSync(victimFile)).toBe(false);
    expect(cells(third[pictureKey(victim)]!.localPath, 4, 2).every((c) => near(c, BLUE))).toBe(true);
    conformed = await conformForNle(t, { projectDir, exportDir, generatedStills: {}, overlays: null, stems: Object.fromEntries(["vo", "music", "sfx", "clip"].map((s) => [s, path.join(projectDir, P.stem("en", s as "vo"))])) }, ctx);
  }, 120_000);

  it("missing source files degrade to a warning (no throw)", async () => {
    const t2 = structuredClone(t);
    const a = Object.values(t2.assets).find((x) => x.kind === "image")!;
    a.projectRel = "media/does-not-exist.jpg";
    const m = await conformForNle(t2, { projectDir, exportDir: path.join(root, "export-missing"), generatedStills: {}, overlays: null, stems: {} }, ctx);
    expect(m[a.id]).toBeUndefined();
    expect(logs.some((l) => /could not conform/.test(l))).toBe(true);
  }, 120_000);

  it("writeExportBundle writes every selected format (DTD-valid) and removes deselected ones", async () => {
    const formats = ["fcpxml", "xmeml-premiere", "xmeml-resolve", "otio", "markers-edl", "srt", "stems", "reference-mp4"] as const;
    const readme = exportReadme({ t, formats: [...formats], exportRoot: null, asOf: "2026-10-01", hasReference: false, lang: "en" });
    const r = await writeExportBundle({ t, projectDir, exportDir, formats: [...formats], exportRoot: null, fcpxmlVersion: "1.10", conformed, referenceMp4: null, credits: "# Credits\n", publishKit: null, editorialReport: null, readme }, ctx);
    const base = `${t.projectSlug}.en`;
    for (const f of [`${base}.fcpxml`, `${base}.premiere.xml`, `${base}.resolve.xml`, `${base}.otio`, `${base}.markers.edl`, `${base}.srt`, "credits.md", "README.md"]) {
      expect(r.files).toContain(path.join(exportDir, f));
    }
    expect(existsSync(path.join(exportDir, "reference.mp4"))).toBe(false);
    expect(r.files.filter((f) => f.includes(`${path.sep}stems${path.sep}`))).toHaveLength(4);
    const otio = JSON.parse(execFileSync("cat", [path.join(exportDir, `${base}.otio`)]).toString());
    expect(otio.OTIO_SCHEMA).toBe("Timeline.1");
    if (HAS_XMLLINT) {
      const read = (f: string) => execFileSync("cat", [path.join(exportDir, f)]).toString();
      expect(xmllint(read(`${base}.fcpxml`), "fcpxml-1.10.dtd")).toBe("");
      expect(xmllint(read(`${base}.premiere.xml`), "xmeml_dtd_4_premiere.dtd")).toBe("");
      expect(xmllint(read(`${base}.resolve.xml`), "xmeml_dtd_4.dtd")).toBe("");
      // media paths with a space and an accent are percent-encoded
      expect(read(`${base}.fcpxml`)).toContain("Projet%20tulipes%20%C3%A9/export/en/media/");
    }
    // a reference render is hardlinked; deselected formats are removed
    const ref = path.join(root, "final.mp4");
    ff(["-f", "lavfi", "-i", "color=black:s=320x180:d=1", "-c:v", "libx264", "-preset", "ultrafast", ref]);
    const r2 = await writeExportBundle({ t, projectDir, exportDir, formats: ["fcpxml", "reference-mp4"], exportRoot: "/Volumes/Edit", fcpxmlVersion: "1.11", conformed, referenceMp4: ref, credits: "# Credits\n", publishKit: "# Publish\n", editorialReport: null, readme }, ctx);
    expect(statSync(path.join(exportDir, "reference.mp4")).ino).toBe(statSync(ref).ino);
    expect(existsSync(path.join(exportDir, `${base}.premiere.xml`))).toBe(false);
    expect(existsSync(path.join(exportDir, "stems"))).toBe(false);
    expect(r2.files).toContain(path.join(exportDir, "publish.en.md"));
    const fcp = execFileSync("cat", [path.join(exportDir, `${base}.fcpxml`)]).toString();
    expect(fcp).toContain('<fcpxml version="1.11">');
    expect(fcp).toContain('src="file:///Volumes/Edit/media/');
    expect(fcp).not.toContain("stems/");
  }, 120_000);
});
