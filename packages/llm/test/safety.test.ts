// Defamation / privacy safety nets (P3 review): blocked-person names, attribution lexicon, gating rules c/f/i,
// fact-sheet masking in prompts.
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { type BeatLang, type BeatPlan, type FactSheet, type Script, type ScriptSegment } from "@docmaker/core";
import { TEST_NOW, makeBeats, makeFactSheet, makeScript } from "@docmaker/core/testing";
import { ACCUSATORY, ATTRIBUTION, deterministicFactChecks, extractNumbers, factCheck, factSheetToWire, lintScript, planBeats, recheck, sliceBeats, transcreateSegment, type LlmClient, type ResearchResult, type StructuredRequest } from "../src/index";
import { TEST_PLUGIN, makeCtx } from "./helpers";
import { maskPersons, mentionsPerson } from "../src/text";

function seg(id: string, displayText: string, o: Partial<ScriptSegment> = {}): ScriptSegment {
  return { id, type: "narration", displayText, ttsText: displayText, ttsTextEdited: false, quoteId: null, subtitleTranslation: "", factIds: [], device: "none", breathMs: 0, primaryHash: null, ...o };
}
function scriptOf(segments: ScriptSegment[], lang: "en" | "fr" = "en"): Script {
  return { schemaVersion: 1, lang, outlineHash: "0".repeat(64), title: "t", lint: [], generatedBy: "user", updatedAt: TEST_NOW,
    chapters: [{ chapterId: "CH1", title: "t", segments, loopsOpened: [], loopsClosed: [], summaryForNext: "", userEdited: false, locked: false }] };
}
function facts(): FactSheet {
  const f = makeFactSheet({ people: 3, quotes: 1, figures: 1 });
  f.people[0] = { ...f.people[0]!, name: "John Smith", publicFigure: true };
  f.people[1] = { ...f.people[1]!, name: "Emily Ross", isMinorOrPrivateVictim: true, publicFigure: false, imageQueries: [] };
  f.people[2] = { ...f.people[2]!, name: "Mia Lee", isMinorOrPrivateVictim: true, publicFigure: false, imageQueries: [] };
  f.timeline[0] = { ...f.timeline[0]!, title: "Emily Ross reports abuse", whatHappened: "Emily Ross, 14, told police." };
  f.claims.push(
    { id: "C3", summary: "Smith ran a scam targeting Emily's family", madeBy: "Emily Ross", against: "John Smith", status: "allegation", jurisdiction: "", decisionDate: "", subjectResponse: "", asOf: "2026-10-02", sensitivity: "medium", sourceIds: ["S1"] },
    { id: "C4", summary: "Smith was charged with fraud", madeBy: "prosecutors", against: "John Smith", status: "charged_pending", jurisdiction: "", decisionDate: "", subjectResponse: "", asOf: "2026-10-02", sensitivity: "low", sourceIds: ["S1"] },
  );
  return f;
}
const noBeats = () => {
  const { plans, slices } = makeBeats(makeScript({ chapters: 1, segmentsPerChapter: 1 }), { cues: false });
  return { plans: { ...plans, plans: [] as BeatPlan[] }, slices: { ...slices, texts: [] as BeatLang[] } };
};
const det = (segments: ScriptSegment[], f = facts(), lang: "en" | "fr" = "en") => {
  const b = noBeats();
  return deterministicFactChecks({ script: scriptOf(segments, lang), slices: b.slices, plans: b.plans, factSheet: f, publish: null, riskFlags: ["real_person_allegations"] });
};

