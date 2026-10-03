// Headline legibility (P3 review): TitleSting/ChapterCard on the light "paper" backdrop read in ink with an accent
// kicker ≥ 4.5:1; accented capitals (FR "DUPÉ") open the line height; the NumberCounter plate holds contrast on a
// bright card it spills onto.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { StyleRenderTokens } from "@docmaker/core";
import { COUNTER_PLATE } from "../src/components/NumberCounter";
import { contrastRatio, mixHex, readableOn } from "../src/lib/color";
import { ACCENT_LINE_HEIGHT, backdropTones, hasCapitalDiacritic, headlineColors, headlineLineHeight } from "../src/lib/legibility";
import { DEFAULT_RENDER_TOKENS } from "../src/specimen/defaults";

const here = path.dirname(fileURLToPath(import.meta.url));

/** cinematic-essay's palette (styles/builtin/cinematic-essay/style.json): near-white text, beige paper. */
const CINEMATIC: StyleRenderTokens = {
  ...DEFAULT_RENDER_TOKENS,
  tokens: {
    ...DEFAULT_RENDER_TOKENS.tokens,
    palette: { accent: "#C9A66B", danger: "#B5473A", ink: "#0B0C10", money: "#6FA387", muted: "#7D7A73", paper: "#EDE6D6", secondary: "#5B7DA6", text: "#F5F1E8" },
  },
};
const minContrast = (fg: string, bgs: string[]) => Math.min(...bgs.map((b) => contrastRatio(fg, b)));

describe("contrast helpers", () => {
  it("contrastRatio is WCAG (black/white 21:1, symmetric, identical 1:1)", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });
  it("readableOn keeps a passing colour and otherwise shifts it just enough", () => {
    expect(readableOn("#000000", ["#FFFFFF"], 4.5)).toBe("#000000");
    const k = readableOn("#C9A66B", ["#EDE6D6"], 4.5);
    expect(k).not.toBe("#C9A66B");
    expect(contrastRatio(k, "#EDE6D6")).toBeGreaterThanOrEqual(4.5);
    expect(k).not.toBe("#000000"); // hue kept (a darkened gold, not pure black)
  });
});

describe("headlineColors", () => {
  it("paper (cinematic-essay default): ink title, accent kicker ≥ 4.5:1 on every paper tone (was ≈ 1.1:1)", () => {
    const tones = backdropTones("paper", CINEMATIC);
    expect(minContrast(CINEMATIC.tokens.palette.text, tones)).toBeLessThan(1.5); // the defect: near-white on beige
    const c = headlineColors("paper", CINEMATIC, CINEMATIC.tokens.palette.accent);
    expect(c.light).toBe(true);
    expect(c.title).toBe(CINEMATIC.tokens.palette.ink);
    expect(minContrast(c.title, tones)).toBeGreaterThanOrEqual(7);
    expect(c.kicker).toMatch(/^#[0-9a-f]{6}$/i);
    expect(minContrast(c.kicker, tones)).toBeGreaterThanOrEqual(4.5);
  });
  it("dark backdrops keep the near-white palette text (unchanged look)", () => {
    for (const recipe of ["darkNoise", "gradientGrid", "keywordCard"] as const) {
      const c = headlineColors(recipe, DEFAULT_RENDER_TOKENS, "#FFD400");
      expect(c.light, recipe).toBe(false);
      expect(c.title).toBe(DEFAULT_RENDER_TOKENS.tokens.palette.text);
    }
  });
  it("TitleSting and ChapterCard take their colours and line height from the helpers", () => {
    for (const f of ["TitleSting", "ChapterCard"]) {
      const src = readFileSync(path.join(here, `../src/components/${f}.tsx`), "utf8");
      expect(src, f).toContain("headlineColors(p.backdrop");
      expect(src, f).toContain("headlineLineHeight(lines");
      expect(src, f).not.toContain("color: pal.text");
    }
  });
});

describe("headlineLineHeight", () => {
  it("detects capitals with a mark above (precomposed or combining), not plain or cedilla-only text", () => {
    expect(hasCapitalDiacritic("DUPÉ")).toBe(true);
    expect(hasCapitalDiacritic("À L'ÉPOQUE")).toBe(true);
    expect(hasCapitalDiacritic("É")).toBe(true);
    expect(hasCapitalDiacritic("CÔTE")).toBe(true);
    expect(hasCapitalDiacritic("TULIPOMANIE")).toBe(false);
    expect(hasCapitalDiacritic("FRANÇAIS")).toBe(false); // cedilla hangs below
    expect(hasCapitalDiacritic("été")).toBe(false); // lower case: within the ascender room
  });
  it("opens the block to ≥ 1.12 when any line carries one; leaves plain titles at their base", () => {
    expect(headlineLineHeight(["TULIPOMANIE :", "LE MONDE DUPÉ"], 1.0)).toBe(ACCENT_LINE_HEIGHT);
    expect(ACCENT_LINE_HEIGHT).toBeGreaterThanOrEqual(1.12);
    expect(headlineLineHeight(["THE TULIP", "MANIA"], 1.0)).toBe(1.0);
    expect(headlineLineHeight(["THE TULIP", "MANIA"], 1.02)).toBe(1.02);
    expect(headlineLineHeight("ÉNORME", 1)).toBe(ACCENT_LINE_HEIGHT);
    expect(headlineLineHeight(["É"], 1.2)).toBe(1.2); // never lowers a roomier base
  });
});

describe("NumberCounter plate", () => {
  /** Plain black-alpha compositing of the scrim then the plate (at its weakest point over the text) on `bg`. */
  const under = (bg: string) => mixHex(mixHex(bg, "#000000", COUNTER_PLATE.scrim), "#000000", COUNTER_PLATE.edge);
  it("keeps the white label ≥ 4.5:1 and money-green digits ≥ 3:1 on the bright tulip card and on pure white", () => {
    // P3 sample: the card under the old scrim measured ≈ RGB 161–168 → white label ≈ 2.3–2.5:1 (below 3:1)
    const observed = "#A5A5A5";
    expect(contrastRatio("#FFFFFF", observed)).toBeLessThan(3);
    const cases = [mixHex(observed, "#000000", COUNTER_PLATE.edge), under("#FFFFFF"), under("#EDE6D6")];
    for (const b of cases) {
      expect(contrastRatio(mixHex(b, "#FFFFFF", 0.96), b), b).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio("#3DDC84", b), b).toBeGreaterThanOrEqual(3);
    }
  });
  it("the plate overshoots the content box and stays at its plateau over the text", () => {
    expect(COUNTER_PLATE.core).toBeGreaterThanOrEqual(COUNTER_PLATE.edge);
    // the content box edges sit inside the plateau: 1 / (1 + 2·inset) per axis
    const [v, h] = COUNTER_PLATE.inset.split(" ").map((x) => -parseFloat(x) / 100) as [number, number];
    expect(1 / (1 + 2 * v)).toBeLessThanOrEqual(COUNTER_PLATE.plateau);
    expect(1 / (1 + 2 * h)).toBeLessThanOrEqual(COUNTER_PLATE.plateau);
  });
});
