// Deterministic fact-check rules a–h, stable ids and resolution carry-over; the gate-test fixture end to end.
import { beforeAll, describe, expect, it } from "vitest";
import { FixtureManifest, type FactCheck, type FactSheet, type Script, type ScriptSegment } from "@docmaker/core";
import { TEST_NOW, TEST_STYLE, makeBeats, makeFactSheet, makeScript } from "@docmaker/core/testing";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FixtureLlm, carryOverResolutions, deterministicFactChecks, extractNumbers, factCheckId, lintScript, parseNumberToken, recheck,
} from "../src/index";
import { fixtureDir, makeCtx, runFixturePipeline, type PipelineResult } from "./helpers";

describe("numbers (rule b normalisation)", () => {
  it("parses EN/FR separators and multipliers", () => {
    expect(parseNumberToken("5,500")).toEqual({ value: 5500, decimals: 0 });
    expect(parseNumberToken("1,2")).toEqual({ value: 1.2, decimals: 1 });
    expect(parseNumberToken("1.200.000")).toEqual({ value: 1200000, decimals: 0 });
    expect(parseNumberToken("1,234.5")).toEqual({ value: 1234.5, decimals: 1 });
    const vals = (t: string) => extractNumbers(t).map((n) => n.value);
    expect(vals("1.2M dollars, 1,2 million d’euros, « 1 200 000 », 3.5 %, 17th century, 2 bn")).toEqual([1.2e6, 1.2e6, 1200000, 3.5, 2e9]);
    expect(vals("En 1637, 5 500 florins")).toEqual([1637, 5500]);
  });
});

function seg(id: string, displayText: string, o: Partial<ScriptSegment> = {}): ScriptSegment {
  return { id, type: "narration", displayText, ttsText: displayText, ttsTextEdited: false, quoteId: null, subtitleTranslation: "", factIds: ["S1"], device: "none", breathMs: 0, primaryHash: null, ...o };
}
function scriptOf(segments: ScriptSegment[]): Script {
  return { schemaVersion: 1, lang: "en", outlineHash: "0".repeat(64), title: "t", lint: [], generatedBy: "user", updatedAt: TEST_NOW,
    chapters: [{ chapterId: "CH1", title: "t", segments, loopsOpened: [], loopsClosed: [], summaryForNext: "", userEdited: false, locked: false }] };
}
function facts(): FactSheet {
  const f = makeFactSheet({ people: 3, quotes: 2, figures: 2 });
  f.people[1] = { ...f.people[1]!, name: "Pieter Jansz", publicFigure: false };
  f.people[2] = { ...f.people[2]!, name: "Anna Visser", isMinorOrPrivateVictim: true, publicFigure: false };
  f.claims.push(
    { id: "C3", summary: "The trader hid the bulbs", madeBy: "a pamphlet", against: "Pieter Jansz", status: "allegation", jurisdiction: "", decisionDate: "", subjectResponse: "Jansz rejected the accusation as slander", asOf: "2026-10-02", sensitivity: "high", sourceIds: ["S1"] },
  );
  return f;
}
const run = (segments: ScriptSegment[], o?: { f?: FactSheet; publish?: { title: string; thumbnailText: string; description: string } | null; acks?: string[] }) => {
  const script = scriptOf(segments);
  const { plans, slices } = makeBeats(makeScript({ chapters: 1, segmentsPerChapter: 1 }), { cues: false });
  return deterministicFactChecks({ script, slices: { ...slices, texts: [] }, plans: { ...plans, plans: [] }, factSheet: o?.f ?? facts(), publish: o?.publish ?? null, riskFlags: [], personAcks: o?.acks });
};
const byRule = (xs: ReturnType<typeof run>, rule: string) => xs.filter((x) => x.rule === rule);