describe("blocked persons: first names and short surnames (lint private-person, rule h)", () => {
  const emily = { name: "Emily Ross", aliases: [] };
  it("mentionsPerson strict matches any capitalised name token", () => {
    expect(mentionsPerson("Emily, then 14, told her teacher.", emily)).toBe(false); // default (public-figure) matching
    expect(mentionsPerson("Emily, then 14, told her teacher.", emily, { strict: true })).toBe(true);
    expect(mentionsPerson("Emily's teacher called.", emily, { strict: true })).toBe(true);
    expect(mentionsPerson("Lee was 12.", { name: "Mia Lee", aliases: [] }, { strict: true })).toBe(true);
    expect(mentionsPerson("The lee side of the ship.", { name: "Mia Lee", aliases: [] }, { strict: true })).toBe(false); // lowercase common word
    expect(mentionsPerson("Ross Geller testified.", emily, { strict: true, ignoreTokens: new Set(["ross", "geller"]) })).toBe(false); // shared with a public person
  });
  it("lint and fact-check flag a minor named by first name only", () => {
    const f = facts();
    const segs = [seg("CH1-S01", "Emily, then 14, told her teacher."), seg("CH1-S02", "Lee was 12.")];
    expect(det(segs, f).filter((x) => x.rule === "h").map((x) => [x.where, x.factIds[0], x.risk])).toEqual([["CH1-S01", "P2", "high"], ["CH1-S02", "P3", "high"]]);
  });
  it("factSheetToWire masks blocked names in every free-text field", () => {
    const w = factSheetToWire(facts());
    const all = JSON.stringify(w);
    expect(all).not.toMatch(/Emily|Ross|Mia Lee/);
    expect(w.timeline[0]!.title).toBe("[private person P2] reports abuse");
    expect(w.timeline[0]!.what_happened).toBe("[private person P2], 14, told police.");
    expect(w.claims.find((c) => c.id === "C3")).toMatchObject({ made_by: "[private person P2]", against: "John Smith", summary: "Smith ran a scam targeting [private person P2]'s family" });
    expect(all).toContain("John Smith"); // public people untouched
  });
  it("maskPersons masks URL slugs and leaves shared tokens", () => {
    expect(maskPersons("https://news.example/emily-ross-case", [{ id: "P2", name: "Emily Ross", aliases: [] }])).toBe("https://news.example/private-person-P2-case");
    expect(maskPersons("Ross Geller and Emily Ross", [{ id: "P2", name: "Emily Ross", aliases: [] }], new Set(["ross"]))).toBe("Ross Geller and [private person P2] Ross");
  });
});

describe("attribution lexicon", () => {
  const unattributed = (lang: "en" | "fr", s: string) => ACCUSATORY[lang].test(s) && !ATTRIBUTION[lang].test(s);
  it("incidental said/judge/court/trial/tried do not attribute (EN)", () => {
    for (const s of ["He embezzled two million and lied to the judge.", "He murdered his wife and tried to hide the body.", "He raped her, and nobody said a word.", "He stole from the court."]) {
      expect(unattributed("en", s), s).toBe(true);
    }
    for (const s of ["Prosecutors said he embezzled two million.", "He was convicted of fraud in 2019.", "She said he beat her.", "He is awaiting trial for fraud.", "A jury found him guilty of murder.", "He allegedly stole the funds.", "\"He's a liar,\" she said."]) {
      expect(unattributed("en", s), s).toBe(false);
    }
  });
  it("FR: participles and conjugations are accusatory; cour/juge alone do not attribute", () => {
    for (const s of ["Il a escroqué des milliers d'investisseurs.", "Il a fraudé le fisc pendant dix ans.", "Ils ont volé deux millions.", "Il a menti à tout le monde.", "Il a soudoyé le maire.", "Il a frappé le juge.", "Il a tué sa femme dans la cour."]) {
      expect(unattributed("fr", s), s).toBe(true);
    }
    for (const s of ["Selon le parquet, il aurait escroqué des milliers d'investisseurs.", "Il a été condamné pour fraude en 2019.", "Le tribunal a estimé qu'il avait menti.", "Il sera jugé pour corruption.", "Elle affirme qu'il l'a frappée."]) {
      expect(unattributed("fr", s), s).toBe(false);
    }
  });
});

describe("gating rules for narration accusations (c extended, i)", () => {
  it("(i) unattributed accusatory narration → needs_attribution (high when a person or claim is involved)", () => {
    const xs = det([seg("CH1-S01", "John Smith defrauded his investors."), seg("CH1-S02", "Somebody stole the bulbs.")]);
    expect(xs.filter((x) => x.rule === "i").map((x) => [x.where, x.risk, x.verdict, x.factIds])).toEqual([
      ["CH1-S01", "high", "needs_attribution", ["P1"]],
      ["CH1-S02", "medium", "needs_attribution", []],
    ]);
    expect(det([seg("CH1-S01", "Prosecutors allege that John Smith defrauded his investors.")]).filter((x) => x.rule === "i")).toEqual([]);
  });
  it("(c) any attribution-required status, whatever the sensitivity", () => {
    const xs = det([seg("CH1-S01", "Smith ran the operation.", { factIds: ["C3"] }), seg("CH1-S02", "Smith ran the shop.", { factIds: ["C4"] })]);
    expect(xs.filter((x) => x.rule === "c").map((x) => [x.where, x.risk, x.factIds])).toEqual([["CH1-S01", "high", ["C3"]], ["CH1-S02", "high", ["C4"]]]);
    expect(det([seg("CH1-S01", "Smith was charged with running the operation.", { factIds: ["C4"] })]).filter((x) => x.rule === "c")).toEqual([]);
  });
  it("lint still reports them (feeding the revision rounds)", () => {
    const f = facts();
    const issues = lintScript({
      lang: "en", profile: { charsPerSec: { en: 16.5, fr: 16 }, bannedPhrases: { en: [], fr: [] }, sentenceWords: [0, 100], maxGapNoDeviceSec: 1e9, hookMaxSec: 1e9, maxClipShare: { warn: 1, error: 1 } } as never,
      outline: { chapters: [], loops: [], hookTeasers: [], budget: { runtimeSec: 0 }, budgets: {} } as never,
      chapters: scriptOf([seg("CH1-S01", "Emily, then 14, saw John Smith steal the money.", { factIds: ["S1"] })]).chapters, facts: f,
    });
    expect(issues.filter((x) => x.level === "error").map((x) => x.rule).sort()).toEqual(["accusatory-unattributed", "private-person"]);
  });
});

