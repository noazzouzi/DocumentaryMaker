// Beat planning and validation: fact-ref downgrades, AI+person rewrite, splitter, synthetic beats, plan keys, slicing.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DocmakerError, beatWordRanges, type BeatLang, type BeatPlan, type ChapterScript, type FactSheet } from "@docmaker/core";
import { TEST_STYLE, makeBeats, makeFactSheet, makeScript, planKeyOf } from "@docmaker/core/testing";
import {
  assembleBeatPlans, computePlanKey, copyInvariantFields, insideQuote, planBeats, sliceBeats, splitBeatsFallback, syntheticBeats, validateBeats,
  type ChapterBeatsWire, type LlmClient, type StructuredRequest,
} from "../src/index";
import { TEST_PLUGIN, makeCtx } from "./helpers";

// ---------------------------------------------------------------- fixtures in code
const FS: FactSheet = (() => {
  const f = makeFactSheet({ people: 2, quotes: 2, figures: 2 });
  f.sources[1] = { ...f.sources[1]!, publisher: "The Economist", title: "The tulip bubble that never was" };
  return f;
})();
const SEG = "The price hit 5,500 guilders. Nobody asked what a flower was worth. Then the buyers vanished.";
const CH: ChapterScript = {
  chapterId: "CH2", title: "The Bubble", loopsOpened: [], loopsClosed: [], summaryForNext: "", userEdited: false, locked: false,
  segments: [
    { id: "CH2-S01", type: "narration", displayText: SEG, ttsText: SEG, ttsTextEdited: false, quoteId: null, subtitleTranslation: "", factIds: ["N1", "S1"], device: "none", breathMs: 0, primaryHash: null },
    { id: "CH2-S02", type: "clip", displayText: FS.quotes[0]!.verbatim, ttsText: "", ttsTextEdited: false, quoteId: "Q1", subtitleTranslation: "", factIds: ["Q1"], device: "none", breathMs: 0, primaryHash: null },
    { id: "CH2-S03", type: "narration", displayText: "What a line.", ttsText: "What a line.", ttsTextEdited: false, quoteId: null, subtitleTranslation: "", factIds: ["S1"], device: "none", breathMs: 0, primaryHash: null },
    { id: "CH2-S04", type: "music_breath", displayText: "", ttsText: "", ttsTextEdited: false, quoteId: null, subtitleTranslation: "", factIds: [], device: "none", breathMs: 2000, primaryHash: null },
  ],
};
const SLICES = ["The price hit 5,500 guilders.", "Nobody asked what a flower was worth.", "Then the buyers vanished."];

function plan(id: string, segmentId: string, o: Partial<BeatPlan> = {}): BeatPlan {
  const p: BeatPlan = {
    id, chapterId: "CH2", segmentId, order: 0, origin: "llm", purpose: "context", energy: 3, estSeconds: 2, visualKind: "archival_photo",
    visualQuery: `q ${id}`, personIds: [], quoteId: null, youtubeQuoteToFind: "", motionTemplate: "none", camera: "ken_burns", transitionIn: "cut",
    sfx: [], musicCue: "none", musicMood: "tense", factIds: ["S1"], cueTags: [], planKey: "", ...o,
  };
  return { ...p, planKey: computePlanKey(p) };
}
const text = (beatId: string, t: string, o: Partial<BeatLang> = {}): BeatLang => ({ beatId, lang: "en", text: t, onScreenText: "", cueAnchorIdx: [], emphasisIdx: [], motionData: {}, ...o });
function base() {
  const plans = [plan("CH2-B001", "CH2-S01"), plan("CH2-B002", "CH2-S01"), plan("CH2-B003", "CH2-S01"), plan("CH2-B004", "CH2-S03")];
  const texts = [text("CH2-B001", SLICES[0]!), text("CH2-B002", SLICES[1]!), text("CH2-B003", SLICES[2]!), text("CH2-B004", "What a line.")];
  return { plans, texts };
}
const validate = (plans: BeatPlan[], texts: BeatLang[], primary = true) =>
  validateBeats({ plans, texts, chapter: CH, factSheet: FS, style: TEST_STYLE, lang: "en", primary });
