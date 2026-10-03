// Wire → core mappers: the §6.4 coercion table, id normalisation, scandal_expose, FR typography.
import { describe, expect, it } from "vitest";
import { TopicType, type LintIssue } from "@docmaker/core";
import { TEST_STYLE } from "@docmaker/core/testing";
import {
  StyleSuggestionWire, applyFrTypography, chapterFromWire, factSheetFromWire, normBeatId, normChapterId, normRef, normSegmentId, outlineFromWire,
  passageFromWire, planBudget, rerankFromWire, resolveAnchors, resolveEmphasis, styleSuggestionFromWire, UNKNOWN_CHAPTER, validateOutline,
  type ChapterScriptWire, type FactSheetWire, type OutlineWire,
} from "../src/index";

const registry = [
  { id: "S1", url: "https://example.org/a", title: "A page", pageAge: null, fetched: true, cited: 2, snippets: ["x"] },
  { id: "S2", url: "https://www.example.com/b", title: "", pageAge: "1 day", fetched: false, cited: 1, snippets: [] },
];
const fsWire = (): FactSheetWire => ({
  topic: "T", as_of: "whenever", one_line_premise: "p", central_question: "q",
  sources: [
    { id: "s1", url: "https://hallucinated.example/x", title: "LLM title", publisher: "Outlet", published_at: "2020", source_type: "major_news", reliability: "high", language: "en" },
    { id: "S9", url: "https://invented.example", title: "nope", publisher: "nope", published_at: "", source_type: "blog_or_forum", reliability: "low", language: "en" },
  ],
  people: [{ id: "p 01", name: "Ada", role_in_story: "founder", public_figure: true, is_minor_or_private_victim: false, image_queries: ["Ada portrait", " "] },
    { id: "P2", name: "Kid", role_in_story: "child", public_figure: false, is_minor_or_private_victim: true, image_queries: ["Kid"] }],
  timeline: [
    { id: "E1", date: "2020", title: "t", what_happened: "w", person_ids: ["P1", "P7"], status: "established_fact", source_ids: ["S1"], drama_value: 14 },
    { id: "E2", date: "2021", title: "orphan", what_happened: "cites an invented source", person_ids: [], status: "allegation", source_ids: ["S9"], drama_value: -3 },
  ],
  quotes: [
    { id: "q1", speaker_id: "P1", verbatim: " Exact words. ", language: "en", date: "2020", context: "c", medium: "print", source_id: "s2", youtube_search_query: "" },
    { id: "Q2", speaker_id: "P1", verbatim: "Unsourced", language: "en", date: "", context: "", medium: "print", source_id: "S9", youtube_search_query: "" },
  ],
  figures: [{ id: "N1", label: "money", value: 5, unit: "M", as_of: "2020", source_ids: [], chartable: true }],
  claims: [{ id: "C1", summary: "s", made_by: "m", against: "a", status: "allegation", jurisdiction: "", decision_date: "", subject_response: "denies", sensitivity: "high", source_ids: ["S1", "S2"] }],
  angles: ["a", ""], gaps: ["g"],
});

describe("ids", () => {
  it("normalises refs, chapters, segments and beats", () => {
    expect(normRef(" s 01 ", "x")).toBe("S1");
    expect(normRef("q-3", "x", "Q")).toBe("Q3");
    expect(normRef("", "x")).toBeNull();
    expect(() => normRef("X12", "path.to.id")).toThrow(/path\.to\.id/);
    expect(() => normRef("S1", "x", "Q")).toThrow();
    expect(normChapterId("chapter 03")).toBe("CH3");
    expect(normChapterId("CH0")).toBeNull();
    expect(normSegmentId("CH3-S7")).toBe("CH3-S07");
    expect(normSegmentId("ch12 s 105")).toBe("CH12-S105");
    expect(normSegmentId("S7")).toBeNull();
    expect(normBeatId("CH3-B14")).toBe("CH3-B014");
    expect(normBeatId("ch1-s2-clip")).toBe("CH1-S02-CLIP");
  });
});

