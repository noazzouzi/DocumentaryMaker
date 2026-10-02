import { describe, expect, it } from "vitest";
import { BUILTIN_FONT_FAMILIES, type StyleData } from "@docmaker/core";
import { TEST_STYLE } from "@docmaker/core/testing";
import { STYLE_RULES, validateStyleData } from "../src/index";

const clone = (): StyleData => structuredClone(TEST_STYLE) as StyleData;
const lint = (d: unknown, styleFonts?: Parameters<typeof validateStyleData>[1]["styleFonts"]) =>
  validateStyleData(d, { fontFamilies: BUILTIN_FONT_FAMILIES, styleFonts });
const errorsOf = (d: unknown) => lint(d).filter((i) => i.level === "error");
const rules = (d: unknown) => lint(d).map((i) => i.rule);

describe("validateStyleData", () => {
  it("never throws and reports schema problems with paths", () => {
    for (const bad of [null, 42, "x", [], {}]) {
      const issues = lint(bad);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((i) => i.level === "error" && i.rule === STYLE_RULES.schema)).toBe(true);
    }
    const d = clone() as unknown as { manifest: { id: string } };
    d.manifest.id = "Not A Slug";
    expect(lint(d)).toEqual([expect.objectContaining({ rule: STYLE_RULES.schema, where: "manifest.id" })]);
  });

  it("act shares must sum to 1 ± 1e-6", () => {
    const d = clone();
    d.scriptProfile.storyShapes[0]!.acts[0]!.share += 0.01;
    expect(errorsOf(d)).toEqual([expect.objectContaining({ rule: STYLE_RULES.actShares, where: "scriptProfile.storyShapes.rise-fall" })]);
    const ok = clone();
    ok.scriptProfile.storyShapes[0]!.acts[0]!.share += 5e-7; // inside tolerance
    expect(errorsOf(ok)).toEqual([]);
  });

  it("every shape needs setup, confrontation and resolution acts; order and act-keyed tables are checked", () => {
    const d = clone();
    for (const a of d.scriptProfile.storyShapes[1]!.acts) if (a.macro === "resolution") a.macro = "confrontation";
    expect(rules(d)).toContain(STYLE_RULES.macroActs);
    const o = clone();
    o.scriptProfile.storyShapes[0]!.acts[0]!.macro = "resolution";
    expect(lint(o)).toContainEqual(expect.objectContaining({ rule: STYLE_RULES.macroOrder, level: "warn" }));
    const k = clone();
    k.budgets.actIntensity["act9_typo"] = 1.1;
    expect(lint(k)).toContainEqual(expect.objectContaining({ rule: STYLE_RULES.unknownAct, level: "warn", where: "budgets.actIntensity" }));
    const dflt = clone();
    dflt.scriptProfile.defaultShape = "nope";
    expect(rules(dflt)).toContain(STYLE_RULES.defaultShape);
    const dup = clone();
    dup.scriptProfile.storyShapes[1]!.id = "rise-fall";
    expect(rules(dup)).toContain(STYLE_RULES.duplicateShape);
  });

  it("fonts must be built in or shipped by the style", () => {
    const d = clone();
    d.tokens.fonts.headline = "Comic Neue";
    expect(errorsOf(d)).toEqual([expect.objectContaining({ rule: STYLE_RULES.font, where: "tokens.fonts.headline" })]);
    const withFont = lint(d, [{ family: "Comic Neue", weight: 700, style: "normal", file: "comic.woff2", license: "OFL-1.1" }]);
    expect(withFont.filter((i) => i.level === "error")).toEqual([]);
    const c = clone();
    c.captionDNA.clipStyle.font = "Helvetica";
    expect(rules(c)).toContain(STYLE_RULES.font);
  });

  it("zones must be inside the frame and the caption band must avoid keep-outs", () => {
    const d = clone();
    d.tokens.layout.zones.topRight = { x: 1300, y: 64, w: 700, h: 80 };
    expect(errorsOf(d)).toContainEqual(expect.objectContaining({ rule: STYLE_RULES.zoneOutside, where: "tokens.layout.zones.topRight" }));
    const c = clone();
    c.tokens.layout.zones.captionBand = { x: 210, y: 900, w: 1500, h: 100 };
    expect(errorsOf(c)).toContainEqual(expect.objectContaining({ rule: STYLE_RULES.captionKeepOut }));
    const touching = clone();
    touching.tokens.layout.zones.captionBand = { x: 210, y: 810, w: 1500, h: 140 }; // ends exactly at y=950
    expect(errorsOf(touching)).toEqual([]);
    const lt = clone();
    lt.tokens.layout.zones.lowerThird = { x: 96, y: 860, w: 900, h: 160 };
    expect(lint(lt)).toContainEqual(expect.objectContaining({ rule: STYLE_RULES.zoneKeepOut, level: "warn" }));
  });

  it("component triggers must be derivable, ids unique, weights ≥ 0", () => {
    const d = clone();
    d.components.find((c) => c.id === "MapPin")!.triggers = ["PLACE"];
    expect(errorsOf(d)).toEqual([expect.objectContaining({ rule: STYLE_RULES.trigger, where: "components.MapPin" })]);
    const w = clone();
    w.components[0]!.weight = -1;
    expect(rules(w)).toContain(STYLE_RULES.weight);
    const dup = clone();
    dup.components.push({ ...dup.components[0]! });
    expect(rules(dup)).toContain(STYLE_RULES.duplicateComponent);
    const tw = clone();
    tw.transitionPolicy.weights.flash = -0.1;
    expect(rules(tw)).toContain(STYLE_RULES.weight);
  });

  it("transition keys must be valid", () => {
    const d = clone() as unknown as { transitionPolicy: { accents: string[]; weights: Record<string, number> } };
    d.transitionPolicy.accents.push("starWipe");
    expect(errorsOf(d)[0]).toMatchObject({ rule: STYLE_RULES.schema });
    const w = clone();
    w.transitionPolicy.weights.dissolve = 0.2; // valid key, but neither primary nor accent
    expect(lint(w)).toContainEqual(expect.objectContaining({ rule: STYLE_RULES.transitionWeights, level: "warn" }));
  });

  it("ranges must be ordered, eases valid, caption grouping coherent", () => {
    const d = clone();
    d.cameraPolicy.punch.scale = [1.25, 1.12];
    expect(errorsOf(d)).toEqual([expect.objectContaining({ rule: STYLE_RULES.range, where: "cameraPolicy.punch.scale" })]);
    const e = clone();
    e.motion.entryEase = [1.4, 1, 0.3, 1];
    expect(rules(e)).toContain(STYLE_RULES.bezier);
    const kb = clone();
    kb.motion.kbEase = [0.42, 0, 0.58, 1]; // ease-in-out stalls at both ends
    expect(lint(kb)).toContainEqual(expect.objectContaining({ rule: STYLE_RULES.kbEase, level: "warn" }));
    const g = clone();
    g.captionDNA.grouping.minWords = 6;
    expect(rules(g)).toContain(STYLE_RULES.grouping);
  });

  it("manifest uses must be accent-folded", () => {
    const d = clone();
    d.manifest.uses.push("Procès");
    expect(lint(d)).toContainEqual(expect.objectContaining({ rule: STYLE_RULES.uses, level: "warn" }));
  });

  it("is deterministic", () => {
    const d = clone();
    d.tokens.fonts.body = "Nope";
    d.cameraPolicy.punch.scale = [2, 1];
    expect(lint(d)).toEqual(lint(structuredClone(d)));
  });
});
