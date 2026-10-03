import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { LutParams } from "@docmaker/core";
import { cachedLutCube, generateLutCube, gradeRgb, LUT_SIZE, lutCubeText } from "../src/lut";
import { ffmpegSync, testConfig, tmpDir } from "./helpers";

const IDENTITY: LutParams = { contrast: 0, saturation: 0, vibrance: 0, shadows: [0, 0, 0], highlights: [0, 0, 0], blacks: 0, whites: 0, temp: 0, intensity: 0 };
const TEAL_ORANGE: LutParams = { contrast: 0.18, saturation: 0.08, vibrance: 0.12, shadows: [-0.04, 0.05, 0.09], highlights: [0.1, 0.04, -0.03], blacks: 0, whites: 0, temp: 0, intensity: 0.62 };
const FILM_FADE: LutParams = { ...IDENTITY, blacks: 0.35, contrast: -0.28, temp: 0.16, intensity: 0.7 };

function parseCube(text: string): { size: number; rows: number[][] } {
  const lines = text.trim().split("\n");
  const size = Number(/LUT_3D_SIZE (\d+)/.exec(text)![1]);
  const rows = lines.filter((l) => /^[\d.]+ [\d.]+ [\d.]+$/.test(l)).map((l) => l.split(" ").map(Number));
  return { size, rows };
}

describe("LUT cube", () => {
  it("is 33³ with the .cube header", () => {
    const { size, rows } = parseCube(lutCubeText(TEAL_ORANGE));
    expect(size).toBe(33);
    expect(rows).toHaveLength(33 ** 3);
    expect(lutCubeText(TEAL_ORANGE)).toMatch(/^TITLE ".*"\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\nLUT_3D_SIZE 33\n/);
    for (const r of rows) for (const v of r) expect(v >= 0 && v <= 1).toBe(true);
  });

  it("identity params give the identity cube (red fastest)", () => {
    const { rows } = parseCube(lutCubeText(IDENTITY));
    const d = LUT_SIZE - 1;
    let i = 0;
    for (let b = 0; b < LUT_SIZE; b++) for (let g = 0; g < LUT_SIZE; g++) for (let r = 0; r < LUT_SIZE; r++) {
      expect(rows[i++]).toEqual([Number((r / d).toFixed(6)), Number((g / d).toFixed(6)), Number((b / d).toFixed(6))]);
    }
  });

  it("is deterministic and sensitive to every parameter", () => {
    expect(lutCubeText(TEAL_ORANGE)).toBe(lutCubeText(TEAL_ORANGE));
    const base = lutCubeText(TEAL_ORANGE);
    for (const k of ["contrast", "saturation", "vibrance", "blacks", "whites", "temp", "intensity"] as const) {
      expect(lutCubeText({ ...TEAL_ORANGE, [k]: TEAL_ORANGE[k] + 0.1 }), k).not.toBe(base);
    }
    expect(lutCubeText({ ...TEAL_ORANGE, shadows: [0, 0, 0.2] })).not.toBe(base);
    expect(lutCubeText({ ...TEAL_ORANGE, highlights: [0.2, 0, 0] })).not.toBe(base);
  });

  it("grades in the expected direction", () => {
    // teal-orange: shadows lean blue/teal, highlights lean warm
    const dark = gradeRgb([0.15, 0.15, 0.15], TEAL_ORANGE);
    expect(dark[2]).toBeGreaterThan(dark[0]);
    const bright = gradeRgb([0.85, 0.85, 0.85], TEAL_ORANGE);
    expect(bright[0]).toBeGreaterThan(bright[2]);
    // film fade lifts blacks and warms
    const black = gradeRgb([0, 0, 0], FILM_FADE);
    expect(black[0]).toBeGreaterThan(0.02);
    expect(black[0]).toBeGreaterThan(black[2]);
    // contrast pushes mid-grey neighbours apart
    const c = { ...IDENTITY, contrast: 0.5 };
    expect(gradeRgb([0.6, 0.6, 0.6], c)[0]).toBeGreaterThan(0.6);
    expect(gradeRgb([0.4, 0.4, 0.4], c)[0]).toBeLessThan(0.4);
    // full desaturation → grey
    const g = gradeRgb([0.8, 0.2, 0.1], { ...IDENTITY, saturation: -1 });
    expect(Math.abs(g[0] - g[1])).toBeLessThan(1e-9);
  });

  it("generateLutCube writes a file ffmpeg lut3d accepts; cachedLutCube is content-addressed", async () => {
    const t = await tmpDir();
    try {
      const cube = path.join(t.dir, "a", "teal.cube");
      await generateLutCube(TEAL_ORANGE, cube);
      expect(await readFile(cube, "utf8")).toBe(lutCubeText(TEAL_ORANGE));
      ffmpegSync(["-f", "lavfi", "-i", "testsrc2=s=64x36:r=1", "-frames:v", "1", "-vf", `lut3d=file=${cube}`, path.join(t.dir, "out.png")]);
      const config = testConfig(t.dir);
      const a = await cachedLutCube(config, TEAL_ORANGE);
      const b = await cachedLutCube(config, TEAL_ORANGE);
      const c = await cachedLutCube(config, FILM_FADE);
      expect(a).toBe(b);
      expect(a).not.toBe(c);
      expect(a.startsWith(path.join(config.paths.cache, "luts"))).toBe(true);
    } finally {
      await t.cleanup();
    }
  });
});
