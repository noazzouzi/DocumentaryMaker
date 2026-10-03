// planBudget goldens, lintScript rules (§6.6) and validateOutline.
import { describe, expect, it } from "vitest";
import { Outline, type ChapterScript, type FactSheet, type ScriptSegment } from "@docmaker/core";
import { TEST_NOW, TEST_STYLE, makeFactSheet, makeScript } from "@docmaker/core/testing";
import { lintScript, planBudget, validateOutline } from "../src/index";

const P = TEST_STYLE.scriptProfile;

describe("planBudget", () => {
  it.each([
    [15, 2174, 231],
    [20, 2899, 307],
    [30, 4349, 461],
  ])("DRAMA EN %i min → %i words, ≈%i beats", (min, words, beats) => {
    const b = planBudget(min, "en", P, "rise-fall");
    expect(b.words).toBe(words);
    expect(b.beatsApprox).toBe(beats);
    expect(b.chapters).toBeGreaterThanOrEqual(5);
    expect(Object.values(b.perAct).reduce((a, x) => a + x, 0)).toBeGreaterThanOrEqual(words - 8);
  });
  it("demo 1.5 min → 3 chapters; FR uses its own cps and chars/word; voice cps override", () => {
    expect(planBudget(1.5, "en", P, "rise-fall")).toMatchObject({ runtimeSec: 90, narrationSec: 74, chars: 1218, words: 218, chapters: 3 });
    const fr = planBudget(15, "fr", P, "rise-fall");
    expect(fr).toMatchObject({ charsPerSec: 16, chars: 11808, words: Math.round(11808 / 5.7) });
    expect(planBudget(15, "en", P, "rise-fall", 15).charsPerSec).toBe(15);
    expect(planBudget(30, "en", P, "rise-fall").chapters).toBe(Math.round(1800 / 195));
    expect(planBudget(2, "en", P, "nope").storyShape).toBe("rise-fall"); // falls back to the default shape
    expect(() => planBudget(0, "en", P, "rise-fall")).toThrow();
  });
});

// ---------------------------------------------------------------- lint
function seg(id: string, displayText: string, o: Partial<ScriptSegment> = {}): ScriptSegment {
  return {
    id, type: "narration", displayText, ttsText: displayText, ttsTextEdited: false, quoteId: null, subtitleTranslation: "", factIds: ["S1"],
    device: "none", breathMs: 0, primaryHash: null, ...o,
  };
}
function chapter(id: string, segments: ScriptSegment[], o: Partial<ChapterScript> = {}): ChapterScript {
  return { chapterId: id, title: id, segments, loopsOpened: [], loopsClosed: [], summaryForNext: "", userEdited: false, locked: false, ...o };
}
function outline(chapters: { id: string; act?: string; targetSec?: number; adBreakAfter?: boolean }[], o: Partial<Outline> = {}): Outline {
  const budget = planBudget(1.5, "en", P, "rise-fall");
  return Outline.parse({
    schemaVersion: 1, lang: "en", title: "t", thesis: "t", thesisConfirmed: false, storyShape: "rise-fall", hookTeasers: [], loops: [],
    chapters: chapters.map((c, k) => ({
      id: c.id, act: c.act ?? (k === 0 ? "cold_open" : "act1_rise"), title: c.id, targetSec: c.targetSec ?? 10, targetWords: Math.round(((c.targetSec ?? 10) * 16.5) / 5.6),
      purpose: "", eventIds: [], claimIds: [], quoteIds: [], opensLoops: [], closesLoops: [], exitHook: "", adBreakAfter: c.adBreakAfter ?? false,
    })),
    callbackPlan: [], nextVideoBridge: "", budget, budgets: { en: budget }, generatedBy: "user", updatedAt: TEST_NOW, ...o,
  });
}
const facts = (): FactSheet => {
  const f = makeFactSheet({ people: 3, quotes: 2 });
  f.people[2] = { ...f.people[2]!, name: "Jeanne Martin", isMinorOrPrivateVictim: true, publicFigure: false };
  f.claims.push({ id: "C3", summary: "x", madeBy: "y", against: "z", status: "allegation", jurisdiction: "", decisionDate: "", subjectResponse: "", asOf: "2026-10-02", sensitivity: "high", sourceIds: ["S1"] });
  return f;
};
const lint = (chapters: ChapterScript[], o?: { lang?: "en" | "fr"; outline?: Outline; facts?: FactSheet; primary?: ChapterScript[] }) =>
  lintScript({ lang: o?.lang ?? "en", profile: P, outline: o?.outline ?? outline(chapters.map((c) => ({ id: c.chapterId }))), chapters, facts: o?.facts ?? facts(), primary: o?.primary });
const rules = (xs: { rule: string; level: string }[], level = "error") => xs.filter((x) => x.level === level).map((x) => x.rule);

