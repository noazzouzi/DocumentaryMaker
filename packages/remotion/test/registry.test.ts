import { describe, expect, it } from "vitest";
import { BUILTIN_FONTS, COMPONENT_META, OVERLAY_PROPS, OverlayComponentId, type OverlayItem } from "@docmaker/core";
import { COMPOSITION_IDS, FONT_REGISTRY, IMPLEMENTED_COMPONENTS } from "../src";
import { fallbackAssetId, fallbackText, FallbackCard } from "../src/components/FallbackCard";
import { COMPONENT_REGISTRY, componentFor } from "../src/components/registry";
import { stripTagPrefix } from "../src/components/SourceLabel";
import { paragraphCentres } from "../src/components/ArticleHighlight";
import { boardCamera } from "../src/components/EvidenceBoard";
import { layoutLabels } from "../src/components/MapPin";
import { stampScale } from "../src/components/Stamp";
import { FONT_CSS_FILES } from "../src/fonts/fonts.css";
import { fontFaces, fontWeightFor } from "../src/fonts/registry";
import { assetUrl, resolveFontUrl } from "../src/lib/assetUrl";
import { coverRect } from "../src/lib/geometry";
import { cellDigit, odometerCells } from "../src/lib/odometer";
import { formatNumber, isEmphasis, wrapText } from "../src/lib/text";
import { DEFAULT_RENDER_TOKENS } from "../src/specimen/defaults";
import { sampleItem, SPECIMEN_IDS } from "../src/specimen/samples";
import { timeline } from "./helpers";

