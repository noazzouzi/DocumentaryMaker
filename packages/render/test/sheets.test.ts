import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { makeTimeline } from "@docmaker/core/testing";
import { buildContactSheets, frameLabel, labelSvg, MAX_TILES_PER_SHEET, qaSheetPlan } from "../src/sheets";
import { tmpDir } from "./helpers";

async function tile(file: string, rgb: [number, number, number]): Promise<void> {
  await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } }).jpeg().toFile(file);
}

describe("contact sheets", () => {
  it("lays tiles out in columns with labels, ≤ 60 tiles per sheet", async () => {
    const t = await tmpDir();
    try {
      const tiles = [];
      for (let i = 0; i < 61; i++) {
        const f = path.join(t.dir, `s${i}.jpg`);
        await tile(f, [(i * 37) % 255, (i * 91) % 255, 200]);
        tiles.push({ file: f, label: frameLabel(i * 30, 30) });
      }
      const sheets = await buildContactSheets(tiles, { cols: 6, width: 160, outDir: path.join(t.dir, "out") });
      expect(sheets.map((s) => path.basename(s))).toEqual(["sheet-01.jpg", "sheet-02.jpg"]);
      const m1 = await sharp(sheets[0]!).metadata();
      expect(m1.width).toBe(8 + 6 * (160 + 8));
      expect(m1.height).toBe(8 + 10 * (90 + 8)); // 60 tiles → 10 rows
      const m2 = await sharp(sheets[1]!).metadata();
      expect(m2.width).toBe(8 + 1 * (160 + 8)); // a single remaining tile
      // the first tile is the first still (top-left pixel sampled inside the tile, above the label band)
      const { data } = await sharp(sheets[0]!).extract({ left: 20, top: 20, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
      expect(data[2]).toBeGreaterThan(150);
    } finally {
      await t.cleanup();
    }
  });

  it("labels carry the frame and timecode and are XML-escaped", () => {
    expect(frameLabel(95, 30)).toBe("#95  00:00:03:05");
    const svg = labelSvg("<a & b>", 200).toString();
    expect(svg).toContain("&lt;a &amp; b&gt;");
    expect(svg).toContain('width="200"');
  });

  it("returns no sheet for no tiles", async () => {
    expect(await buildContactSheets([], { cols: 4, width: 100, outDir: "/nonexistent" })).toEqual([]);
  });
});

describe("qaSheetPlan", () => {
  it("one group per chapter (shot first/middle/last) and one c±3 strip per transition type", () => {
    const t = makeTimeline({ seconds: 60 });
    const plan = qaSheetPlan(t);
    const chapters = plan.filter((g) => g.name.startsWith("chapter-"));
    expect(chapters.map((g) => g.name)).toEqual(t.chapters.map((c) => `chapter-${c.id}`));
    for (const g of plan) {
      expect(g.frames.length).toBeGreaterThan(0);
      expect(g.frames.length).toBeLessThanOrEqual(MAX_TILES_PER_SHEET);
      expect([...g.frames].sort((a, b) => a - b)).toEqual(g.frames);
      for (const f of g.frames) expect(f >= 0 && f < t.durationInFrames).toBe(true);
    }
    const first = t.video[0]!;
    expect(chapters[0]!.frames).toContain(first.from);
    expect(chapters[0]!.frames).toContain(first.from + first.dur - 1);
    const strips = plan.filter((g) => g.name.startsWith("transition-"));
    const kinds = new Set(t.video.filter((v) => v.from > 0 && v.transitionIn.kind !== "cut").map((v) => `${v.transitionIn.kind}-${(v.transitionIn as { presentation: string }).presentation}`));
    expect(strips.map((s) => s.name.replace("transition-", "")).sort()).toEqual([...kinds].sort());
    for (const s of strips) expect(s.frames.length).toBeLessThanOrEqual(7);
  });
});