describe("factSheetFromWire", () => {
  it("takes sources from the registry, moves unsourced items to gaps, applies coercions", () => {
    const { factSheet: f, invalidRefs } = factSheetFromWire(fsWire(), { registry, asOf: "2026-10-02", topic: "T" });
    expect(f.sources.map((s) => [s.id, s.url, s.title, s.publisher])).toEqual([
      ["S1", "https://example.org/a", "A page", "Outlet"], // url/title from the registry, publisher from the model
      ["S2", "https://www.example.com/b", "https://www.example.com/b", "example.com"], // undescribed → defaults
    ]);
    expect(f.sources[1]!.sourceType).toBe("other");
    expect(f.people.map((p) => p.id)).toEqual(["P1", "P2"]);
    expect(f.people[0]!.imageQueries).toEqual(["Ada portrait"]);
    expect(f.people[1]!.imageQueries).toEqual([]); // minors / private victims are never searched
    expect(f.people.every((p) => p.wikidataQid === null && p.aliases.length === 0)).toBe(true);
    expect(f.timeline.map((e) => [e.id, e.dramaValue, e.personIds])).toEqual([["E1", 10, ["P1"]]]);
    expect(f.quotes.map((q) => [q.id, q.verbatim, q.verification, q.verifiedBy])).toEqual([["Q1", "Exact words.", "unchecked", "none"]]);
    expect(f.figures).toEqual([]);
    expect(f.claims[0]!.asOf).toBe("2026-10-02");
    expect(f.asOf).toBe("2026-10-02");
    expect(invalidRefs.sort()).toEqual(["E2", "N1", "Q2", "S9"]);
    expect(f.gaps).toContain('Unverified quote: "Unsourced"');
    expect(f.gaps.some((g) => g.includes("orphan"))).toBe(true);
    expect(f.angles).toEqual(["a"]);
  });
  it("garbage ids raise LLM_SCHEMA with the path", () => {
    const w = fsWire();
    w.people[0]!.id = "Ada";
    expect(() => factSheetFromWire(w, { registry, asOf: "2026-10-02", topic: "T" })).toThrow(/people\[0\]\.id/);
  });
});

describe("styleSuggestionFromWire", () => {
  const w = (): StyleSuggestionWire => ({
    topic_type: "scandal_expose",
    ranked: [{ style_id: "drama-commentary", score: 8, why: "x" }, { style_id: "unknown-style", score: 0.9, why: "y" }, { style_id: "cinematic-essay", score: 0.4, why: "z" }],
    recommended_style_id: "unknown-style", recommended_minutes: 75, title_options: ["A", " "], thumbnail_text_options: ["B"],
    risk_flags: ["none", "minors", "minors"], theme_override: { accent: "#FFAA00", backdrop_recipe: "", texture: "film" },
  });
  it("ASCII scandal_expose is a valid wire and core topic type", () => {
    expect(StyleSuggestionWire.shape.topic_type.options).toContain("scandal_expose");
    expect(TopicType.options).toContain("scandal_expose");
    expect(() => StyleSuggestionWire.parse({ ...w(), topic_type: "scandal_exposé" })).toThrow();
  });
  it("score > 1 → /10, unknown styles dropped, recommendation repaired, flags cleaned, theme coerced", () => {
    const s = styleSuggestionFromWire(StyleSuggestionWire.parse(w()), { styleIds: ["drama-commentary", "cinematic-essay"], stage: "research", source: "llm" });
    expect(s.ranked).toEqual([{ styleId: "drama-commentary", score: 0.8, why: "x" }, { styleId: "cinematic-essay", score: 0.4, why: "z" }]);
    expect(s.recommendedStyleId).toBe("drama-commentary");
    expect(s.recommendedMinutes).toBe(60);
    expect(s.riskFlags).toEqual(["minors"]);
    expect(s.themeOverride).toEqual({ accent: "#FFAA00", backdropRecipe: null, texture: "film", fontHeadline: null });
    expect(s.titleOptions).toEqual(["A"]);
    const none = styleSuggestionFromWire(StyleSuggestionWire.parse({ ...w(), theme_override: { accent: "red", backdrop_recipe: "", texture: "" } }), { styleIds: [], stage: "idea", source: "fixture" });
    expect(none.themeOverride).toBeNull();
  });
});

