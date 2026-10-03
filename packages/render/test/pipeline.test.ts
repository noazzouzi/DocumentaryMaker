// ffmpeg half of the render flow on synthetic muted h264-ts chunks: concat (stream copy, frame-exact), master post
// (lut3d + grain), master mux with the exact program length.
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { concatChunks } from "../src/concat";
import { countVideoFrames } from "../src/ff";
import { generateLutCube } from "../src/lut";
import { muxMaster } from "../src/mux";
import { masterPost } from "../src/post";
import { ffmpegSync, makeTsChunk, probeFrames, probeJson, quietLogger, testConfig, tmpDir } from "./helpers";

const signal = new AbortController().signal;

describe("concat → post → mux", () => {
  it("concatenates 40+40+35 frames into exactly 115 frames (3.8333 s) without re-encoding", async () => {
    const t = await tmpDir();
    try {
      const config = testConfig(t.dir);
      const files = [40, 40, 35].map((n, i) => {
        const f = path.join(t.dir, `c${i}.ts`);
        makeTsChunk(f, n, { color: ["red", "green", "blue"][i] });
        return f;
      });
      const out = path.join(t.dir, "video.mp4");
      const pcts: number[] = [];
      const r = await concatChunks(files, out, { config, signal, logger: quietLogger(), expectedFrames: 115, fps: 30, x264Preset: "veryfast", crf: 23, onProgress: (p) => pcts.push(p) });
      expect(r).toEqual({ frames: 115, reencoded: false });
      expect(probeFrames(out)).toBe(115);
      expect(await countVideoFrames(out, { config, signal })).toBe(115);
      const p = probeJson(out);
      expect(p.streams.filter((s) => s.codec_type === "audio")).toHaveLength(0);
      expect(Number(p.format.duration)).toBeCloseTo(115 / 30, 2);
      expect((await readdir(t.dir)).filter((f) => f.includes("tmp") || f.endsWith(".txt"))).toEqual([]);
    } finally {
      await t.cleanup();
    }
  });

  it("re-encodes when stream copy is not frame-exact, and fails when even that cannot match", async () => {
    const t = await tmpDir();
    try {
      const config = testConfig(t.dir);
      const a = path.join(t.dir, "a.ts");
      makeTsChunk(a, 30);
      const out = path.join(t.dir, "video.mp4");
      // expecting fewer frames than the chunks hold → the re-encode path trims to the exact count
      const r = await concatChunks([a], out, { config, signal, logger: quietLogger(), expectedFrames: 25, fps: 30, x264Preset: "veryfast", crf: 23 });
      expect(r).toEqual({ frames: 25, reencoded: true });
      expect(probeFrames(out)).toBe(25);
      await expect(concatChunks([a], out, { config, signal, logger: quietLogger(), expectedFrames: 45, fps: 30, x264Preset: "veryfast", crf: 23 }))
        .rejects.toMatchObject({ code: "RENDER_FAILED" });
    } finally {
      await t.cleanup();
    }
  });

  it("master post applies the LUT and grain and keeps the frame count", async () => {
    const t = await tmpDir();
    try {
      const config = testConfig(t.dir);
      const src = path.join(t.dir, "in.mp4");
      ffmpegSync(["-f", "lavfi", "-i", "color=c=gray:s=160x90:r=30", "-frames:v", "20", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", src]);
      const cube = path.join(t.dir, "dir with 'quote'", "warm.cube");
      await generateLutCube({ contrast: 0, saturation: 0, vibrance: 0, shadows: [0, 0, 0], highlights: [0, 0, 0], blacks: 0.3, whites: 0, temp: 0.5, intensity: 0 }, cube);
      const out = path.join(t.dir, "post.mp4");
      expect(await masterPost(src, out, { lutCube: cube, grain: 6, config, signal, totalMs: 666 })).toBe(true);
      expect(probeFrames(out)).toBe(20);
      // warm + lifted → red channel above blue on a grey source
      const px = path.join(t.dir, "px.rgb");
      ffmpegSync(["-i", out, "-frames:v", "1", "-vf", "scale=1:1", "-f", "rawvideo", "-pix_fmt", "rgb24", px]);
      const { readFile } = await import("node:fs/promises");
      const [r, , b] = [...(await readFile(px))];
      expect(r! - b!).toBeGreaterThan(20);
      expect(await masterPost(src, path.join(t.dir, "none.mp4"), { lutCube: null, grain: 0, config, signal, totalMs: 666 })).toBe(false);
      expect(existsSync(path.join(t.dir, "none.mp4"))).toBe(false);
    } finally {
      await t.cleanup();
    }
  });

  it("muxes the mix (or silence) with the exact program length", async () => {
    const t = await tmpDir();
    try {
      const config = testConfig(t.dir);
      const v = path.join(t.dir, "v.mp4");
      ffmpegSync(["-f", "lavfi", "-i", "color=c=black:s=160x90:r=30", "-frames:v", "115", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", v]);
      const shortMix = path.join(t.dir, "mix.wav");
      ffmpegSync(["-f", "lavfi", "-i", "sine=f=440:r=48000:d=2", "-ac", "2", "-c:a", "pcm_s24le", shortMix]);
      const out = path.join(t.dir, "final.mp4");
      await muxMaster(v, shortMix, out, { frames: 115, fps: 30, startFrame: 0, config, signal });
      const p = probeJson(out);
      const a = p.streams.find((s) => s.codec_type === "audio")!;
      expect(a.codec_name).toBe("aac");
      expect(a.sample_rate).toBe("48000");
      expect(a.channels).toBe(2);
      expect(probeFrames(out)).toBe(115);
      expect(Number(p.format.duration)).toBeGreaterThan(3.8);
      expect(Number(p.format.duration)).toBeLessThan(3.87);
      expect(Number(a.duration)).toBeGreaterThan(3.8); // a short mix is padded
      const silent = path.join(t.dir, "silent.mp4");
      await muxMaster(v, null, silent, { frames: 115, fps: 30, startFrame: 0, config, signal });
      const s = probeJson(silent);
      expect(s.streams.map((x) => x.codec_type).sort()).toEqual(["audio", "video"]);
      expect(Number(s.format.duration)).toBeLessThan(3.87);
    } finally {
      await t.cleanup();
    }
  });

  it("aborting kills ffmpeg and leaves no partial output", async () => {
    const t = await tmpDir();
    try {
      const config = testConfig(t.dir);
      const v = path.join(t.dir, "big.mp4");
      ffmpegSync(["-f", "lavfi", "-i", "testsrc2=s=640x360:r=30", "-frames:v", "900", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", v]);
      const ac = new AbortController();
      const p = masterPost(v, path.join(t.dir, "out.mp4"), { lutCube: null, grain: 16, config, signal: ac.signal, totalMs: 30_000 });
      setTimeout(() => ac.abort(), 150);
      await expect(p).rejects.toMatchObject({ code: "CANCELED" });
      expect((await readdir(t.dir)).filter((f) => f !== "big.mp4")).toEqual([]);
    } finally {
      await t.cleanup();
    }
  });
});