const withMotion = (template: BeatPlan["motionTemplate"], motionData: Record<string, unknown>, o: Partial<BeatPlan> = {}) => {
  const b = base();
  b.plans[0] = plan("CH2-B001", "CH2-S01", { motionTemplate: template, visualKind: "motion_graphic", ...o });
  b.texts[0] = text("CH2-B001", SLICES[0]!, { motionData, onScreenText: "5,500 GUILDERS" });
  return b;
};

describe("validateBeats", () => {
  it("accepts exact slices; reports reconstruction failures and beats on non-narration segments", () => {
    const b = base();
    expect(validate(b.plans, b.texts).issues.filter((x) => x.level === "error")).toEqual([]);
    const broken = base();
    broken.texts[1] = text("CH2-B002", "Nobody asked what a tulip was worth.");
    expect(validate(broken.plans, broken.texts).issues.filter((x) => x.level === "error").map((x) => [x.rule, x.where])).toEqual([["V_RECONSTRUCT", "CH2-S01"]]);
    const wrongSeg = base();
    wrongSeg.plans.push(plan("CH2-B005", "CH2-S02"));
    wrongSeg.texts.push(text("CH2-B005", "x"));
    expect(validate(wrongSeg.plans, wrongSeg.texts).issues.map((x) => x.rule)).toContain("V_SEGMENT");
    const missing = base();
    expect(validate(missing.plans.slice(0, 3), missing.texts.slice(0, 3)).issues.map((x) => [x.rule, x.where])).toContainEqual(["V_NO_BEATS", "CH2-S03"]);
  });

  it("keeps valid fact refs and fills defaults (wire keys kept)", () => {
    const b = withMotion("money_counter", { figure_id: "n1", value: 5500, currency: "NLG", label: "one bulb" });
    const v = validate(b.plans, b.texts);
    expect(v.issues.filter((x) => x.rule === "V_MOTION_DOWNGRADE")).toEqual([]);
    expect(v.texts[0]!.motionData).toEqual({ figure_id: "N1", value: 5500, from: 0, currency: "NLG", label: "one bulb", compact: true });
  });

  it.each([
    ["wrong counter value", "counter", { figure_id: "N1", value: 9999 }],
    ["unknown figure", "money_counter", { figure_id: "N7", value: 5500 }],
    ["fake tweet", "tweet_card", { quote_id: "Q1", display_name: "Merchant", body: "Tulips to the moon!" }],
    ["tweet without a quote", "tweet_card", { quote_id: "", display_name: "x", body: "y" }],
    ["invented headline", "headline_stack", { items: [{ source_id: "S2", outlet: "The Economist", headline: "Tulip traders arrested in Haarlem" }] }],
    ["wrong outlet", "headline_stack", { items: [{ source_id: "S2", outlet: "The Times", headline: "The tulip bubble that never was" }] }],
    ["paraphrased quote card", "quote_card", { quote_id: "Q2", text: "Nobody knew the value of a bulb.", speaker: "x" }],
    ["timeline date mismatch", "timeline", { events: [{ date: "1594", label: "a", event_id: "E1" }, { date: "1637", label: "b", event_id: "" }] }],
    ["schema failure", "map_route", { places: [] }],
    ["document passage ≠ quote", "document_highlight", { source_id: "S1", quote_id: "Q1", title: "Pamphlet", paragraphs: ["x"], highlight: "an invented line" }],
  ])("%s → downgraded to kinetic_text with a warning", (_n, template, data) => {
    const b = withMotion(template as BeatPlan["motionTemplate"], data as Record<string, unknown>, { quoteId: "Q1" });
    const v = validate(b.plans, b.texts);
    const down = v.issues.filter((x) => x.rule === "V_MOTION_DOWNGRADE");
    expect(down).toHaveLength(1);
    expect(down[0]!.level).toBe("warn");
    expect(v.plans[0]!.motionTemplate).toBe("kinetic_text");
    expect(v.plans[0]!.quoteId).toBeNull();
    expect(v.plans[0]!.planKey).toBe(planKeyOf(v.plans[0]!));
    expect(v.texts[0]!.motionData).toEqual({ lines: ["5,500 GUILDERS"], emphasis: [] });
  });

  it("valid quote / headline / timeline refs pass; secondary languages may transcreate display strings (flagged)", () => {
    const q = withMotion("quote_card", { quote_id: "Q2", text: `“${FS.quotes[1]!.verbatim}”`, speaker: "Clusius" });
    expect(validate(q.plans, q.texts).issues.filter((x) => x.rule.startsWith("V_MOTION"))).toEqual([]);
    const h = withMotion("headline_stack", { items: [{ source_id: "S2", outlet: "the economist", headline: "The Tulip Bubble That Never Was" }] });
    expect(validate(h.plans, h.texts).issues.filter((x) => x.rule.startsWith("V_MOTION"))).toEqual([]);
    const t = withMotion("timeline", { events: [{ date: "1593", label: "a", event_id: "E1" }, { date: "1637-02-03", label: "b", event_id: "E2" }] });
    expect(validate(t.plans, t.texts).issues.filter((x) => x.rule.startsWith("V_MOTION"))).toEqual([]);
    const fr = withMotion("quote_card", { quote_id: "Q2", text: "Personne ne savait ce que valait un bulbe.", speaker: "x" });
    const v = validate(fr.plans, fr.texts, false);
    expect(v.issues.filter((x) => x.rule.startsWith("V_MOTION"))).toEqual([]);
    expect(v.texts[0]!.motionData.translated).toBe(true);
    expect(v.plans[0]!.motionTemplate).toBe("quote_card"); // plans are never changed by a secondary language
  });

  it("an AI illustration of a real person is an error and is rewritten to a graphic", () => {
    const b = base();
    b.plans[1] = plan("CH2-B002", "CH2-S01", { visualKind: "ai_illustration", personIds: ["P1"] });
    const v = validate(b.plans, b.texts);
    expect(v.issues.filter((x) => x.rule === "V_AI_PERSON")).toHaveLength(1);
    expect(v.plans[1]).toMatchObject({ visualKind: "text_card", motionTemplate: "kinetic_text" });
    expect(v.plans[1]!.planKey).not.toBe(b.plans[1]!.planKey);
    expect(v.texts[1]!.motionData).toMatchObject({ lines: ["Nobody asked what a flower was"] });
  });

  it("cue anchors, durations, same-visual runs, cue budgets and bleeps", () => {
    const b = base();
    b.plans[0] = plan("CH2-B001", "CH2-S01", { cueTags: [{ type: "REVEAL", value: "" }, { type: "SENSITIVE", value: "bleep" }], visualQuery: "same" });
    b.plans[1] = plan("CH2-B002", "CH2-S01", { cueTags: [{ type: "REVEAL", value: "" }], visualQuery: "same" });
    b.plans[2] = plan("CH2-B003", "CH2-S01", { visualQuery: "same" });
    b.plans[3] = plan("CH2-B004", "CH2-S03", { visualQuery: "same" });
    b.texts[0] = text("CH2-B001", SLICES[0]!, { cueAnchorIdx: [9], emphasisIdx: [1, 1, 30] });
    const v = validate(b.plans, b.texts);
    const r = v.issues.map((x) => x.rule);
    expect(r).toEqual(expect.arrayContaining(["CUE_ANCHOR", "V_SAME_VISUAL", "V_CUE_BUDGET", "V_BLEEP_OUTSIDE_QUOTE", "V_DURATION"]));
    expect(v.texts[0]!.cueAnchorIdx).toEqual([-1, -1]);
    expect(v.texts[0]!.emphasisIdx).toEqual([1]);
    expect(v.plans[0]!.cueTags[1]).toEqual({ type: "SENSITIVE", value: "" });
    expect(v.issues.filter((x) => x.level === "error")).toEqual([]);
  });

  it("insideQuote", () => {
    const t = "He said « damn it » and left. Then \"hell\" again.";
    expect(insideQuote(t, t.indexOf("damn"))).toBe(true);
    expect(insideQuote(t, t.indexOf("left"))).toBe(false);
    expect(insideQuote(t, t.indexOf("hell"))).toBe(true);
  });
});