describe("outlineFromWire", () => {
  const budget = planBudget(1.5, "en", TEST_STYLE.scriptProfile, "rise-fall");
  const w = (): OutlineWire => ({
    language: "en", story_shape: "rise-fall", title: "T", thesis: "th",
    hook_teasers: [{ id: "", teaser: "x", paid_off_in: "chapter 2" }],
    loops: [{ id: "l1", question: "q", opened_in: "Ch1", closed_in: "ch 02" }],
    chapters: [
      { id: "CH1", act: "cold_open", title: "a", target_words: 49.6, purpose: "", event_ids: ["e1"], claim_ids: [], quote_ids: [], opens_loops: ["L1"], closes_loops: [], exit_hook: "", ad_break_after: false },
      { id: "CH02", act: "act1_rise", title: "b", target_words: 168, purpose: "", event_ids: [], claim_ids: ["c 2"], quote_ids: [], opens_loops: [], closes_loops: ["loop 1"], exit_hook: "", ad_break_after: false },
    ],
    callback_plan: [], next_video_bridge: "",
  });
  it("assigns positional chapter ids, remaps references, derives targetSec", () => {
    const o = outlineFromWire(w(), { lang: "en", budget, budgets: { en: budget }, shapeId: "rise-fall", avgCharsPerWord: 5.6, generatedBy: "llm", now: "2026-10-02T00:00:00.000Z" });
    expect(o.chapters.map((c) => [c.id, c.targetWords, c.targetSec])).toEqual([["CH1", 50, 17], ["CH2", 168, 57]]);
    expect(o.hookTeasers[0]).toEqual({ id: "T1", teaser: "x", paidOffIn: "CH2" });
    expect(o.loops[0]).toMatchObject({ id: "L1", openedIn: "CH1", closedIn: "CH2" });
    expect(o.chapters[1]!.claimIds).toEqual(["C2"]);
    expect(o.chapters[1]!.closesLoops).toEqual(["L1"]);
    expect(o.thesisConfirmed).toBe(false);
  });
  it("bad references never throw after a paid call: unknown chapters → validateOutline errors (repair round), bad ids dropped", () => {
    const bad = w();
    bad.hook_teasers[0]!.paid_off_in = "the end";
    bad.loops[0]!.closed_in = "Act 3";
    bad.chapters[0]!.event_ids = ["E4", "S1", "N/A"];
    bad.chapters[1]!.closes_loops = ["loop 1", "???"];
    const issues: LintIssue[] = [];
    const o = outlineFromWire(bad, { lang: "en", budget, budgets: {}, shapeId: "rise-fall", avgCharsPerWord: 5.6, generatedBy: "llm", now: "2026-10-02T00:00:00.000Z", issues });
    expect(o.hookTeasers[0]!.paidOffIn).toBe(UNKNOWN_CHAPTER);
    expect(o.chapters[0]!.eventIds).toEqual(["E4"]);
    expect(o.chapters[1]!.closesLoops).toEqual(["L1"]);
    expect(issues.map((x) => [x.rule, x.where])).toEqual([
      ["OUTLINE_BAD_REF", "chapters[0].event_ids"], ["OUTLINE_BAD_REF", "chapters[1].closes_loops"],
      ["OUTLINE_UNKNOWN_CHAPTER", "loops[0].closed_in"], ["OUTLINE_UNKNOWN_CHAPTER", "hook_teasers[0].paid_off_in"],
    ]);
    const errs = validateOutline(o, TEST_STYLE).filter((x) => x.level === "error").map((x) => x.rule);
    expect(errs).toEqual(expect.arrayContaining(["teaser-unpaid", "loop-unpaid"]));
  });
});

