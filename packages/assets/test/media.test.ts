// Media tests on the installed ffmpeg/sharp: every procedural recipe, conform recipes (CFR, GOP, handles), cache, freeze.
import { existsSync, statSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { FrozenAsset } from "@docmaker/core";
import { ffmpeg, ffprobeJson, run, sha256File } from "@docmaker/core/node";
import {
  conformAudio, conformClip, conformImage, conformVideo, createProceduralProvider, freezeFile, FrozenCache, PROCEDURAL_RECIPES, proceduralAsset, recipeFor, trimWindow,
} from "../src/index";
import { cleanup, makeCtx, quietLogger, tmpDir } from "./helpers";

const ctx = makeCtx();
const work = tmpDir("media");
afterAll(() => cleanup(work, ctx.config.paths.home));
const signal = new AbortController().signal;
const PALETTE = ["#0e0f12", "#e8b13a", "#3a5a8c"];

const l2 = (x: number) => Number.isFinite(x);
async function keyframeTimes(file: string): Promise<number[]> {
  const r = await run(ctx.config.ffprobe, ["-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time", "-of", "csv=p=0", file], { signal });
  return r.stdout.split("\n").filter((l) => l.trim() !== "").map((l) => Number(l.trim().replace(/,$/, ""))).filter((x) => l2(x)).sort((a, b) => a - b);
}

describe("procedural recipes (§7.9) execute on ffmpeg", () => {
  it("covers the five spec recipes and keeps gradients speed > 0", () => {
    expect(PROCEDURAL_RECIPES.map((r) => r.id)).toEqual(["gradient-grid", "archive-still", "drift-gradient", "life-texture", "scanline-news", "paper-drift"]);
    const args = PROCEDURAL_RECIPES[0]!.args({ seed: 1, palette: PALETTE, fps: 30, seconds: 1 }).join(" ");
    expect(args).toContain("speed=0.00001");
    expect(args).not.toMatch(/speed=0[:,\s]/);
  });

  for (const r of PROCEDURAL_RECIPES) {
    it(`renders ${r.id}`, async () => {
      const out = await proceduralAsset({ recipe: r.id, seed: 2_900_000_123, palette: PALETTE, fps: 30, seconds: 1.5, outDir: path.join(work, "proc") }, ctx);
      const p = await ffprobeJson(out, { config: ctx.config, signal });
      const v = p.streams.find((s) => s.codecType === "video")!;
      expect(v.width).toBe(1920);
      expect(v.height).toBe(1080);
      if (r.kind === "video") {
        expect(out.endsWith(".mp4")).toBe(true);
        expect(p.durationSec).toBeGreaterThan(1.3);
        expect(v.pixFmt).toBe("yuv420p");
      } else {
        expect(out.endsWith(".png")).toBe(true);
      }
    }, 60_000);
  }

  it("fallbacks carry structure and a muted palette (no flat vignette, no dead-signal speckles, no saturated primaries)", async () => {
    const LOUD = ["#14110f", "#E8412F", "#2F3CFF"]; // drama-commentary ink / accent / secondary
    for (let seed = 0; seed < 8; seed++) {
      expect(recipeFor("video", "broll", seed)).not.toBe("life-texture");
    }
    const chroma = async (file: string) => {
      const { data } = await sharp(file).resize(64, 36, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let sum = 0;
      for (let k = 0; k < data.length; k += 3) sum += (Math.max(data[k]!, data[k + 1]!, data[k + 2]!) - Math.min(data[k]!, data[k + 1]!, data[k + 2]!)) / 255;
      return sum / (data.length / 3);
    };
    const still = await proceduralAsset({ recipe: "archive-still", seed: 11, palette: LOUD, fps: 30, seconds: 1, outDir: path.join(work, "look") }, ctx);
    const st = await sharp(still).greyscale().stats();
    expect(st.channels[0]!.stdev).toBeGreaterThan(12); // stains, rules and frame: something for the camera to move over
    const grid = await proceduralAsset({ recipe: "gradient-grid", seed: 11, palette: LOUD, fps: 30, seconds: 1, outDir: path.join(work, "look") }, ctx);
    expect(await chroma(grid)).toBeLessThan(0.35);
    const drift = await proceduralAsset({ recipe: "drift-gradient", seed: 11, palette: LOUD, fps: 30, seconds: 1.5, outDir: path.join(work, "look") }, ctx);
    const frame = path.join(work, "look", "drift.png");
    await ffmpeg(["-y", "-ss", "1", "-i", drift, "-frames:v", "1", frame], { config: ctx.config, signal });
    expect(await chroma(frame)).toBeLessThan(0.35);
  }, 120_000);

  it("is deterministic per seed and differs across seeds", async () => {
    const a = await proceduralAsset({ recipe: "gradient-grid", seed: 7, palette: PALETTE, fps: 30, seconds: 1, outDir: path.join(work, "det1") }, ctx);
    const b = await proceduralAsset({ recipe: "gradient-grid", seed: 7, palette: PALETTE, fps: 30, seconds: 1, outDir: path.join(work, "det2") }, ctx);
    const c = await proceduralAsset({ recipe: "gradient-grid", seed: 8, palette: PALETTE, fps: 30, seconds: 1, outDir: path.join(work, "det3") }, ctx);
    expect(await sha256File(a)).toBe(await sha256File(b));
    expect(await sha256File(c)).not.toBe(await sha256File(a));
  }, 60_000);

  it("procedural provider candidates are seeded by beatId:slot", async () => {
    const p = createProceduralProvider({ palette: PALETTE });
    const q = { beatId: "CH1-B001", kind: "image" as const, role: "archival" as const, text: "x", localText: null, entityQid: null, personIds: [], orientation: "landscape" as const, minWidth: 0, durationSec: null, limit: 3, lang: null };
    const r1 = await p.search(q, { secrets: {}, config: ctx.config, logger: quietLogger(), http: ctx.http, signal });
    const r2 = await p.search(q, { secrets: {}, config: ctx.config, logger: quietLogger(), http: ctx.http, signal });
    expect(r1.map((x) => x.candidate.providerAssetId)).toEqual(r2.map((x) => x.candidate.providerAssetId));
    expect(new Set(r1.map((x) => x.candidate.providerAssetId)).size).toBe(3);
    expect(r1[0]!.candidate.license.code).toBe("PROCEDURAL");
    expect(r1[0]!.candidate.tags).toContain("archive-still");
  });
});

describe("conform recipes", () => {
  it("image-v1: EXIF rotate, long edge ≤ 2880 without upscaling, JPEG q90, analysis", async () => {
    const big = path.join(work, "big.jpg");
    await sharp({ create: { width: 4000, height: 2000, channels: 3, background: { r: 200, g: 40, b: 40 } } }).jpeg().withMetadata({ orientation: 6 }).toFile(big);
    const r = await conformImage(big, work, ctx);
    expect(r.ext).toBe("jpg");
    // orientation 6 = rotate 90° → portrait after auto-orient, long edge 2880
    expect([r.width, r.height]).toEqual([1440, 2880]);
    expect(r.analysis.grayscale).toBe(false);
    expect(r.analysis.lowRes).toBe(false);
    expect(r.recipe).toBe("image-v1");
    const meta = await sharp(r.file).metadata();
    expect(meta.exif).toBeUndefined(); // metadata stripped

    const small = path.join(work, "small.png");
    await sharp({ create: { width: 800, height: 600, channels: 4, background: { r: 120, g: 120, b: 120, alpha: 0.5 } } }).png().toFile(small);
    const s = await conformImage(small, work, ctx);
    expect(s.ext).toBe("png"); // alpha kept
    expect([s.width, s.height]).toEqual([800, 600]); // no upscaling
    expect(s.analysis.grayscale).toBe(true);
    expect(s.analysis.lowRes).toBe(true);
    expect(s.analysis.meanLuma).toBeGreaterThan(0.4);
  });

  it("video-cfr-v1: CFR at the project fps, GOP = fps, 1 s handles clamped to the source", async () => {
    const src = path.join(work, "vfr-src.mp4");
    // 6 s 25 fps source with odd width; we ask for 30 fps output.
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=s=1281x721:r=25:d=6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", src], { config: ctx.config, signal });
    const r = await conformVideo(src, work, { fps: 30, inMs: 2000, outMs: 4000, handleMs: 1000 }, ctx);
    expect(r.recipe).toBe("video-cfr-v1");
    expect([r.sourceInMs, r.sourceOutMs, r.handleHeadMs, r.handleTailMs]).toEqual([1000, 5000, 1000, 1000]);
    const p = await ffprobeJson(r.file, { config: ctx.config, signal, countFrames: true });
    const v = p.streams.find((s) => s.codecType === "video")!;
    expect(v.codecName).toBe("h264");
    expect(v.fps).toBe(30);
    expect(v.width! % 2).toBe(0);
    expect(p.streams.some((s) => s.codecType === "audio")).toBe(false);
    expect(Math.abs(p.durationSec - 4)).toBeLessThan(0.1);
    expect(v.nbFrames).toBe(120);
    const kf = await keyframeTimes(r.file);
    expect(kf.slice(0, 4).map((t) => Math.round(t * 10) / 10)).toEqual([0, 1, 2, 3]);

    const head = await conformVideo(src, work, { fps: 30, inMs: 300, outMs: 5800, handleMs: 1000 }, ctx);
    expect([head.handleHeadMs, head.handleTailMs]).toEqual([300, 200]);
    expect(trimWindow(6000, null, null, 1000)).toEqual({ startMs: 0, endMs: 6000, headMs: 0, tailMs: 0 });
  }, 60_000);

  it("clip-v1: audio AAC 48 kHz stereo at −18 LUFS, passage inside the conformed file", async () => {
    const src = path.join(work, "clip-src.mp4");
    await ffmpeg([
      "-f", "lavfi", "-i", "testsrc2=s=640x360:r=30:d=8", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:d=8",
      "-filter_complex", "[1:a]volume='if(lt(t,4),0.05,0.4)':eval=frame[a]", "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", src,
    ], { config: ctx.config, signal });
    const r = await conformClip(src, work, { fps: 30, passageInMs: 3000, passageOutMs: 6000, handleMs: 1000 }, ctx);
    expect([r.passageInMs, r.passageOutMs]).toEqual([1000, 4000]);
    expect(r.hasAudio).toBe(true);
    expect(r.lufs!).toBeGreaterThan(-19.5);
    expect(r.lufs!).toBeLessThan(-16.5);
    const p = await ffprobeJson(r.file, { config: ctx.config, signal });
    const a = p.streams.find((s) => s.codecType === "audio")!;
    expect([a.codecName, a.sampleRate, a.channels]).toEqual(["aac", 48000, 2]);
    expect(p.streams.find((s) => s.codecType === "video")!.fps).toBe(30);
    // A passage entirely beyond the end of the media is refused (not a 1 s clip of handle with an empty passage).
    await expect(conformClip(src, work, { fps: 30, passageInMs: 9000, passageOutMs: 10_000, handleMs: 1000 }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(conformClip(src, work, { fps: 30, passageInMs: 7980, passageOutMs: 9000, handleMs: 1000 }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  }, 90_000);

  it("audio-norm-v1: 48 kHz stereo s16 WAV at the target", async () => {
    const src = path.join(work, "tone.wav");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=220:sample_rate=22050:d=5", "-af", "volume='0.1+0.3*t/5':eval=frame", src], { config: ctx.config, signal });
    const r = await conformAudio(src, work, { targetLufs: -18 }, ctx);
    const p = await ffprobeJson(r.file, { config: ctx.config, signal });
    expect([p.streams[0]!.codecName, p.streams[0]!.sampleRate, p.streams[0]!.channels]).toEqual(["pcm_s16le", 48000, 2]);
    expect(Math.abs(r.lufs! + 18)).toBeLessThan(1.5);
  }, 60_000);
});

describe("FrozenCache + freezeFile", () => {
  it("content-addresses blobs, links into projects and evicts LRU except referenced", async () => {
    const config = ctx.config;
    const cache = new FrozenCache({ config, logger: quietLogger() });
    const files: string[] = [];
    for (let k = 0; k < 3; k++) {
      const f = path.join(work, `blob${k}.bin`);
      await writeFile(f, Buffer.alloc(1000 + k, k + 1));
      files.push(f);
    }
    const a = await cache.put(files[0]!, "jpg");
    const again = await cache.put(files[0]!, "jpg");
    expect(again).toEqual(a);
    expect(a.cacheRel).toBe(`blobs/${a.sha256.slice(0, 2)}/${a.sha256}.jpg`);
    expect(await cache.has(a.sha256)).toBe(true);
    const proj = tmpDir("proj");
    const rel = await cache.linkIntoProject(a.sha256, "jpg", proj);
    expect(rel).toBe(`media/${a.sha256}.jpg`);
    expect(statSync(path.join(proj, rel)).ino).toBe(statSync(cache.blobPath(a.sha256, "jpg")).ino); // hardlink
    expect(await cache.linkIntoProject(a.sha256, "jpg", proj)).toBe(rel); // idempotent
    await new Promise((r) => setTimeout(r, 5));
    const b = await cache.put(files[1]!, "jpg");
    await new Promise((r) => setTimeout(r, 5));
    const c = await cache.put(files[2]!, "jpg");
    // cap = 2 blobs; `a` is the oldest but referenced → `b` goes.
    const res = await cache.gc({ referenced: new Set([a.sha256]), capBytes: 2100 });
    expect(res.removed).toBe(1);
    expect(await cache.has(b.sha256)).toBe(false);
    expect(await cache.has(a.sha256)).toBe(true);
    expect(await cache.has(c.sha256)).toBe(true);
    const ix = JSON.parse(await readFile(cache.indexFile, "utf8"));
    expect(ix.blobs.map((x: { sha256: string }) => x.sha256).sort()).toEqual([a.sha256, c.sha256].sort());
    cleanup(proj);
  });

  it("freezes a conformed image into a schema-valid FrozenAsset", async () => {
    const src = path.join(work, "f.jpg");
    await sharp({ create: { width: 1600, height: 900, channels: 3, background: { r: 10, g: 200, b: 30 } } }).jpeg().toFile(src);
    const conf = await conformImage(src, work, ctx);
    const proj = tmpDir("proj");
    const a = await freezeFile({ file: src, kind: "image", role: "broll", candidate: null, declaration: { kind: "own-work", license: null, author: "Me", url: "", note: "" }, conform: conf, projectDir: proj, yearHint: 1925 }, ctx);
    expect(FrozenAsset.parse(a)).toEqual(a);
    expect(a.id).toBe(await sha256File(conf.file));
    expect(a.originalSha256).toBe(await sha256File(src));
    expect(a.analysis.year).toBe(1925);
    expect(existsSync(path.join(proj, a.projectRel))).toBe(true);
    expect((await stat(path.join(proj, a.projectRel))).size).toBe(a.bytes);
    cleanup(proj);
  });
});