describe("splitBeatsFallback", () => {
  const long = "In 1637, the market froze. Buyers vanished, sellers panicked; contracts went unpaid — and the courts, slowly, stepped in. Nobody was ever paid in full.";
  it.each([[[1, 1, 1]], [[3, 1]], [[1, 1, 1, 1, 1, 1]], [[]], [[0, 0]]])("reconstructs the segment exactly (shares %j)", (shares) => {
    const out = splitBeatsFallback(long, shares);
    expect(() => beatWordRanges(long, out)).not.toThrow();
    expect(out.join(" ").replace(/\s+/g, " ")).toBe(long);
    if (shares.length > 0) expect(out).toHaveLength(shares.length);
    expect(out.every((s) => s.trim() === s && s !== "")).toBe(true);
  });
  it("prefers sentence ends, then clause punctuation", () => {
    // previous char shares are followed; a sentence end near the target wins over a word boundary
    expect(splitBeatsFallback(long, [26, 125])[0]).toBe("In 1637, the market froze.");
    expect(splitBeatsFallback(long, [30, 121])[0]).toBe("In 1637, the market froze.");
    expect(splitBeatsFallback("Alpha beta gamma, delta epsilon zeta eta theta", [1, 1])).toEqual(["Alpha beta gamma,", "delta epsilon zeta eta theta"]);
    expect(splitBeatsFallback(long, [])).toEqual(["In 1637, the market froze.", "Buyers vanished, sellers panicked; contracts went unpaid — and the courts, slowly, stepped in.", "Nobody was ever paid in full."]);
  });
  it("never returns more slices than words; FR guillemets stay with their words", () => {
    expect(splitBeatsFallback("Deux mots", [1, 1, 1, 1])).toEqual(["Deux", "mots"]);
    const fr = "Il a dit « non » puis il est parti.";
    const out = splitBeatsFallback(fr, [1, 1]);
    expect(() => beatWordRanges(fr, out)).not.toThrow();
    expect(out[0]).toBe("Il a dit « non »");
    expect(splitBeatsFallback("", [1])).toEqual([]);
  });
});

