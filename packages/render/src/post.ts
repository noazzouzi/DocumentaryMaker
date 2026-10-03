// Master post (§12.3): ffmpeg lut3d (procedural .cube) + temporal grain (`noise=alls=N:allf=t`), never in-browser.
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import type { RuntimeConfig } from "@docmaker/core";
import { ffAtomic } from "./ff";
import { BT709_TV_ARGS } from "./presets";

/** The -vf chain, or null when there is nothing to do. The cube is referenced by a cwd-relative safe name. */
export function postFilter(o: { lutFile: string | null; grain: number }): string | null {
  const parts: string[] = [];
  if (o.lutFile) parts.push(`lut3d=file=${o.lutFile}:interp=tetrahedral`);
  const g = Math.max(0, Math.min(16, Math.round(o.grain)));
  if (g > 0) parts.push(`noise=alls=${g}:allf=t`);
  if (parts.length === 0) return null;
  // back to limited-range BT.709 (swscale's RGB→YUV default is BT.601) — the chunks are BT.709 tv (presets.ts)
  parts.push("scale=out_color_matrix=bt709:out_range=tv", "format=yuv420p");
  return parts.join(",");
}

export async function masterPost(input: string, out: string, o: {
  lutCube: string | null; grain: number; config: RuntimeConfig; signal: AbortSignal; totalMs: number; onProgress?: (pct: number) => void;
}): Promise<boolean> {
  // ffmpeg filter arguments cannot safely carry arbitrary paths: copy the cube next to a temp cwd under a fixed name
  const work = await mkdtemp(path.join(path.dirname(out), ".post-"));
  try {
    let lutFile: string | null = null;
    if (o.lutCube) {
      await copyFile(o.lutCube, path.join(work, "grade.cube"));
      lutFile = "grade.cube";
    }
    const vf = postFilter({ lutFile, grain: o.grain });
    if (!vf) return false;
    await ffAtomic([
      "-i", path.resolve(input), "-map", "0:v:0", "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "18",
      "-pix_fmt", "yuv420p", ...BT709_TV_ARGS, "-movflags", "+faststart", "-f", "mp4",
    ], path.resolve(out), {
      config: o.config, signal: o.signal, cwd: work,
      onProgress: o.onProgress ? (ms) => o.onProgress!(Math.min(1, ms / Math.max(1, o.totalMs))) : undefined,
    });
    return true;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