describe("deterministicFactChecks (narration rules)", () => {
  it("(a) clip text ≠ verbatim → quote_mismatch, high; (g) unchecked quote → medium", () => {
    const f = facts();
    const xs = run([seg("CH1-S01", "Set up."), seg("CH1-S02", "It is all a fever and fevers break.", { type: "clip", quoteId: "Q1", factIds: ["Q1"] }), seg("CH1-S03", "Wow.")], { f });
    expect(byRule(xs, "a").map((x) => [x.verdict, x.risk, x.surface, x.where, x.suggestedRewrite])).toEqual([["quote_mismatch", "high", "clip-quote", "CH1-S02", f.quotes[0]!.verbatim]]);
    expect(byRule(xs, "g").map((x) => [x.risk, x.verdict])).toEqual([["medium", "unverified_quote"]]);
    f.quotes[0] = { ...f.quotes[0]!, verification: "not-found" };
    expect(byRule(run([seg("CH1-S02", f.quotes[0]!.verbatim, { type: "clip", quoteId: "Q1", factIds: ["Q1"] })], { f }), "g")[0]!.risk).toBe("high");
    f.quotes[0] = { ...f.quotes[0]!, verification: "verbatim", verifiedBy: "page" };
    expect(run([seg("CH1-S02", f.quotes[0]!.verbatim, { type: "clip", quoteId: "Q1", factIds: ["Q1"] })], { f })).toEqual([]);
  });
  it("(b) a number not supported by the cited facts → unsupported, medium", () => {
    const xs = run([
      seg("CH1-S01", "A Semper Augustus sold for 5,500 guilders in 1637.", { factIds: ["N1", "E2"] }), // value + event date → ok
      seg("CH1-S02", "It sold for 6,000 guilders.", { factIds: ["N1"] }),
      seg("CH1-S03", "Roughly 5.5 thousand guilders, then 1.2 million.", { factIds: ["N1"] }),
    ]);
    expect(byRule(xs, "b").map((x) => [x.where, x.risk, x.verdict])).toEqual([["CH1-S02", "medium", "unsupported"], ["CH1-S03", "medium", "unsupported"]]);
    expect(byRule(xs, "b")[1]!.problem).toContain("1.2 million");
  });
  it("(c) high-sensitivity claim without attribution → high; (d) response not mentioned → medium", () => {
    const xs = run([seg("CH1-S01", "Pieter Jansz hid the bulbs.", { factIds: ["C3"] }), seg("CH1-S02", "The market moved on.")], { acks: ["P2"] });
    expect(byRule(xs, "c").map((x) => [x.risk, x.verdict, x.where])).toEqual([["high", "needs_attribution", "CH1-S01"]]);
    expect(byRule(xs, "d").map((x) => [x.risk, x.where])).toEqual([["medium", "CH1-S01"]]);
    const ok = run([seg("CH1-S01", "A pamphlet accused Pieter Jansz of hiding the bulbs.", { factIds: ["C3"] }), seg("CH1-S02", "He rejected it as slander.")], { acks: ["P2"] });
    expect([...byRule(ok, "c"), ...byRule(ok, "d")]).toEqual([]);
  });
  it("(e) accusatory publish texts → high", () => {
    const xs = run([seg("CH1-S01", "Fine.")], { publish: { title: "The Tulip Fraud", thumbnailText: "SCAMMER?", description: "A story. Prosecutors alleged fraud. He stole bulbs." } });
    expect(byRule(xs, "e").map((x) => [x.where, x.surface, x.risk])).toEqual([["title", "title", "high"], ["thumbnail", "thumbnail", "high"], ["description", "description", "high"]]);
  });
  it("(h) minors/private victims always; non-public persons until person-ack", () => {
    const xs = run([seg("CH1-S01", "Anna Visser and Pieter Jansz were there."), seg("CH1-S02", "Jansz left.")]);
    expect(byRule(xs, "h").map((x) => [x.where, x.factIds[0]])).toEqual([["CH1-S01", "P2"], ["CH1-S01", "P3"], ["CH1-S02", "P2"]]);
    const acked = run([seg("CH1-S01", "Anna Visser and Pieter Jansz were there.")], { acks: ["P2"] });
    expect(byRule(acked, "h").map((x) => x.factIds[0])).toEqual(["P3"]);
  });
  it("stable ids and carry-over of resolution/note", () => {
    const segs = [seg("CH1-S01", "It sold for 6,000 guilders.", { factIds: ["N1"] })];
    const a = run(segs);
    const b = run(segs);
    expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
    expect(a[0]!.id).toBe(factCheckId("CH1-S01", "It sold for 6,000 guilders. b:6,000", "number", "deterministic"));
    expect(a[0]!.id).toMatch(/^FC-[a-f0-9]{8}$/);
    expect(factCheckId("CH1-S01", "x", "number", "llm")).not.toBe(factCheckId("CH1-S01", "x", "number", "deterministic"));
    const prev = { items: [{ ...a[0]!, resolution: "acknowledged" as const, note: "Figure checked with the archive." }] } as FactCheck;
    expect(carryOverResolutions(b, prev)[0]).toMatchObject({ resolution: "acknowledged", note: "Figure checked with the archive." });
    const edited = run([seg("CH1-S01", "It sold for 7,000 guilders.", { factIds: ["N1"] })]);
    expect(carryOverResolutions(edited, prev)[0]!.resolution).toBe("open"); // edited text → new id → re-armed
  });
});