describe("(f) accusatory on-screen text names a person the model did not tag", () => {
  it("flags it from the on-screen string or the beat text", () => {
    const script = makeScript({ chapters: 1, segmentsPerChapter: 1 });
    const { plans, slices } = makeBeats(script, { cues: false });
    const p0 = plans.plans.find((p) => p.origin !== "clip" && p.origin !== "breath")!;
    const plan: BeatPlan = { ...p0, personIds: [], factIds: [], cueTags: [{ type: "SHOCK", value: "FRAUDSTER" }] };
    const text: BeatLang = { ...slices.texts.find((t) => t.beatId === p0.id)!, onScreenText: "JOHN SMITH: FRAUDSTER", cueAnchorIdx: [-1], motionData: {} };
    const xs = deterministicFactChecks({
      script: { ...script, chapters: [] }, plans: { ...plans, plans: [plan] }, slices: { ...slices, texts: [text] }, factSheet: facts(), publish: null, riskFlags: [],
    });
    expect(xs.filter((x) => x.rule === "f").map((x) => [x.sentence, x.risk, x.factIds])).toEqual([["JOHN SMITH: FRAUDSTER", "high", ["P1"]], ["FRAUDSTER", "high", ["P1"]]]);
  });
});

describe("recheck: a status change needs a supporting source", () => {
  class RecheckLlm implements LlmClient {
    readonly kind = "fixture" as const;
    constructor(private readonly claims: unknown[]) {}
    async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
      return req.schema.parse({ claims: this.claims });
    }
    async research(): Promise<ResearchResult> {
      return { dossierMarkdown: "notes", searchesUsed: 1, fetchesUsed: 0, turns: 1,
        registry: [{ id: "S1", url: "https://court.example/ruling", title: "Ruling", pageAge: null, fetched: false, cited: 1, snippets: [] }] };
    }
  }
  const w = (o: Record<string, unknown>) => ({ id: "C4", status: "criminal_conviction", jurisdiction: "", decision_date: "", subject_response: "", changed: true, note: "", source_urls: [], ...o });
  it("unsourced (or invented-URL) change → old status kept, not checked, listed as unverified", async () => {
    for (const urls of [[], ["https://invented.example/x"]]) {
      const out = await recheck(makeCtx(new RecheckLlm([w({ source_urls: urls })])), { factSheet: facts(), claimIds: ["C4"], asOf: "2026-10-03" });
      expect(out.factSheet.claims.find((c) => c.id === "C4")!.status).toBe("charged_pending");
      expect([out.changed, out.checked]).toEqual([[], []]);
      expect(out.unverified).toEqual([{ id: "C4", from: "charged_pending", to: "criminal_conviction", sourceIds: [] }]);
    }
  });
  it("sourced change applied; an upgrade to an established status is reported", async () => {
    const out = await recheck(makeCtx(new RecheckLlm([w({ source_urls: ["https://court.example/ruling"] })])), { factSheet: facts(), claimIds: ["C4"], asOf: "2026-10-03" });
    const c4 = out.factSheet.claims.find((c) => c.id === "C4")!;
    expect(c4.status).toBe("criminal_conviction");
    expect([out.changed, out.checked]).toEqual([["C4"], ["C4"]]);
    expect(out.upgrades).toEqual([{ id: "C4", from: "charged_pending", to: "criminal_conviction", sourceIds: [c4.sourceIds[c4.sourceIds.length - 1]] }]);
  });
});