describe("chapterFromWire", () => {
  const w = (): ChapterScriptWire => ({
    chapter_id: "CH3", title: "Le krach", video_title: "", loops_opened: ["l2"], loops_closed: [], summary_for_next: "s",
    segments: [
      { id: "CH3-S7", type: "narration", text: "Il l'a dit : « ça  suffit » !", quote_id: "", fact_ids: ["s1", "N99"], device: "none", subtitle_translation: "" },
      { id: "ch3-s8", type: "clip", text: "We never did it.", quote_id: "q1", fact_ids: [], device: "none", subtitle_translation: "Nous ne l'avons jamais fait." },
      { id: "", type: "music_breath", text: "ignored", quote_id: "", fact_ids: [], device: "none", subtitle_translation: "x" },
    ],
  });
  it("normalises/assigns segment ids, applies FR typography, filters unknown facts, sets breath and quote ids", () => {
    const r = chapterFromWire(w(), { chapterId: "CH3", lang: "fr", primaryLang: "en", knownFacts: new Set(["S1", "Q1"]), skeleton: null, fallbackTitle: "x" });
    const [a, b, c] = r.chapter.segments;
    expect([a!.id, b!.id, c!.id]).toEqual(["CH3-S01", "CH3-S02", "CH3-S03"]); // one id missing → all assigned in order
    expect(a!.displayText).toBe("Il l’a dit : « ça suffit » !");
    expect(a!.factIds).toEqual(["S1"]);
    expect(a!.quoteId).toBeNull();
    expect(b!.quoteId).toBe("Q1");
    expect(b!.factIds).toEqual(["Q1"]);
    expect(b!.displayText).toBe("We never did it."); // clip verbatim untouched
    expect(b!.subtitleTranslation).toBe("Nous ne l'avons jamais fait.");
    expect(c!).toMatchObject({ displayText: "", breathMs: 2000, subtitleTranslation: "" });
    expect(r.chapter.loopsOpened).toEqual(["L2"]);
    expect(r.issues.map((x) => x.rule)).toContain("UNKNOWN_FACT_REF");
  });
  it("garbage fact/quote ids are dropped with a warning instead of throwing", () => {
    const bad = w();
    bad.segments[0]!.fact_ids = ["N/A", "S1", "Act 3"];
    bad.segments[1]!.quote_id = "the quote";
    const r = chapterFromWire(bad, { chapterId: "CH3", lang: "fr", primaryLang: "en", knownFacts: new Set(["S1", "Q1"]), skeleton: null, fallbackTitle: "x" });
    expect(r.chapter.segments[0]!.factIds).toEqual(["S1"]);
    expect(r.chapter.segments[1]!.quoteId).toBeNull();
    expect(r.issues.filter((x) => x.rule === "UNKNOWN_FACT_REF").map((x) => x.where)).toEqual(["CH3-S01", "CH3-S02"]);
  });
  it("secondary languages take the skeleton's ids and primaryHash", () => {
    const skeleton = [{ id: "CH3-S01", primaryHash: "a".repeat(64) }, { id: "CH3-S02", primaryHash: "b".repeat(64) }, { id: "CH3-S04", primaryHash: "c".repeat(64) }];
    const r = chapterFromWire(w(), { chapterId: "CH3", lang: "fr", primaryLang: "en", knownFacts: null, skeleton, fallbackTitle: "x" });
    expect(r.chapter.segments.map((s) => [s.id, s.primaryHash])).toEqual(skeleton.map((s) => [s.id, s.primaryHash]));
  });
});

describe("FR typography", () => {
  it("is idempotent and leaves times and URLs alone", () => {
    const once = applyFrTypography(`Il a dit "stop" ; puis : « non »? À 12:30, voir https://example.org !`);
    expect(once).toBe("Il a dit « stop » ; puis : « non » ? À 12:30, voir https://example.org !");
    expect(applyFrTypography(once)).toBe(once);
    expect(applyFrTypography("aujourd'hui l'acteur")).toBe("aujourd’hui l’acteur");
    // URLs and e-mail addresses keep their punctuation; the sentence around them is still fixed
    const url = applyFrTypography("Voir https://x.fr/a?b=1;c!d:e et contact@x.fr ; fin !");
    expect(url).toBe("Voir https://x.fr/a?b=1;c!d:e et contact@x.fr\u202F; fin\u202F!");
    expect(applyFrTypography(url)).toBe(url);
  });
});

describe("anchors and small coercions", () => {
  it("cue words resolve to the first occurrence at or after the previous anchor; missing → -1 + warning", () => {
    const r = resolveAnchors("The price, the price, and then the crash.", ["price", "price", "", "crash", "missing"], "CH1-B001"); // "at or after": two cues may share a word
    expect(r.idx).toEqual([1, 1, -1, 7, -1]);
    expect(resolveAnchors("a b a", ["b", "a"], "x").idx).toEqual([1, 2]);
    expect(r.issues).toHaveLength(1);
    expect(resolveEmphasis("One two three four", ["four", "one", "two", "three"])).toEqual([3, 0, 1]);
  });
  it("rerank: clamp 0..10 → /10, crop ≥ 0.05 and inside the frame, 1-based indexes", () => {
    const s = rerankFromWire({ images: [
      { index: 2, relevance: 14, technical_quality: -1, has_watermark_or_burned_text: true, nsfw: false, focal_x: 1.4, focal_y: -0.2, crop_x: 0.99, crop_y: 0, crop_w: 0.01, crop_h: 2, notes: " n " },
    ] }, 3);
    expect(s[0]).toBeNull();
    expect(s[1]).toEqual({ vision: 1, technical: 0, watermark: true, nsfw: false, focal: { x: 1, y: 0 }, safeCrop: { x: 0.95, y: 0, w: 0.05, h: 1 }, notes: "n" });
  });
  it("passage: unknown index → first window with confidence 0", () => {
    expect(passageFromWire({ best_index: 7, confidence: 0.9, reason: "" }, [3, 4])).toEqual({ bestIndex: 3, confidence: 0 });
    expect(passageFromWire({ best_index: 4, confidence: 9, reason: "" }, [3, 4])).toEqual({ bestIndex: 4, confidence: 0.9 });
  });
});
