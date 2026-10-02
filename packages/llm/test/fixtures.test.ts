// Golden test (§6.9): the tulip-mania fixture runs through every step offline with 0 lint errors, 0 beat errors,
// no downgrades, FR/EN parity, and no high deterministic fact-check item.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { FixtureManifest, validateLangParity, type LintIssue } from "@docmaker/core";
import { TEST_STYLE } from "@docmaker/core/testing";
import {
  BeatSliceWire, ChapterBeatsWire, ChapterScriptWire, FactCheckWire, FactSheetWire, StyleSuggestionWire, buildOutlineWire,
  deterministicFactChecks, lintScript, planBudget, validateBeats, validateOutline,
} from "../src/index";
import { fixtureDir, runFixturePipeline, type PipelineResult } from "./helpers";

const errors = (xs: LintIssue[]) => xs.filter((x) => x.level === "error");

describe("tulip-mania fixture files", () => {
  const dir = join(fixtureDir("tulip-mania"), "llm");
  const acts = TEST_STYLE.scriptProfile.storyShapes.find((s) => s.id === "rise-fall")!.acts.map((a) => a.id);
  const schemaFor = (file: string) => {
    const step = file.split(".")[0]!;
    return ({
      factsheet: FactSheetWire, style: StyleSuggestionWire, outline: buildOutlineWire(acts), chapter: ChapterScriptWire, beats: ChapterBeatsWire,
      beatslice: BeatSliceWire, factcheck: FactCheckWire,
    } as Record<string, { parse(v: unknown): unknown } | undefined>)[step];
  };
  it("manifest parses (offline demo settings)", () => {
    const m = FixtureManifest.parse(JSON.parse(readFileSync(join(fixtureDir("tulip-mania"), "fixture.json"), "utf8")));
    expect(m).toMatchObject({ id: "tulip-mania", languages: ["en", "fr"], primaryLang: "en", targetMinutes: 1.5, seed: 1637, autoApproveGates: true, styleId: "drama-commentary" });
  });
  it("every llm/*.json file parses with its wire schema", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "research.json");
    expect(files.length).toBe(3 + 6 + 3 + 3 + 6);
    for (const f of files) {
      const schema = schemaFor(f);
      expect(schema, f).toBeDefined();
      expect(() => schema!.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))), f).not.toThrow();
    }
  });
});

