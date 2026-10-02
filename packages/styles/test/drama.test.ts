import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILTIN_FONT_FAMILIES, DERIVABLE_TRIGGERS, MotionData, MotionTemplate, StyleData, StylePrompts, TEMPLATE_COMPONENT, stableStringify,
  type MotionDataKey,
} from "@docmaker/core";
import { TEST_STYLE } from "@docmaker/core/testing";
import {
  STYLE_MD_SECTIONS, GUIDE_MD_SECTIONS, findSections, lintPromptPack, loadStyleDir, rectsIntersect, validateStyleData,
} from "../src/index";
import { BUILTIN, FORBIDDEN_NAMES } from "./helpers";

const DIR = join(BUILTIN, "drama-commentary");
const readJson = async (f: string): Promise<unknown> => JSON.parse(await readFile(join(DIR, f), "utf8"));

describe("drama-commentary style.json (Appendix A)", () => {
  it("parses as StyleData and validates with 0 issues", async () => {
    const raw = await readJson("style.json");
    expect(StyleData.safeParse(raw).success).toBe(true);
    const issues = validateStyleData(raw, { fontFamilies: BUILTIN_FONT_FAMILIES });
    expect(issues).toEqual([]);
  });

  it("is exactly the Appendix A object, serialised with stableStringify", async () => {
    const text = await readFile(join(DIR, "style.json"), "utf8");
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(TEST_STYLE)));
    expect(text).toBe(stableStringify(TEST_STYLE));
  });

  it("story shapes: act shares sum to 1 ± 1e-6 and every shape has setup/confrontation/resolution acts", () => {
    for (const shape of TEST_STYLE.scriptProfile.storyShapes) {
      const sum = shape.acts.reduce((s, a) => s + a.share, 0);
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(1e-6);
      for (const m of ["setup", "confrontation", "resolution"] as const) expect(shape.acts.some((a) => a.macro === m)).toBe(true);
    }
    expect(TEST_STYLE.scriptProfile.storyShapes.map((s) => s.id)).toContain(TEST_STYLE.scriptProfile.defaultShape);
  });

  it("fonts ⊆ BUILTIN_FONT_FAMILIES", () => {
    const fams = [...Object.values(TEST_STYLE.tokens.fonts), TEST_STYLE.captionDNA.font, TEST_STYLE.captionDNA.clipStyle.font];
    for (const f of fams) expect(BUILTIN_FONT_FAMILIES).toContain(f);
  });

  it("zones inside 1920×1080 and captionBand ∩ keepOut = ∅", () => {
    const { zones, keepOut, safe } = TEST_STYLE.tokens.layout;
    for (const r of [safe, ...Object.values(zones), ...keepOut]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1920);
      expect(r.y + r.h).toBeLessThanOrEqual(1080);
    }
    for (const ko of keepOut) expect(rectsIntersect(zones.captionBand, ko)).toBe(false);
  });

  it("component triggers ⊆ DERIVABLE_TRIGGERS", () => {
    for (const c of TEST_STYLE.components) for (const t of c.triggers) expect(DERIVABLE_TRIGGERS[c.id]).toContain(t);
  });
});

describe("drama-commentary prompt pack", () => {
  it("loads, has 11 ordered STYLE.md sections and every GUIDE.md part, and lints clean", async () => {
    const p = await loadStyleDir(DIR, "builtin");
    const idx = findSections(p.promptPack.styleMd, STYLE_MD_SECTIONS);
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(findSections(p.promptPack.guideMd, GUIDE_MD_SECTIONS).every((i) => i >= 0)).toBe(true);
    expect(lintPromptPack(p.promptPack)).toEqual([]);
  });

  it("GUIDE.md states the normative rules and the banned list", async () => {
    const guide = (await readFile(join(DIR, "GUIDE.md"), "utf8")).toLowerCase();
    for (const s of ["hook in 5 s", "but / therefore", "every 120 s", "commentary after every clip", "one read at a time", "selective on-screen text", "no channel names", "## banned", "here's the thing", "invented tweets", "ai-generated images of real people"]) {
      expect(guide).toContain(s);
    }
  });

  it("prompts.json: every motion template has a parseable motion_data_json example with its fact-ref fields", async () => {
    const prompts = StylePrompts.parse(await readJson("prompts.json"));
    expect(prompts.narratorPersona.en.length).toBeGreaterThan(80);
    expect(prompts.narratorPersona.fr.length).toBeGreaterThan(80);
    const lines = new Map<string, { component: string; json: string }>();
    for (const m of prompts.visualGrammar.matchAll(/^- ([a-z_]+) \(([A-Za-z]+)[^)]*\): (\{.*\})$/gm)) lines.set(m[1]!, { component: m[2]!, json: m[3]! });
    for (const t of MotionTemplate.options) {
      if (t === "none") continue;
      const line = lines.get(t);
      expect(line, `format line for ${t}`).toBeDefined();
      expect(line!.component).toBe(TEMPLATE_COMPONENT[t]);
      const parsed = MotionData[t as MotionDataKey].safeParse(JSON.parse(line!.json));
      expect(parsed.success, `${t}: ${parsed.success ? "" : parsed.error.message}`).toBe(true);
    }
    for (const t of ["quote_card", "tweet_card"]) expect(lines.get(t)!.json).toContain('"quote_id"');
    expect(lines.get("document_highlight")!.json).toMatch(/"source_id".*"quote_id"/);
    for (const t of ["counter", "money_counter", "bar_chart", "line_chart"]) expect(lines.get(t)!.json).toContain('"figure_id"');
    expect(lines.get("headline_stack")!.json).toContain('"source_id"');
    expect(lines.get("timeline")!.json).toContain('"event_id"');
  });

  it("files are canonical JSON and name no real channel or creator", async () => {
    for (const style of await readdir(BUILTIN)) {
      for (const f of ["style.json", "prompts.json", "STYLE.md", "GUIDE.md"]) {
        const text = await readFile(join(BUILTIN, style, f), "utf8");
        if (f.endsWith(".json")) expect(text, `${style}/${f}`).toBe(stableStringify(JSON.parse(text)));
        const lower = text.toLowerCase();
        for (const n of FORBIDDEN_NAMES) expect(new RegExp(`\\b${n}\\b`).test(lower), `${style}/${f} mentions "${n}"`).toBe(false);
      }
    }
  });
});
