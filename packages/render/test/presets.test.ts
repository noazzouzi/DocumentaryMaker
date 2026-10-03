import os from "node:os";
import { describe, expect, it } from "vitest";
import { PRESETS, presetRenderOptions, presetSize, resolveConcurrency } from "../src/presets";
import { chunksInRange, RENDER_LAYERS, OVERLAY_LAYERS } from "../src/service";
import { postFilter } from "../src/post";
import { muxArgs } from "../src/mux";
import { concatListLine } from "../src/concat";

describe("presets (§12.2)", () => {
  it("draft: half scale, veryfast, crf 23, jpeg 80, no post", () => {
    expect(presetRenderOptions("draft", { gpu: false })).toEqual({
      codec: "h264-ts", scale: 0.5, imageFormat: "jpeg", jpegQuality: 80, pixelFormat: "yuv420p", muted: true, x264Preset: "veryfast", crf: 23,
    });
    expect(PRESETS.draft.post).toBe(false);
    expect(presetSize("draft")).toEqual({ width: 960, height: 540 });
  });

  it("master: full scale, medium, crf 18, jpeg 92, post; GPU host → hardware acceleration + 10M, no crf", () => {
    expect(presetRenderOptions("master", { gpu: false })).toEqual({
      codec: "h264-ts", scale: 1, imageFormat: "jpeg", jpegQuality: 92, pixelFormat: "yuv420p", muted: true, x264Preset: "medium", crf: 18,
    });
    const gpu = presetRenderOptions("master", { gpu: true });
    expect(gpu.hardwareAcceleration).toBe("if-possible");
    expect(gpu.videoBitrate).toBe("10M");
    expect(gpu.crf).toBeUndefined();
    expect(PRESETS.master.post).toBe(true);
    expect(presetSize("master")).toEqual({ width: 1920, height: 1080 });
    // draft never gets the GPU bitrate switch
    expect(presetRenderOptions("draft", { gpu: true }).crf).toBe(23);
  });

  it("overlay: ProRes 4444 with alpha, png frames, muted", () => {
    expect(presetRenderOptions("overlay", { gpu: false })).toEqual({
      codec: "prores", scale: 1, imageFormat: "png", pixelFormat: "yuva444p10le", muted: true, proResProfile: "4444",
    });
  });

  it("concurrency defaults to min(cores, 4) and clamps requests", () => {
    const cores = os.availableParallelism();
    expect(resolveConcurrency(null)).toBe(Math.min(cores, 4));
    expect(resolveConcurrency(1)).toBe(1);
    expect(resolveConcurrency(0)).toBe(Math.min(cores, 4));
    expect(resolveConcurrency(1000)).toBe(cores);
  });

  it("render layers: everything but audio; overlay layers: graphics + hud only", () => {
    expect(RENDER_LAYERS).toEqual({ picture: true, graphics: true, captions: true, hud: true, covers: true, audio: false });
    expect(OVERLAY_LAYERS.picture).toBe(false);
    expect(OVERLAY_LAYERS.audio).toBe(false);
  });
});

describe("chunk range, post filter, mux and concat arguments", () => {
  const chunks = [{ from: 0, to: 39 }, { from: 40, to: 79 }, { from: 80, to: 114 }];
  it("intersects planned chunks with a frame range (inclusive)", () => {
    expect(chunksInRange(chunks, null)).toEqual([{ index: 0, from: 0, to: 39 }, { index: 1, from: 40, to: 79 }, { index: 2, from: 80, to: 114 }]);
    expect(chunksInRange(chunks, [30, 85])).toEqual([{ index: 0, from: 30, to: 39 }, { index: 1, from: 40, to: 79 }, { index: 2, from: 80, to: 85 }]);
    expect(chunksInRange(chunks, [40, 40])).toEqual([{ index: 0, from: 40, to: 40 }]);
  });

  it("post: lut3d + temporal grain, nothing when both are off", () => {
    expect(postFilter({ lutFile: null, grain: 0 })).toBeNull();
    expect(postFilter({ lutFile: "grade.cube", grain: 4 })).toBe("lut3d=file=grade.cube:interp=tetrahedral,noise=alls=4:allf=t,format=yuv420p");
    expect(postFilter({ lutFile: null, grain: 99 })).toBe("noise=alls=16:allf=t,format=yuv420p");
  });

  it("mux: exact -t, AAC 256k 48 kHz stereo, silent track without a mix, -ss for a frame range", () => {
    const a = muxArgs("v.mp4", "mix.wav", { frames: 115, fps: 30, startFrame: 0 });
    expect(a.join(" ")).toContain("-map 0:v:0 -map 1:a:0 -c:v copy -af apad -c:a aac -b:a 256k -ar 48000 -ac 2 -t 3.833333");
    expect(a).not.toContain("-ss");
    const s = muxArgs("v.mp4", null, { frames: 150, fps: 30, startFrame: 0 });
    expect(s.join(" ")).toContain("-f lavfi -t 5.000000 -i anullsrc=r=48000:cl=stereo");
    const r = muxArgs("v.mp4", "mix.wav", { frames: 30, fps: 25, startFrame: 50 });
    expect(r.slice(2, 6)).toEqual(["-ss", "2.000000", "-i", "mix.wav"]);
  });

  it("concat list lines escape single quotes", () => {
    expect(concatListLine("/a/b c/it's.ts")).toBe("file '/a/b c/it'\\''s.ts'");
  });
});