describe("synthetic beats, plan keys, ordering", () => {
  it("computePlanKey = sha16(hashJson(visual identity)); text-only edits keep it", () => {
    const p = plan("CH2-B001", "CH2-S01");
    expect(p.planKey).toMatch(/^[a-f0-9]{16}$/);
    expect(p.planKey).toBe(planKeyOf(p));
    const edited: BeatPlan = { ...p, energy: 5, estSeconds: 9 };
    expect(computePlanKey(edited)).toBe(p.planKey);
    expect(computePlanKey({ ...p, visualQuery: "other" })).not.toBe(p.planKey);
  });
  it("one -CLIP beat per clip and one -BR per breath, empty texts in every language", () => {
    const script = makeScript({ chapters: 2, withClip: true, withBreath: true });
    const { plans, texts } = syntheticBeats(script, ["en", "fr"], 100);
    expect(plans.map((p) => p.id)).toEqual(["CH1-S05-BR", "CH2-S03-CLIP"]);
    const clip = plans[1]!;
    expect(clip).toMatchObject({ origin: "clip", visualKind: "youtube_clip", quoteId: "Q1", energy: 3, camera: "static", musicCue: "duck", factIds: ["Q1"], order: 101 });
    expect(clip.cueTags).toEqual([{ type: "CLIP_REF", value: "Q1" }]);
    expect(plans[0]).toMatchObject({ origin: "breath", energy: 4, musicCue: "none", motionTemplate: "none", estSeconds: 2, cueTags: [{ type: "MONTAGE", value: "" }] });
    expect(texts).toHaveLength(4);
    expect(texts.every((t) => t.text === "" && t.onScreenText === "" && t.cueAnchorIdx.join() === "-1" && t.emphasisIdx.length === 0)).toBe(true);
  });
  it("breath beats copy the previous narration beat's visual; assembleBeatPlans orders by script position", () => {
    const script = makeScript({ chapters: 2, withClip: true, withBreath: true });
    const narr = makeBeats(script).plans.plans.filter((p) => p.origin === "llm");
    const out = assembleBeatPlans(script, narr, ["en"]);
    const br = out.plans.find((p) => p.id === "CH1-S05-BR")!;
    const prev = narr.filter((p) => p.chapterId === "CH1").at(-1)!;
    expect([br.visualKind, br.visualQuery]).toEqual([prev.visualKind, prev.visualQuery]);
    expect(out.plans.map((p) => p.order)).toEqual(out.plans.map((_, i) => i));
    const clipIdx = out.plans.findIndex((p) => p.id === "CH2-S03-CLIP");
    expect(out.plans[clipIdx - 1]!.segmentId).toBe("CH2-S02");
    expect(out.plans[clipIdx + 1]!.segmentId).toBe("CH2-S04");
  });
});