describe("lintScript", () => {
  it("flags « En 2016, il a battu sa femme » and accepts the attributed, conditional version", () => {
    const bad = lint([chapter("CH1", [seg("CH1-S01", "En 2016, il a battu sa femme.")])], { lang: "fr" });
    expect(rules(bad)).toContain("accusatory-unattributed");
    const ok = lint([chapter("CH1", [seg("CH1-S01", "Selon Amber Heard, il l'aurait frappée…, ce que l'acteur a toujours nié.")])], { lang: "fr" });
    expect(rules(ok)).not.toContain("accusatory-unattributed");
    const en = lint([chapter("CH1", [seg("CH1-S01", "He stole the money. Prosecutors allege he stole the money.")])]);
    expect(en.filter((x) => x.rule === "accusatory-unattributed")).toHaveLength(1);
  });
  it("broader accusatory vocabulary (EN and FR) needs attribution too", () => {
    const flagged = (lang: "en" | "fr", text: string) => lint([chapter("CH1", [seg("CH1-S01", text)])], { lang }).some((x) => x.rule === "accusatory-unattributed");
    for (const s of ["In 2016, he beat his wife.", "He defrauded investors.", "She harassed her staff.", "He laundered the proceeds.", "He bribed officials.", "The mayor was corrupt.", "He lied to investors and cheated."]) {
      expect(flagged("en", s), s).toBe(true);
    }
    expect(flagged("en", "Prosecutors allege he defrauded investors.")).toBe(false);
    for (const s of ["Il a harcelé ses employés.", "Il l'a tuée en 2016.", "Le maire est corrompu.", "Il a blanchi l'argent.", "C'est un menteur."]) {
      expect(flagged("fr", s), s).toBe(true);
    }
    expect(flagged("fr", "Selon l'accusation, il aurait blanchi l'argent.")).toBe(false);
  });
  it("number-without-fact, banned opener (first 60 s only), banned phrase, and-then chain", () => {
    const xs = lint([chapter("CH1", [
      seg("CH1-S01", "In this video, the price hit 5,500 guilders.", { factIds: [] }),
      seg("CH1-S02", "Then the price rose. Then it rose again. And then it fell. Here's the thing about bubbles."),
    ])]);
    expect(rules(xs)).toEqual(expect.arrayContaining(["number-without-fact", "banned-opener"]));
    expect(rules(xs, "warn")).toEqual(expect.arrayContaining(["and-then-chain", "banned-phrase"]));
    const late = lint([chapter("CH1", [seg("CH1-S01", "x ".repeat(600)), seg("CH1-S02", "In this video we learn nothing.")])]);
    expect(rules(late)).not.toContain("banned-opener");
  });
  it("clip rules: quote verbatim, translation, commentary must follow, clip share", () => {
    const f = facts();
    f.quotes[1] = { ...f.quotes[1]!, language: "nl" };
    const clip = (id: string, quoteId: string, text: string, o: Partial<ScriptSegment> = {}) => seg(id, text, { type: "clip", quoteId, factIds: [quoteId], ttsText: "", ...o });
    const xs = lint([chapter("CH1", [
      seg("CH1-S01", "Set up."),
      clip("CH1-S02", "Q1", f.quotes[0]!.verbatim.replace("fever", "flu")),
      seg("CH1-S03", "Reaction."),
      clip("CH1-S04", "Q2", f.quotes[1]!.verbatim),
      clip("CH1-S05", "Q9", "Unknown"),
    ])], { facts: f });
    const errs = xs.filter((x) => x.level === "error");
    expect(errs.filter((x) => x.rule === "clip-quote").map((x) => x.where)).toEqual(["CH1-S02", "CH1-S05"]);
    expect(errs.filter((x) => x.rule === "clip-translation").map((x) => x.where)).toEqual(["CH1-S04"]);
    expect(errs.filter((x) => x.rule === "clip-commentary-follows").map((x) => x.where)).toEqual(["CH1-S04", "CH1-S05"]);
    expect(xs.filter((x) => x.rule === "clip-share")[0]?.level).toBe("warn"); // ≈ 13 s of clips in a 90 s video (10–15 %)
    const many = lint([chapter("CH1", [1, 2, 3, 4].flatMap((k) => [seg(`CH1-S0${2 * k - 1}`, "Set up."), clip(`CH1-S0${2 * k}`, "Q1", f.quotes[0]!.verbatim)]).concat(seg("CH1-S09", "End.")))], { facts: f });
    expect(many.filter((x) => x.rule === "clip-share")[0]?.level).toBe("error");
    const fine = lint([chapter("CH1", [seg("CH1-S01", "Set up."), clip("CH1-S02", "Q1", f.quotes[0]!.verbatim), seg("CH1-S03", "Reaction.")])], { facts: f });
    expect(rules(fine)).toEqual([]);
  });
  it("private-person and status-wording", () => {
    const xs = lint([chapter("CH1", [
      seg("CH1-S01", "Jeanne Martin was there that night."),
      seg("CH1-S02", "He hid the money.", { factIds: ["C3", "S1"] }),
      seg("CH1-S03", "He allegedly hid the money.", { factIds: ["C3", "S1"] }),
    ])]);
    expect(xs.filter((x) => x.level === "error").map((x) => [x.rule, x.where])).toEqual([["private-person", "CH1-S01"], ["status-wording", "CH1-S02"]]);
  });
  it("structure: ad break needs a cliffhanger, loops and teasers must pay off, hook length, length-off-target", () => {
    const o = outline([{ id: "CH1", targetSec: 2, adBreakAfter: true }, { id: "CH2" }], {
      loops: [{ id: "L1", question: "?", openedIn: "CH1", closedIn: "CH2" }],
      hookTeasers: [{ id: "T1", teaser: "t", paidOffIn: "CH2" }],
    });
    const long = "word ".repeat(260).trim() + ".";
    const ch1 = chapter("CH1", [seg("CH1-S01", long, { device: "none" })], { loopsOpened: ["L1"] });
    const partial = lint([ch1], { outline: o });
    expect(rules(partial)).toEqual(["adbreak-no-cliffhanger"]); // L1/T1 are not due yet (CH2 not written)
    expect(rules(partial, "warn")).toEqual(expect.arrayContaining(["hook-too-long", "length-off-target"]));
    const full = lint([ch1, chapter("CH2", [seg("CH2-S01", "The end.", { device: "payoff" })], { loopsClosed: ["L2"] })], { outline: o });
    expect(rules(full)).toEqual(expect.arrayContaining(["adbreak-no-cliffhanger", "loop-unpaid"]));
    expect(rules(full, "warn")).toContain("loop-order");
    const missingTeaser = lint([ch1], { outline: outline([{ id: "CH1" }], { hookTeasers: [{ id: "T1", teaser: "t", paidOffIn: "CH1" }] }) });
    expect(rules(missingTeaser)).not.toContain("teaser-unpaid");
  });
  it("device-gap after maxGapNoDeviceSec without a device", () => {
    const filler = "word ".repeat(400).trim() + "."; // ≈ 121 s at 16.5 cps
    const xs = lint([chapter("CH1", [seg("CH1-S01", filler), seg("CH1-S02", "Wait.", { device: "re_hook" })])]);
    expect(rules(xs, "warn")).toContain("device-gap");
  });
  it("lang-parity against the primary chapters", () => {
    const en = makeScript({ lang: "en", chapters: 2 });
    const fr = makeScript({ lang: "fr", chapters: 2 });
    const o = outline([{ id: "CH1" }, { id: "CH2" }]);
    expect(rules(lintScript({ lang: "fr", profile: P, outline: o, chapters: fr.chapters, facts: makeFactSheet(), primary: en.chapters })).filter((r) => r === "lang-parity")).toEqual([]);
    const broken = fr.chapters.map((c) => (c.chapterId === "CH2" ? { ...c, segments: c.segments.slice(1) } : c));
    expect(rules(lintScript({ lang: "fr", profile: P, outline: o, chapters: broken, facts: makeFactSheet(), primary: en.chapters }))).toContain("lang-parity");
  });
});