describe("tulip-mania offline pipeline (golden)", () => {
  let r: PipelineResult;
  beforeAll(async () => {
    r = await runFixturePipeline("tulip-mania");
  });

  it("research registry and fact sheet use real public sources only", () => {
    expect(r.registry.entries.map((e) => e.id)).toEqual(["S1", "S2", "S3"]);
    expect(r.factSheet.sources.map((s) => s.url)).toEqual([
      "https://en.wikipedia.org/wiki/Tulip_mania", "https://books.google.com/books?id=gViwLbCJ7X0C", "https://www.gutenberg.org/ebooks/24518",
    ]);
    expect(r.factSheet.quotes.every((q) => q.verification === "unchecked" && q.verifiedBy === "none")).toBe(true);
    expect(r.factSheet.claims.filter((c) => c.madeBy.startsWith("Charles Mackay")).every((c) => c.status === "disputed")).toBe(true);
    expect(r.factSheet.people.map((p) => p.name)).toContain("Carolus Clusius");
  });

  it("budget, outline and style", () => {
    const b = planBudget(1.5, "en", TEST_STYLE.scriptProfile, "rise-fall");
    expect(b).toMatchObject({ words: 218, chapters: 3, runtimeSec: 90, narrationSec: 74 });
    expect(r.outline.chapters.map((c) => [c.id, c.act, c.adBreakAfter])).toEqual([["CH1", "cold_open", false], ["CH2", "act1_rise", false], ["CH3", "act3_reckoning", false]]);
    expect(r.outline.chapters.reduce((a, c) => a + c.targetWords, 0)).toBe(218);
    expect(errors(validateOutline(r.outline, TEST_STYLE))).toEqual([]);
    expect(r.style).toMatchObject({ recommendedStyleId: "drama-commentary", topicType: "history", riskFlags: ["none"], source: "fixture", stage: "research" });
  });

  it("scripts lint with 0 errors in both languages and keep FR/EN parity", () => {
    const en = lintScript({ lang: "en", profile: TEST_STYLE.scriptProfile, outline: r.outline, chapters: r.scripts.en.chapters, facts: r.factSheet });
    const fr = lintScript({ lang: "fr", profile: TEST_STYLE.scriptProfile, outline: r.outline, chapters: r.scripts.fr.chapters, facts: r.factSheet, primary: r.scripts.en.chapters });
    expect(errors(en)).toEqual([]);
    expect(errors(fr)).toEqual([]);
    expect(en.filter((x) => x.rule === "length-off-target")).toEqual([]);
    expect(fr.filter((x) => x.rule === "length-off-target")).toEqual([]);
    expect(validateLangParity(r.scripts.en, r.scripts.fr)).toEqual([]);
    expect(r.scripts.fr.chapters.flatMap((c) => c.segments).every((s) => s.primaryHash !== null)).toBe(true);
    expect(r.scripts.en.title).toBe("Tulip Mania: The Flower That Fooled History");
    const breath = r.scripts.en.chapters.flatMap((c) => c.segments).filter((s) => s.type === "music_breath");
    expect(breath.map((s) => s.breathMs)).toEqual([2000]);
    expect(r.scripts.en.chapters.flatMap((c) => c.segments).some((s) => s.type === "clip")).toBe(false);
  });

  it("beats: 0 errors, no downgrade, no fallback, required cues present", () => {
    for (const p of r.planIssues) {
      expect(p.method, p.chapterId).toBe("llm");
      expect(errors(p.issues), p.chapterId).toEqual([]);
      expect(p.issues.filter((x) => x.rule === "V_MOTION_DOWNGRADE" || x.rule === "CUE_ANCHOR"), p.chapterId).toEqual([]);
    }
    for (const ch of r.scripts.en.chapters) {
      const v = validateBeats({ plans: r.plans.plans, texts: r.slices.en.texts, chapter: ch, factSheet: r.factSheet, style: TEST_STYLE, lang: "en", primary: true });
      expect(errors(v.issues), ch.chapterId).toEqual([]);
      expect(v.issues.filter((x) => x.rule === "V_DURATION"), ch.chapterId).toEqual([]);
    }
    const plans = r.plans.plans;
    const cue = (t: string) => plans.filter((p) => p.cueTags.some((c) => c.type === t));
    for (const t of ["NUMBER", "PERSON_INTRO", "PLACE", "TIME_JUMP", "DOCUMENT", "REVEAL", "SHOCK", "EMPHASIS"]) expect(cue(t).length, t).toBeGreaterThan(0);
    const money = plans.find((p) => p.motionTemplate === "money_counter")!;
    const moneyText = r.slices.en.texts.find((t) => t.beatId === money.id)!;
    expect(moneyText.motionData).toMatchObject({ figure_id: "N1", value: 10000, currency: "NLG" });
    const shock = cue("SHOCK")[0]!;
    expect(shock.energy).toBe(5);
    const shockWords = r.slices.en.texts.find((t) => t.beatId === shock.id)!.onScreenText.split(/\s+/).length;
    expect(shockWords).toBeGreaterThanOrEqual(1);
    expect(shockWords).toBeLessThanOrEqual(3);
    expect(cue("PERSON_INTRO")[0]!.cueTags.find((c) => c.type === "PERSON_INTRO")!.value).toBe("Carolus Clusius");
    expect(cue("TIME_JUMP")[0]!.cueTags.find((c) => c.type === "TIME_JUMP")!.value).toBe("February 1637");
    const map = r.slices.en.texts.find((t) => t.beatId === plans.find((p) => p.motionTemplate === "map_route")!.id)!;
    expect(map.motionData).toMatchObject({ places: [{ label: "Haarlem" }] });
    const doc = r.slices.en.texts.find((t) => t.beatId === plans.find((p) => p.motionTemplate === "document_highlight")!.id)!;
    expect(doc.motionData).toMatchObject({ kind: "pamphlet", source_id: "S1" });
    expect(plans.filter((p) => p.id.endsWith("-BR"))).toHaveLength(1);
    expect(plans.map((p) => p.order)).toEqual(plans.map((_, i) => i));
  });

  it("FR slices: same beat ids, exact reconstruction via the LLM path, numbers copied from EN", () => {
    for (const s of r.sliceIssues) {
      expect(s.method, s.chapterId).toBe("llm");
      expect(errors(s.issues), s.chapterId).toEqual([]);
      expect(s.issues.filter((x) => x.rule === "V_MOTION_SECONDARY" || x.rule === "CUE_ANCHOR"), s.chapterId).toEqual([]);
    }
    expect(r.slices.fr.texts.map((t) => t.beatId)).toEqual(r.slices.en.texts.map((t) => t.beatId));
    const money = r.plans.plans.find((p) => p.motionTemplate === "money_counter")!;
    expect(r.slices.fr.texts.find((t) => t.beatId === money.id)!.motionData).toMatchObject({ figure_id: "N1", value: 10000, currency: "NLG", label: "un bulbe de Semper Augustus" });
    const qc = r.plans.plans.filter((p) => p.motionTemplate === "quote_card");
    for (const p of qc) expect(r.slices.fr.texts.find((t) => t.beatId === p.id)!.motionData.translated).toBe(true);
  });

  it("fact-check: no high item, deterministic rules stable", () => {
    for (const lang of ["en", "fr"] as const) {
      const fc = r.factChecks[lang];
      expect(fc.items.filter((x) => x.risk === "high"), lang).toEqual([]);
      const det = deterministicFactChecks({ script: r.scripts[lang], slices: r.slices[lang], plans: r.plans, factSheet: r.factSheet, publish: null, riskFlags: [] });
      expect(det.filter((x) => x.risk === "high"), lang).toEqual([]);
      expect(det.filter((x) => x.rule === "b"), lang).toEqual([]);
      expect(new Set(det.map((x) => x.id)).size).toBe(det.length);
    }
    expect(r.ctx.costs.receipts).toEqual([]); // fixtures cost nothing
  });
});
