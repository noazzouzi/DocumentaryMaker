// Procedural 33³ .cube LUTs from LutParams (§12.6). Port of the HyperFrames media-use `buildCube` grade spec
// (Apache-2.0, luts/index.json params): lift/gain → contrast → white balance → split tone → saturation/vibrance.
// LutParams mapping: shadows/highlights are the split-tone RGB offsets and `intensity` is the split-tone intensity
// (the HF teal-orange preset: shadows [−.04,.05,.09], highlights [.1,.04,−.03], intensity .62).
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, DocmakerError, sha16, type LutParams, type RuntimeConfig } from "@docmaker/core";

export const LUT_SIZE = 33;
const MAX_SIZE = 64;
type Rgb = [number, number, number];

const clamp = (v: number, lo: number, hi: number): number => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
const unit = (v: number): number => clamp(v, 0, 1);
const luma = (c: Rgb): number => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722; // Rec.709
function smoothstep(e0: number, e1: number, v: number): number {
  const t = unit((v - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const map3 = (c: Rgb, f: (x: number, i: number) => number): Rgb => [f(c[0], 0), f(c[1], 1), f(c[2], 2)];

/** Grades one RGB triple (each channel in [0, 1]). Exported for tests. */
export function gradeRgb(input: Rgb, p: LutParams): Rgb {
  let c: Rgb = input;
  // lift / gain (blacks, whites; the HF shadows/highlights lift terms have no LutParams counterpart)
  const blacks = clamp(p.blacks, -1, 1);
  const whites = clamp(p.whites, -1, 1);
  const lift = blacks * 0.08 + whites * 0.08;
  if (lift !== 0) c = map3(c, (x) => unit(x + lift));
  // contrast around mid grey
  const contrast = clamp(p.contrast, -1, 1);
  if (contrast !== 0) {
    const k = 1 + contrast * 1.2;
    c = map3(c, (x) => unit(0.5 + (x - 0.5) * k));
  }
  // white balance (temperature only)
  const temp = clamp(p.temp, -1, 1);
  if (temp !== 0) c = [unit(c[0] * (1 + temp * 0.28)), unit(c[1]), unit(c[2] * (1 - temp * 0.28))];
  // split tone
  const intensity = unit(p.intensity);
  if (intensity > 0 && (p.shadows.some((v) => v !== 0) || p.highlights.some((v) => v !== 0))) {
    const balance = 0.5;
    const y = luma(c);
    const sm = 1 - smoothstep(balance - 0.25, balance + 0.2, y);
    const hm = smoothstep(balance - 0.2, balance + 0.25, y);
    c = map3(c, (x, i) => unit(x + (p.shadows[i] ?? 0) * sm * intensity + (p.highlights[i] ?? 0) * hm * intensity));
  }
  // saturation + vibrance (vibrance weighs less-saturated colours more)
  const sat = clamp(p.saturation, -1, 1);
  const vib = clamp(p.vibrance, -1, 1);
  if (sat !== 0 || vib !== 0) {
    const y = luma(c);
    const cur = Math.max(Math.abs(c[0] - y), Math.abs(c[1] - y), Math.abs(c[2] - y));
    const factor = clamp(1 + sat + vib * (1 - unit(cur * 2)), 0, 2.5);
    c = map3(c, (x) => unit(y + (x - y) * factor));
  }
  return c;
}

/** The .cube text (Adobe/Resolve format; red varies fastest). Deterministic for given params. */
export function lutCubeText(p: LutParams, size = LUT_SIZE): string {
  if (!Number.isInteger(size) || size < 2 || size > MAX_SIZE) throw new DocmakerError("VALIDATION", `LUT size must be an integer in [2, ${MAX_SIZE}]`);
  const lines = ['TITLE "DocumentaryMaker procedural grade"', "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1", `LUT_3D_SIZE ${size}`];
  const d = size - 1;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const o = gradeRgb([r / d, g / d, b / d], p);
        lines.push(`${unit(o[0]).toFixed(6)} ${unit(o[1]).toFixed(6)} ${unit(o[2]).toFixed(6)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

/** 33³ .cube from LutParams for ffmpeg lut3d in master post. Atomic write. */
export async function generateLutCube(p: LutParams, outPath: string): Promise<void> {
  const text = lutCubeText(p, LUT_SIZE);
  await mkdir(path.dirname(outPath), { recursive: true });
  const tmp = `${outPath}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, text);
    await rename(tmp, outPath);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** <home>/cache/luts/<hash>.cube (content-addressed; generated once). */
export async function cachedLutCube(config: RuntimeConfig, p: LutParams): Promise<string> {
  const file = path.join(config.paths.cache, "luts", `${sha16(canonicalJson({ v: 1, size: LUT_SIZE, p }))}.cube`);
  if (!existsSync(file)) await generateLutCube(p, file);
  return file;
}