describe("validateOutline", () => {
  it("accepts the shape's acts and a balanced word sum; reports structural errors", () => {
    const good = outline([{ id: "CH1", targetSec: 17 }, { id: "CH2", targetSec: 30.5 }, { id: "CH3", act: "act3_reckoning", targetSec: 26.5 }]);
    const fixed = { ...good, chapters: good.chapters.map((c, k) => ({ ...c, targetWords: [50, 90, 78][k]! })) };
    expect(validateOutline(fixed, TEST_STYLE).filter((x) => x.level === "error")).toEqual([]);
    const bad = {
      ...fixed,
      chapters: [{ ...fixed.chapters[0]!, act: "act9" }, { ...fixed.chapters[1]!, id: "CH5", targetWords: 400 }, fixed.chapters[2]!],
      hookTeasers: [{ id: "T1", teaser: "x", paidOffIn: "CH9" }],
      loops: [{ id: "L1", question: "?", openedIn: "CH3", closedIn: "CH1" }],
    };
    expect(validateOutline(bad, TEST_STYLE).filter((x) => x.level === "error").map((x) => x.rule).sort()).toEqual(
      ["loop-order", "outline-act", "outline-ids", "outline-words", "teaser-unpaid"].sort(),
    );
  });
  it("warns when a long video has no ad break or the first break is off-window", () => {
    const budget = planBudget(20, "en", P, "rise-fall");
    const long = outline(Array.from({ length: 6 }, (_, k) => ({ id: `CH${k + 1}`, targetSec: 160 })), { budget, budgets: { en: budget } });
    expect(validateOutline(long, TEST_STYLE).some((x) => x.rule === "outline-adbreak")).toBe(true);
    // 160 s of narration ≈ 195 s of runtime per chapter: a break after CH1 is in [180, 300], after CH2 it is not
    const withBreak = { ...long, chapters: long.chapters.map((c, k) => ({ ...c, adBreakAfter: k === 0 })) };
    expect(validateOutline(withBreak, TEST_STYLE).filter((x) => x.rule === "outline-adbreak")).toEqual([]);
    const late = { ...long, chapters: long.chapters.map((c, k) => ({ ...c, adBreakAfter: k === 1 })) };
    expect(validateOutline(late, TEST_STYLE).filter((x) => x.rule === "outline-adbreak").map((x) => x.where)).toEqual(["CH2"]);
  });
});