describe("spelled-out figures (rule b, lint number-without-fact)", () => {
  it("extracts scaled and multiple figures, not small counts", () => {
    const v = (t: string) => extractNumbers(t).map((n) => [n.raw, n.value]);
    expect(v("he stole two hundred million dollars")).toEqual([["two hundred million", 2e8]]);
    expect(v("deux millions d'euros, quatre-vingt-dix fois")).toEqual([["deux millions", 2e6], ["quatre-vingt-dix", 90]]);
    expect(v("ten times more")).toEqual([["ten", 10]]);
    expect(v("the two brothers met un homme; thousands of people")).toEqual([]);
  });
  it("an unsupported spelled figure is flagged; a ratio claim is checked against the cited figures", () => {
    const f = facts();
    f.figures[0] = { ...f.figures[0]!, id: "N1", value: 20e6, label: "Amount taken" };
    const b = (text: string, factIds: string[]) => det([seg("CH1-S01", text, { factIds })], f).filter((x) => x.rule === "b").map((x) => x.problem);
    expect(b("He took two hundred million dollars.", ["N1"])).toHaveLength(1);
    expect(b("He took twenty million dollars.", ["N1"])).toEqual([]);
    const g = facts();
    g.figures = [{ ...g.figures[0]!, id: "N1", value: 10000 }, { ...g.figures[0]!, id: "N2", value: 300 }];
    const r = (text: string) => det([seg("CH1-S01", text, { factIds: ["N1", "N2"] })], g).filter((x) => x.rule === "b");
    expect(r("A bulb cost more than ten times a yearly wage.")).toEqual([]); // 10000 / 300 ≈ 33 ≥ 10
    expect(r("A bulb cost thirty-three times a yearly wage.")).toEqual([]);
    expect(r("A bulb cost a hundred times a yearly wage.")).toHaveLength(1);
  });
  it("lint: a spelled-out figure without fact ids is an error", () => {
    const issues = lintScript({
      lang: "en", profile: { charsPerSec: { en: 16.5, fr: 16 }, bannedPhrases: { en: [], fr: [] }, sentenceWords: [0, 100], maxGapNoDeviceSec: 1e9, hookMaxSec: 1e9, maxClipShare: { warn: 1, error: 1 } } as never,
      outline: { chapters: [], loops: [], hookTeasers: [], budget: { runtimeSec: 0 }, budgets: {} } as never,
      chapters: scriptOf([seg("CH1-S01", "He walked away with two hundred million."), seg("CH1-S02", "The two brothers left.")]).chapters, facts: facts(),
    });
    expect(issues.filter((x) => x.rule === "number-without-fact").map((x) => x.where)).toEqual(["CH1-S01"]);
  });
});

describe("safe messaging reaches every writing and checking step (suicide_self_harm)", () => {
  class CaptureLlm implements LlmClient {
    readonly kind = "fixture" as const;
    reqs: { step: string; system: string; user: string }[] = [];
    async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
      this.reqs.push({ step: req.step, system: req.system.map((b) => b.text).join("\n"), user: typeof req.user === "string" ? req.user : "" });
      throw new Error("captured");
    }
    async research(): Promise<never> {
      throw new Error("no research");
    }
  }
  const flags = ["suicide_self_harm"] as const;
  it("planBeats, sliceBeats, transcreateSegment and factCheck carry <safe_messaging> (and the fact-check audits it)", async () => {
    const script = makeScript({ chapters: 1, segmentsPerChapter: 2 });
    const ch = script.chapters[0]!;
    const { plans, slices } = makeBeats(script, { cues: false });
    const f = makeFactSheet({ people: 2, quotes: 1, figures: 1 });
    const run = async (fn: (llm: CaptureLlm) => Promise<unknown>) => {
      const llm = new CaptureLlm();
      await fn(llm).catch(() => undefined);
      return llm.reqs[0]!;
    };
    const steps = (rf: readonly ("suicide_self_harm")[]) => [
      (llm: CaptureLlm) => planBeats(makeCtx(llm), { chapter: ch, factSheet: f, style: TEST_PLUGIN, isHook: false, lang: "en", startOrder: 0, riskFlags: [...rf] }),
      (llm: CaptureLlm) => sliceBeats(makeCtx(llm), { plans: plans.plans, primaryTexts: slices.texts, chapter: ch, lang: "fr", factSheet: f, mode: "llm", riskFlags: [...rf] }),
      (llm: CaptureLlm) => transcreateSegment(makeCtx(llm), { primary: ch.segments[0]!, current: ch.segments[0]!, lang: "fr", style: TEST_PLUGIN, factSheet: f, riskFlags: [...rf] }),
      (llm: CaptureLlm) => factCheck(makeCtx(llm), { script, slices, plans, factSheet: f, publish: null, previous: null, riskFlags: [...rf], scriptHash: "0".repeat(64), slicesHash: "0".repeat(64) }),
    ];
    for (const fn of steps(flags)) {
      const r = await run(fn);
      expect(r.system, r.step).toContain("<safe_messaging>");
      if (r.step === "factcheck") expect(r.user).toContain("safe messaging:");
    }
    for (const fn of steps([])) {
      const r = await run(fn);
      expect(r.system, r.step).not.toContain("<safe_messaging>");
      expect(r.user).not.toContain("safe messaging:");
    }
  });
});