describe("sliceBeats", () => {
  it("deterministic primary re-slice after an edit keeps ids and annotations", async () => {
    const b = base();
    b.plans[0] = plan("CH2-B001", "CH2-S01", { cueTags: [{ type: "NUMBER", value: "5500" }] });
    b.texts[0] = text("CH2-B001", SLICES[0]!, { cueAnchorIdx: [3], emphasisIdx: [3], onScreenText: "5,500" });
    const edited = { ...CH, segments: CH.segments.map((s) => (s.id === "CH2-S01" ? { ...s, displayText: "By then the price hit 5,500 guilders. Nobody asked what a flower was really worth. Then buyers vanished." } : s)) };
    const r = await sliceBeats(null, { plans: b.plans, primaryTexts: b.texts, chapter: edited, lang: "en", factSheet: FS, mode: "deterministic", style: TEST_STYLE });
    expect(r.method).toBe("fallback");
    expect(r.issues.filter((x) => x.level === "error")).toEqual([]);
    const t1 = r.texts.find((t) => t.beatId === "CH2-B001")!;
    expect(t1.text).toBe("By then the price hit 5,500 guilders.");
    expect(t1.cueAnchorIdx).toEqual([5]);
    expect(t1.emphasisIdx).toEqual([5]);
    expect(t1.onScreenText).toBe("5,500");
    expect(r.texts.map((t) => t.beatId)).toEqual(b.plans.map((p) => p.id));
  });
  it("too few words for the planned beats → SLICE_REPLAN error", async () => {
    const b = base();
    const edited = { ...CH, segments: CH.segments.map((s) => (s.id === "CH2-S01" ? { ...s, displayText: "Gone now." } : s)) };
    const r = await sliceBeats(null, { plans: b.plans, primaryTexts: b.texts, chapter: edited, lang: "en", factSheet: FS, mode: "deterministic" });
    expect(r.issues.map((x) => x.rule)).toContain("SLICE_REPLAN");
  });
  it("copyInvariantFields keeps numbers/ids/enums from the primary and display strings from the secondary", () => {
    const out = copyInvariantFields(
      { figure_id: "N1", value: 5500, label: "one bulb", bars: [{ label: "a", value: 1, figure_id: "N1" }] },
      { figure_id: "N9", value: 1, label: "un bulbe", bars: [{ label: "A", value: 7, figure_id: "N3" }] },
    );
    expect(out).toEqual({ figure_id: "N1", value: 5500, label: "un bulbe", bars: [{ label: "A", value: 1, figure_id: "N1" }] });
  });
});

// ---------------------------------------------------------------- planBeats with a scripted LLM
class ScriptedLlm implements LlmClient {
  readonly kind = "fixture" as const;
  calls: string[] = [];
  constructor(private readonly responses: Record<string, unknown>) {}
  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    const k = `${req.step}.${req.key}`;
    this.calls.push(k);
    if (!(k in this.responses)) throw new DocmakerError("FIXTURE_MISSING", k);
    return req.schema.parse(this.responses[k]);
  }
  async research(): Promise<never> {
    throw new DocmakerError("FIXTURE_MISSING", "research");
  }
}
const wireBeat = (segment_id: string, t: string, o: Partial<ChapterBeatsWire["beats"][number]> = {}): ChapterBeatsWire["beats"][number] => ({
  id: "ignored", segment_id, text: t, est_seconds: 2, purpose: "context", energy: 3.6, visual_kind: "archival_photo", visual_query: "tulip painting",
  person_ids: ["p1", "P99"], youtube_quote_to_find: "", motion_template: "none", motion_data_json: "", on_screen_text: "", emphasis_words: ["price"],
  camera: "ken_burns", transition_in: "cut", sfx: ["whoosh", "whoosh"], music_cue: "none", music_mood: "tense", fact_ids: ["s1", "X"], cue_tags: [], ...o,
});