describe("component registry", () => {
  it("maps every OverlayComponentId (closed vocabulary) and nothing else", () => {
    expect(Object.keys(COMPONENT_REGISTRY).sort()).toEqual([...OverlayComponentId.options].sort());
    expect(Object.keys(OVERLAY_PROPS).sort()).toEqual(Object.keys(COMPONENT_REGISTRY).sort());
  });

  it("implements every M1 component; unimplemented ids render FallbackCard", () => {
    for (const id of OverlayComponentId.options) {
      if (COMPONENT_META[id].milestone === "M1") expect(IMPLEMENTED_COMPONENTS.has(id)).toBe(true);
      const item = { component: id } as OverlayItem;
      if (IMPLEMENTED_COMPONENTS.has(id)) expect(componentFor(item)).toBe(COMPONENT_REGISTRY[id]);
      else expect(componentFor(item)).toBe(FallbackCard);
    }
    expect([...IMPLEMENTED_COMPONENTS].every((id) => (OverlayComponentId.options as readonly string[]).includes(id))).toBe(true);
  });

  it("implements every component of the closed vocabulary (M2); ids unknown to this build fall back", () => {
    expect([...IMPLEMENTED_COMPONENTS].sort()).toEqual([...OverlayComponentId.options].sort());
    expect(componentFor({ component: "FutureThing" } as unknown as OverlayItem)).toBe(FallbackCard);
  });

  it("sample items parse with OVERLAY_PROPS for every component (StyleSpecimen data)", () => {
    expect(SPECIMEN_IDS.length).toBe(OverlayComponentId.options.length);
    for (const id of SPECIMEN_IDS) {
      for (const lang of ["en", "fr"] as const) {
        const it = sampleItem(id, DEFAULT_RENDER_TOKENS, 30, lang);
        const r = OVERLAY_PROPS[id].safeParse(it.props);
        expect(r.success, `${id}/${lang}: ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
        expect(it.band).toBe(COMPONENT_META[id].band);
      }
    }
  });

  it("FallbackCard picks the main text (read-policy fields), else the first referenced asset", () => {
    expect(fallbackText({ component: "QuoteCard", props: { text: "Nobody wanted to buy.", speaker: "Cos" } } as never)).toEqual(["Nobody wanted to buy."]);
    expect(fallbackText({ component: "HeadlineStack", props: { items: [{ headline: "A" }, { headline: "B" }] } } as never)).toEqual(["A", "B"]);
    expect(fallbackText({ component: "CensorBar", props: { rect: { x: 0, y: 0, w: 1, h: 1 }, mode: "bar", label: null } } as never)).toEqual([]);
    const assets = { ["a".repeat(64)]: {}, ["b".repeat(64)]: {} };
    expect(fallbackAssetId({ items: [{ assetId: "x" }, { assetId: "b".repeat(64) }] }, assets)).toBe("b".repeat(64));
    expect(fallbackAssetId({ portraitAssetId: "a".repeat(64) }, assets)).toBe("a".repeat(64));
    expect(fallbackAssetId({ portraitAssetId: null }, assets)).toBeNull();
  });

  it("composition ids are the contract values", () => {
    expect(COMPOSITION_IDS).toEqual({ doc: "Documentary", overlay: "DocumentaryOverlay", item: "OverlayItem", still: "GeneratedStill", gl: "GlProbe", fonts: "FontSpecimen", specimen: "StyleSpecimen" });
  });
});

describe("fonts", () => {
  it("FONT_REGISTRY equals core BUILTIN_FONTS", () => {
    expect(FONT_REGISTRY).toEqual(BUILTIN_FONTS.map((f) => ({ family: f.family, weights: f.weights, italic: f.italic })));
  });

  it("fonts.css imports exactly one fontsource file per registered face", () => {
    const expected = BUILTIN_FONTS.flatMap((f) => [...f.weights.map((w) => `${f.fontsource}/${w}.css`), ...(f.italic ? f.weights.map((w) => `${f.fontsource}/${w}-italic.css`) : [])]);
    expect([...FONT_CSS_FILES].sort()).toEqual(expected.sort());
    expect(fontFaces().length).toBe(expected.length);
  });

  it("single-weight display faces are never faux-bolded", () => {
    expect(fontWeightFor("Archivo Black", 900)).toBe(400);
    expect(fontWeightFor("Inter", 700)).toBe(600);
    expect(fontWeightFor("Inter", 900)).toBe(900);
    expect(fontWeightFor("Unknown", 700)).toBe(700);
  });
});

describe("media URLs and text helpers", () => {
  it("assetUrl = base/projectRel?v=<id12>; unknown ids → null; font URLs resolve against the base", () => {
    const t = timeline({ seconds: 10 });
    const id = Object.keys(t.assets)[0]!;
    expect(assetUrl(t, id, "http://127.0.0.1:9/p")).toBe(`http://127.0.0.1:9/p/${t.assets[id]!.projectRel}?v=${id.slice(0, 12)}`);
    expect(assetUrl(t, id, "http://127.0.0.1:9/p/")).toBe(`http://127.0.0.1:9/p/${t.assets[id]!.projectRel}?v=${id.slice(0, 12)}`);
    expect(assetUrl(t, "f".repeat(64), "x")).toBeNull();
    expect(resolveFontUrl("styles/x/fonts/a.woff2", "http://h/p")).toBe("http://h/p/styles/x/fonts/a.woff2");
    expect(resolveFontUrl("https://cdn/a.woff2", "http://h/p")).toBe("https://cdn/a.woff2");
  });

  it("formats guilders with the florin sign in EN and FR, and other currencies via Intl", () => {
    expect(formatNumber(5500, { format: "currency", currency: "NLG", decimals: 0, locale: "en-US" })).toBe("ƒ5,500");
    expect(formatNumber(5500, { format: "currency", currency: "NLG", decimals: 0, locale: "fr-FR" })).toMatch(/^5\s500\sƒ$/u);
    expect(formatNumber(1234.5, { format: "currency", currency: "EUR", decimals: 2, locale: "fr-FR" })).toMatch(/^1\s234,50\s€$/u);
    expect(formatNumber(25, { format: "percent", currency: null, decimals: 0, locale: "en-US" })).toBe("25%");
    expect(formatNumber(1_234_567, { format: "compact", currency: null, decimals: 0, locale: "en-US" })).toBe("1.2M");
  });

  it("odometer cells read the final value at rest and roll in between", () => {
    const spec = { format: "currency", currency: "NLG", decimals: 0, locale: "en-US" } as const;
    const atRest = odometerCells(5500, 5500, spec);
    const text = atRest.map((c) => (c.kind === "digit" ? String(cellDigit(c.pos)) : c.text)).join("");
    expect(text).toBe("ƒ5,500");
    expect(atRest.every((c) => c.visible === 1)).toBe(true);
    const mid = odometerCells(5500, 59.5, spec);
    const digits = mid.filter((c) => c.kind === "digit") as { place: number; pos: number; visible: number }[];
    expect(digits.map((d) => d.place)).toEqual([3, 2, 1, 0]);
    expect(digits[0]!.visible).toBe(0); // thousands not reached yet
    expect(digits[2]!.visible).toBe(1); // tens
    expect(digits[3]!.pos).toBeCloseTo(9.5, 6); // ones roll continuously
    expect(digits[2]!.pos).toBeCloseTo(5.5, 6); // tens carry while the ones pass 9
    const pct = odometerCells(12.5, 12.5, { format: "percent", currency: null, decimals: 1, locale: "fr-FR" });
    expect(pct.map((c) => (c.kind === "digit" ? String(cellDigit(c.pos)) : c.text)).join("")).toMatch(/^12,5\s%$/u);
  });

  it("emphasis matching is accent/case-insensitive; wrap and source-tag stripping", () => {
    expect(isEmphasis("DOUBLÉ,", ["doublé"])).toBe(true);
    expect(isEmphasis("prices", ["DOUBLED"])).toBe(false);
    expect(wrapText("one two three four five six", 9)).toEqual(["one two", "three", "four five", "six"]);
    expect(wrapText("one two three four five six", 9, 2)[1]!.endsWith("…")).toBe(true);
    expect(stripTagPrefix("Source: Rijksmuseum, 1640", ["SOURCE"])).toBe("Rijksmuseum, 1640");
    expect(stripTagPrefix("Rijksmuseum", ["SOURCE"])).toBe("Rijksmuseum");
  });

  it("stamp slams 2.6× → 1× in 0.09 s then bounces back to rest", () => {
    expect(stampScale(0)).toBeCloseTo(2.6, 6);
    expect(stampScale(0.09)).toBeCloseTo(1, 6);
    expect(Math.abs(stampScale(0.2) - 1)).toBeLessThan(0.05);
    expect(stampScale(2)).toBeCloseTo(1, 4);
  });

  it("coverRect keeps the crop/focal centred without exposing edges", () => {
    const r = coverRect(4000, 2000, 1920, 1080, null, { x: 0.9, y: 0.5 });
    expect(r.height).toBeCloseTo(1080, 6);
    expect(r.left + r.width).toBeGreaterThanOrEqual(1920 - 1e-6);
    expect(r.left).toBeLessThanOrEqual(0);
    const c = coverRect(4000, 3000, 1920, 1080, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }, { x: 0.5, y: 0.5 });
    expect(c.width).toBeCloseTo(3840, 6); // crop 2000 px wide fills 1920 → k = 0.96
    expect(c.left + 0.5 * c.width).toBeCloseTo(960, 6);
  });
});

describe("component layout math", () => {
  it("map labels never overlap (pushed down in y order)", () => {
    const ys = layoutLabels([{ x: 100, y: 100, w: 200 }, { x: 150, y: 110, w: 200 }, { x: 900, y: 105, w: 100 }, { x: 120, y: 120, w: 80 }], 56);
    expect(ys[0]).toBe(100);
    expect(ys[1]).toBe(156);
    expect(ys[2]).toBe(105); // far right: untouched
    expect(ys[3]).toBe(212);
  });

  it("evidence board camera eases between overview and items and holds between moves", () => {
    const items = [{ x: 900, y: 700, w: 520 }, { x: 2300, y: 900, w: 520 }];
    const moves = [{ at: 10, focus: 0, frames: 20 }, { at: 60, focus: -1, frames: 20 }];
    const o = boardCamera(moves, items, 0);
    expect(o).toEqual({ cx: 1920, cy: 1080, s: 0.5 });
    const f = boardCamera(moves, items, 40);
    expect(f.cx).toBeCloseTo(900, 6);
    expect(f.s).toBeGreaterThan(0.5);
    expect(boardCamera(moves, items, 20).cx).toBeGreaterThan(900);
    expect(boardCamera(moves, items, 20).cx).toBeLessThan(1920);
    expect(boardCamera(moves, items, 90)).toEqual(o);
  });

  it("article page layout puts later paragraphs lower", () => {
    const { centres, height } = paragraphCentres("Headline", ["short", "x".repeat(400), "y".repeat(80)]);
    expect(centres[1]!).toBeGreaterThan(centres[0]!);
    expect(centres[2]!).toBeGreaterThan(centres[1]!);
    expect(height).toBeGreaterThan(centres[2]!);
  });
});
