import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chooseGl, isGpuRenderer, parseGlProbeLogs, readGlProbe } from "../src/gl";
import { testConfig, tmpDir } from "./helpers";

describe("GL probe parsing and choice (§12.5)", () => {
  it("parses the probe console lines", () => {
    expect(parseGlProbeLogs([
      "UNMASKED_RENDERER_WEBGL=ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)",
      'GL_PROBE {"ok":true,"webgl2":true,"renderer":"ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)"}',
    ])).toEqual({ ok: true, renderer: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)" });
    expect(parseGlProbeLogs(["UNMASKED_RENDERER_WEBGL=none", 'GL_PROBE {"ok":false,"renderer":null}'])).toEqual({ ok: false, renderer: "" });
    expect(parseGlProbeLogs(["GL_PROBE {broken"])).toEqual({ ok: false, renderer: "" });
    expect(parseGlProbeLogs([])).toEqual({ ok: false, renderer: "" });
  });

  it("software renderers are not GPUs", () => {
    expect(isGpuRenderer(true, "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11)")).toBe(true);
    expect(isGpuRenderer(true, "SwiftShader")).toBe(false);
    expect(isGpuRenderer(true, "llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(false);
    expect(isGpuRenderer(false, "ANGLE (NVIDIA)")).toBe(false);
  });

  it("first GPU-backed mode in candidate order wins, else swangle", () => {
    expect(chooseGl([{ gl: "angle-egl", ok: false, renderer: "" }, { gl: "angle", ok: true, renderer: "SwiftShader" }, { gl: "swangle", ok: true, renderer: "SwiftShader" }]))
      .toEqual({ chosen: "swangle", gpu: false });
    expect(chooseGl([{ gl: "angle-egl", ok: true, renderer: "Mesa Intel(R) UHD Graphics" }, { gl: "angle", ok: true, renderer: "ANGLE (NVIDIA)" }]))
      .toEqual({ chosen: "angle-egl", gpu: true });
    expect(chooseGl([{ gl: "angle-egl", ok: false, renderer: "" }, { gl: "angle", ok: true, renderer: "ANGLE (NVIDIA)" }])).toEqual({ chosen: "angle", gpu: true });
    expect(chooseGl([])).toEqual({ chosen: "swangle", gpu: false });
  });

  it("reads a valid cached probe and ignores a corrupt one", async () => {
    const t = await tmpDir();
    try {
      const config = testConfig(t.dir);
      expect(await readGlProbe(config)).toBeNull();
      await mkdir(path.dirname(config.paths.glProbe), { recursive: true });
      await writeFile(config.paths.glProbe, "{not json");
      expect(await readGlProbe(config)).toBeNull();
      const doc = { schemaVersion: 1, chosen: "swangle", results: [{ gl: "swangle", ok: true, ms: 900, renderer: "SwiftShader" }], gpu: false, probedAt: "2026-10-03T10:00:00.000Z" };
      await writeFile(config.paths.glProbe, JSON.stringify(doc));
      expect(await readGlProbe(config)).toEqual(doc);
    } finally {
      await t.cleanup();
    }
  });
});