describe("planBeats", () => {
  const good: ChapterBeatsWire = { chapter_id: "CH2", beats: [
    wireBeat("CH2-S1", SLICES[0]!, { motion_template: "money_counter", visual_kind: "motion_graphic", motion_data_json: JSON.stringify({ figure_id: "N1", value: 5500, currency: "NLG" }),
      cue_tags: [{ type: "NUMBER", word: "5,500", value: "5500" }] }),
    wireBeat("CH2-S01", SLICES[1]!),
    wireBeat("CH2-S01", SLICES[2]!),
    wireBeat("CH2-S03", "What a line."),
  ] };
  it("maps, assigns ids/orders in code and validates (LLM path)", async () => {
    const llm = new ScriptedLlm({ "beats.CH2": good });
    const r = await planBeats(makeCtx(llm), { chapter: CH, factSheet: FS, style: TEST_PLUGIN, isHook: false, lang: "en", startOrder: 40 });
    expect(r.method).toBe("llm");
    expect(r.plans.map((p) => [p.id, p.order, p.segmentId])).toEqual([["CH2-B001", 40, "CH2-S01"], ["CH2-B002", 41, "CH2-S01"], ["CH2-B003", 42, "CH2-S01"], ["CH2-B004", 43, "CH2-S03"]]);
    expect(r.plans[0]).toMatchObject({ energy: 4, personIds: ["P1"], factIds: ["S1"], sfx: ["whoosh"], motionTemplate: "money_counter" });
    expect(r.texts[0]!.cueAnchorIdx).toEqual([3]);
    expect(r.texts[0]!.emphasisIdx).toEqual([1]);
    expect(r.issues.filter((x) => x.level === "error")).toEqual([]);
    expect(llm.calls).toEqual(["beats.CH2"]);
  });
  it("broken slices → one repair round → deterministic fallback with annotations re-attached", async () => {
    const bad: ChapterBeatsWire = { chapter_id: "CH2", beats: [
      wireBeat("CH2-S01", "The price hit 5,500 guilders!", { cue_tags: [{ type: "NUMBER", word: "5,500", value: "5500" }], on_screen_text: "5,500" }),
      wireBeat("CH2-S01", "Nobody asked what a flower was worth. Then the buyers vanished."),
      wireBeat("CH2-S03", "What a line."),
    ] };
    const noRepair = new ScriptedLlm({ "beats.CH2": bad });
    const r = await planBeats(makeCtx(noRepair), { chapter: CH, factSheet: FS, style: TEST_PLUGIN, isHook: false, lang: "en", startOrder: 0 });
    expect(noRepair.calls).toEqual(["beats.CH2", "beats.CH2.repair"]);
    expect(r.method).toBe("fallback");
    expect(r.issues.filter((x) => x.level === "error")).toEqual([]);
    expect(r.issues.map((x) => x.rule)).toContain("V_FALLBACK_SPLIT");
    const s1 = r.texts.filter((t) => r.plans.find((p) => p.id === t.beatId)!.segmentId === "CH2-S01");
    expect(() => beatWordRanges(SEG, s1.map((t) => t.text))).not.toThrow();
    expect(r.plans[0]!.origin).toBe("fallback");
    expect(r.plans[0]!.cueTags).toEqual([{ type: "NUMBER", value: "5500" }]);
    expect(s1[0]!.cueAnchorIdx).toEqual([3]);
    expect(r.plans.map((p) => p.id)).toEqual(r.plans.map((_, k) => `CH2-B00${k + 1}`));
    const repaired = new ScriptedLlm({ "beats.CH2": bad, "beats.CH2.repair": good });
    const r2 = await planBeats(makeCtx(repaired), { chapter: CH, factSheet: FS, style: TEST_PLUGIN, isHook: false, lang: "en", startOrder: 0 });
    expect(r2.method).toBe("llm");
    expect(r2.plans).toHaveLength(4);
  });
});
