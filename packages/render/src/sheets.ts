// Contact sheets (§12.6) with sharp: tiles of `width` px in `cols` columns (≤ 60 tiles per sheet), optional SVG label
// with frame number + timecode; plus the default QA plan (first/middle/last frame of each shot per chapter, one
// c−3…c+3 strip per transition type).
import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { timecode, type Timeline } from "@docmaker/core";

export const MAX_TILES_PER_SHEET = 60;
const GAP = 8;
const BACKGROUND = "#101010";

const escapeXml = (s: string): string => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export function labelSvg(text: string, width: number): Buffer {
  const fontSize = Math.max(10, Math.min(22, Math.round(width / 32)));
  const h = Math.round(fontSize * 1.7);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}">` +
      `<rect width="100%" height="100%" fill="#000000" fill-opacity="0.62"/>` +
      `<text x="${Math.round(fontSize * 0.5)}" y="${Math.round(h * 0.72)}" font-family="DejaVu Sans Mono, Menlo, monospace" font-size="${fontSize}" fill="#ffffff">${escapeXml(text)}</text>` +
      `</svg>`,
  );
}

export const frameLabel = (frame: number, fps: number): string => `#${frame}  ${timecode(frame, fps)}`;

export interface SheetTile { file: string; label: string | null }

/** Writes one or more JPEG sheets `<outDir>/<prefix>-NN.jpg` (≤ 60 tiles each); returns their paths. */
export async function buildContactSheets(tiles: readonly SheetTile[], o: { cols: number; width: number; outDir: string; prefix?: string; aspect?: number }): Promise<string[]> {
  if (tiles.length === 0) return [];
  const cols = Math.max(1, Math.floor(o.cols));
  const tileW = Math.max(32, Math.floor(o.width));
  const tileH = Math.max(18, Math.round(tileW / (o.aspect ?? 16 / 9)));
  await mkdir(o.outDir, { recursive: true });
  const out: string[] = [];
  for (let s = 0; s * MAX_TILES_PER_SHEET < tiles.length; s++) {
    const group = tiles.slice(s * MAX_TILES_PER_SHEET, (s + 1) * MAX_TILES_PER_SHEET);
    const c = Math.min(cols, group.length);
    const rows = Math.ceil(group.length / c);
    const composites = await Promise.all(group.map(async (t, i) => {
      let img = sharp(t.file).resize(tileW, tileH, { fit: "contain", background: "#000000" });
      if (t.label) img = img.composite([{ input: labelSvg(t.label, tileW), gravity: "southwest" }]);
      return {
        input: await img.png().toBuffer(),
        left: GAP + (i % c) * (tileW + GAP),
        top: GAP + Math.floor(i / c) * (tileH + GAP),
      };
    }));
    const file = path.join(o.outDir, `${o.prefix ?? "sheet"}-${String(s + 1).padStart(2, "0")}.jpg`);
    await sharp({ create: { width: GAP + c * (tileW + GAP), height: GAP + rows * (tileH + GAP), channels: 3, background: BACKGROUND } })
      .composite(composites)
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(file);
    out.push(file);
  }
  return out;
}

const uniqSorted = (xs: number[], n: number): number[] => [...new Set(xs.filter((f) => f >= 0 && f < n))].sort((a, b) => a - b);

function sampleEvenly(xs: number[], max: number): number[] {
  if (xs.length <= max) return xs;
  const out: number[] = [];
  for (let i = 0; i < max; i++) out.push(xs[Math.round((i * (xs.length - 1)) / (max - 1))]!);
  return [...new Set(out)];
}

/** Default QA sheet plan: one group per chapter (shot first/middle/last, ≤ 60) + one c−3…c+3 strip per transition type. */
export function qaSheetPlan(t: Timeline): { name: string; frames: number[] }[] {
  const N = t.durationInFrames;
  const groups: { name: string; frames: number[] }[] = [];
  const chapters = t.chapters.length ? t.chapters : [{ id: "ALL", from: 0, dur: N }];
  for (const ch of chapters) {
    const frames: number[] = [];
    for (const v of t.video) {
      const a = Math.max(v.from, ch.from);
      const b = Math.min(v.from + v.dur, ch.from + ch.dur) - 1;
      if (b < a) continue;
      frames.push(a, Math.floor((a + b) / 2), b);
    }
    groups.push({ name: `chapter-${ch.id}`, frames: sampleEvenly(uniqSorted(frames, N), MAX_TILES_PER_SHEET) });
  }
  const seen = new Set<string>();
  for (const v of t.video) {
    const tr = v.transitionIn;
    if (tr.kind === "cut" || v.from === 0) continue;
    const key = tr.kind === "cover" ? `cover-${tr.presentation}` : `overlap-${tr.presentation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = v.from;
    groups.push({ name: `transition-${key}`, frames: uniqSorted([c - 3, c - 2, c - 1, c, c + 1, c + 2, c + 3], N) });
  }
  return groups.filter((g) => g.frames.length > 0);
}