describe("gate-test fixture (fictional people)", () => {
  let r: PipelineResult;
  beforeAll(async () => {
    r = await runFixturePipeline("gate-test");
  });
  it("manifest: gates are not auto-approved; the pending claim is older than 30 days", () => {
    const m = FixtureManifest.parse(JSON.parse(readFileSync(join(fixtureDir("gate-test"), "fixture.json"), "utf8")));
    expect(m.autoApproveGates).toBe(false);
    const c1 = r.factSheet.claims.find((c) => c.id === "C1")!;
    expect(c1.status).toBe("charged_pending");
    expect((Date.parse("2026-10-02") - Date.parse(c1.asOf)) / 86_400_000).toBeGreaterThan(30);
    expect(r.factSheet.people.find((p) => p.name === "Dara Quill")!.publicFigure).toBe(false);
    expect(r.style.riskFlags).toEqual(["real_person_allegations", "ongoing_trial"]);
  });
  it("lint: only the clip mismatch is an error", () => {
    const xs = lintScript({ lang: "en", profile: TEST_STYLE.scriptProfile, outline: r.outline, chapters: r.scripts.en.chapters, facts: r.factSheet });
    expect(xs.filter((x) => x.level === "error").map((x) => [x.rule, x.where])).toEqual([["clip-quote", "CH2-S02"]]);
  });
  it("fact-check: 2 high LLM items + quote_mismatch, plus deterministic a, f, h (high) and g (medium)", () => {
    const fc = r.factChecks.en;
    const llm = fc.items.filter((x) => x.origin === "llm");
    expect(llm.filter((x) => x.risk === "high" && x.verdict !== "quote_mismatch")).toHaveLength(2);
    expect(llm.filter((x) => x.verdict === "quote_mismatch")).toHaveLength(1);
    const det = fc.items.filter((x) => x.origin === "deterministic");
    expect(det.filter((x) => x.risk === "high").map((x) => [x.rule, x.where]).sort()).toEqual([["a", "CH2-S02"], ["f", "CH2-B002"], ["h", "CH2-S03"]]);
    expect(det.filter((x) => x.rule === "g").every((x) => x.risk === "medium")).toBe(true);
    expect(det.some((x) => x.rule === "b" || x.rule === "c" || x.rule === "d")).toBe(false);
    expect(fc.needsMoreResearch).toEqual(["Marlo Vance charges status"]);
    // a person-ack for the non-public bookkeeper clears rule h
    const acked = deterministicFactChecks({ script: r.scripts.en, slices: r.slices.en, plans: r.plans, factSheet: r.factSheet, publish: null, riskFlags: [], personAcks: ["P2"] });
    expect(acked.filter((x) => x.rule === "h")).toEqual([]);
  });
  it("re-running carries resolutions over by id", async () => {
    const prev = { ...r.factChecks.en, items: r.factChecks.en.items.map((x) => (x.rule === "f" ? { ...x, resolution: "rewritten" as const, note: "Card text replaced." } : x)) };
    const items = carryOverResolutions(r.factChecks.en.items, prev);
    expect(items.find((x) => x.rule === "f")).toMatchObject({ resolution: "rewritten", note: "Card text replaced." });
  });
  it("recheck (fixture): no change, asOf refreshed, sources only from returned URLs", async () => {
    const ctx = makeCtx(new FixtureLlm(fixtureDir("gate-test")));
    const out = await recheck(ctx, { factSheet: r.factSheet, claimIds: ["C1"], asOf: "2026-10-02" });
    expect(out.changed).toEqual([]);
    expect(out.checked).toEqual(["C1"]); // covered by the output
    expect(out.factSheet.claims.find((c) => c.id === "C1")!.asOf).toBe("2026-10-02");
    expect(out.factSheet.claims.find((c) => c.id === "C2")!.asOf).toBe(r.factSheet.claims.find((c) => c.id === "C2")!.asOf);
    expect(out.factSheet.sources).toHaveLength(r.factSheet.sources.length);
    const none = await recheck(ctx, { factSheet: r.factSheet, claimIds: [], asOf: "2026-10-02" });
    expect(none.factSheet).toBe(r.factSheet);
  });
});
