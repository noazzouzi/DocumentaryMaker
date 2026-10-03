import { describe, expect, it } from "vitest";
import { docHash, hashJson, type FactCheck, type FactCheckItem, type JobEvent, type JobRecord, type Script } from "@docmaker/core";
import { makeScript } from "@docmaker/core/testing";
import { en } from "../src/i18n/en";
import { fr } from "../src/i18n/fr";
import { fromAcceptLanguage, translator } from "../src/i18n";
import { createFrameStore, lastWordStartedAt, throttle, wordIndexAt } from "../src/lib/frames";
import { applyRewrite, duplicateNotes, factcheckStale, fixOnly, gatingItems, itemSatisfied } from "../src/lib/factcheck";
import { jobWrites, stagesOf } from "../src/lib/jobs";
import { checkMotionData } from "../src/lib/motion";
import { accusatoryTerms } from "../src/lib/accusatory";
import { initialJobState, jobReducer } from "../src/components/useJobStream";

describe("i18n", () => {
  it("EN and FR define exactly the same keys and placeholders", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const k of Object.keys(en) as (keyof typeof en)[]) expect(ph(fr[k]), k).toEqual(ph(en[k]));
  });
  it("interpolates and picks the Accept-Language", () => {
    expect(translator("fr")("overview.queued", { n: 3 })).toBe("3 en attente");
    expect(translator("en")("overview.cost", { spent: "$1", max: "$40" })).toBe("Spent $1 of $40");
    expect(fromAcceptLanguage("de-DE,fr-CA;q=0.8,en;q=0.5")).toBe("fr");
    expect(fromAcceptLanguage("en-GB;q=0.2, fr;q=0.9")).toBe("fr");
    expect(fromAcceptLanguage("de,es")).toBeNull();
    expect(fromAcceptLanguage(null)).toBeNull();
  });
});

describe("frames", () => {
  const words = [{ from: 0, dur: 10 }, { from: 10, dur: 5 }, { from: 30, dur: 10 }];
  it("binary-searches the active word, gaps included", () => {
    expect(wordIndexAt(words, 0)).toBe(0);
    expect(wordIndexAt(words, 9)).toBe(0);
    expect(wordIndexAt(words, 10)).toBe(1);
    expect(wordIndexAt(words, 20)).toBe(-1); // pause between words
    expect(lastWordStartedAt(words, 20)).toBe(1);
    expect(wordIndexAt(words, 39)).toBe(2);
    expect(wordIndexAt(words, 40)).toBe(-1);
    expect(wordIndexAt([], 5)).toBe(-1);
    const many = Array.from({ length: 10_000 }, (_, i) => ({ from: i * 3, dur: 2 }));
    expect(wordIndexAt(many, 3 * 7777 + 1)).toBe(7777);
    expect(wordIndexAt(many, 3 * 7777 + 2)).toBe(-1);
  });
  it("frame store notifies only on change", () => {
    const s = createFrameStore();
    let n = 0;
    const off = s.subscribe(() => n++);
    s.set(5);
    s.set(5);
    s.set(6);
    off();
    s.set(7);
    expect(n).toBe(2);
    expect(s.get()).toBe(7);
  });
  it("throttle keeps the trailing call", async () => {
    const seen: number[] = [];
    const f = throttle((x: number) => seen.push(x), 30);
    f(1);
    f(2);
    f(3);
    await new Promise((r) => setTimeout(r, 60));
    expect(seen).toEqual([1, 3]);
  });
});

const item = (o: Partial<FactCheckItem>): FactCheckItem => ({
  id: "FC-00000001", where: "CH1-S01", surface: "narration", sentence: "He stole the money.", claimKind: "allegation", verdict: "unsupported",
  risk: "high", factIds: [], problem: "", suggestedRewrite: "He was accused of taking the money.", origin: "llm", rule: null, resolution: "open", note: "", ...o,
});

describe("fact-check helpers", () => {
  it("mirror the engine's gate rules", () => {
    expect(fixOnly(item({ verdict: "quote_mismatch", risk: "low" }))).toBe(true);
    expect(fixOnly(item({ verdict: "unverified_quote", risk: "high" }))).toBe(true);
    expect(fixOnly(item({ verdict: "unverified_quote", risk: "medium" }))).toBe(false);
    const fc = { items: [item({ id: "FC-0000000a" }), item({ id: "FC-0000000b", risk: "medium" }), item({ id: "FC-0000000c", risk: "low" })] } as FactCheck;
    expect(gatingItems(fc, []).map((i) => i.id)).toEqual(["FC-0000000a"]);
    expect(gatingItems(fc, ["ongoing_trial"]).map((i) => i.id)).toEqual(["FC-0000000a", "FC-0000000b"]);
    expect(itemSatisfied(item({ resolution: "acknowledged", note: "short" }))).toBe(false);
    expect(itemSatisfied(item({ resolution: "acknowledged", note: "court record attributes it" }))).toBe(true);
    expect(itemSatisfied(item({ verdict: "quote_mismatch", resolution: "acknowledged", note: "court record attributes it" }))).toBe(false);
    expect(itemSatisfied(item({ verdict: "quote_mismatch", resolution: "rewritten" }))).toBe(true);
  });
  it("detects stale checks and duplicate notes", () => {
    const script = makeScript({ lang: "en" }) as Script;
    const fc = { scriptHash: docHash(script), slicesHash: "a".repeat(64), publishHash: hashJson(null), items: [] } as unknown as FactCheck;
    expect(factcheckStale(fc, script, "a".repeat(64), null)).toEqual([]);
    expect(factcheckStale(fc, { ...script, title: "changed" }, "b".repeat(64), { title: "x" })).toEqual(["script", "on-screen text", "publish"]);
    expect(duplicateNotes({ a: "Same note here", b: "same note HERE ", c: "different note" })).toEqual([["a", "b"]]);
  });
  it("applies rewrites whitespace-tolerantly", () => {
    expect(applyRewrite("Intro. He stole the money. End.", "He stole the money.", "He was accused.")).toBe("Intro. He was accused. End.");
    expect(applyRewrite("Intro. He  stole\nthe money. End.", "He stole the money.", "X.")).toBe("Intro. X. End.");
    expect(applyRewrite("Nothing here", "He stole", "X")).toBeNull();
    expect(applyRewrite("abc", "", "X")).toBeNull();
  });
});

describe("jobs helpers", () => {
  const rec = (request: Partial<JobRecord["request"]>, status: JobRecord["status"] = "running") =>
    ({ status, request: { slug: "x", kind: "pipeline", stage: null, from: null, to: null, langs: [], force: false, options: {}, preset: null, ...request } }) as JobRecord;
  it("expands pipeline ranges", () => {
    expect(stagesOf(rec({ from: "layout", to: "mix" }).request)).toEqual(["layout", "direct", "mix"]);
    expect(stagesOf(rec({ kind: "stage", stage: "voice" }).request)).toEqual(["voice"]);
    expect(stagesOf(rec({ kind: "demo", from: "research", to: "qa" }).request)).toHaveLength(15);
  });
  it("makes documents read-only only while a writing job is active", () => {
    expect(jobWrites(rec({ from: "research", to: "outline" }), ["outline"])).toBe(true);
    expect(jobWrites(rec({ from: "layout", to: "mix" }), ["outline"])).toBe(false);
    expect(jobWrites(rec({ from: "research", to: "outline" }, "waiting-approval"), ["outline"])).toBe(false);
    expect(jobWrites(null, ["outline"])).toBe(false);
  });
});

describe("motion data editor", () => {
  const facts = { figures: [{ id: "N1" }], quotes: [{ id: "Q1" }], sources: [{ id: "S1" }], timeline: [], people: [] } as never;
  it("validates against MotionData[template] and fact references", () => {
    expect(checkMotionData("counter", '{"figure_id":"N1","value":3000}', facts).ok).toBe(true);
    const bad = checkMotionData("counter", '{"figure_id":"N9","value":"x"}', facts);
    expect(bad.ok).toBe(false);
    expect(bad.errors.join(" ")).toMatch(/value/);
    expect(bad.errors.join(" ")).toMatch(/unknown fact N9/);
    expect(checkMotionData("kinetic_text", "{not json", null).ok).toBe(false);
    expect(checkMotionData("kinetic_text", "[]", null).ok).toBe(false);
    expect(checkMotionData("headline_stack", '{"items":[{"source_id":"S2","outlet":"X","headline":"Y"}]}', facts).errors).toEqual(["items[0].source_id: unknown fact S2"]);
  });
});

describe("accusatory hint", () => {
  it("flags unattributed accusations in EN/FR, not attributed ones", () => {
    expect(accusatoryTerms("The FRAUD that fooled Holland")).toEqual(["fraud"]);
    expect(accusatoryTerms("L'escroc de Haarlem")).toEqual(["escroc"]);
    expect(accusatoryTerms("The alleged fraud of 1637")).toEqual([]);
    expect(accusatoryTerms("Tulip mania explained")).toEqual([]);
    expect(accusatoryTerms("Fraudulently priced")).toEqual([]); // whole words only
  });
});

describe("job stream reducer", () => {
  const at = "2026-10-03T10:00:00.000Z";
  const ev = (e: Record<string, unknown>) => ({ jobId: "j", at, ...e }) as JobEvent;
  it("tracks stages, gates and the end status; ignores replayed seqs", () => {
    let s = initialJobState("j");
    s = jobReducer(s, { type: "event", ev: ev({ seq: 0, type: "stage-start", stage: "render", lang: "en" }) });
    s = jobReducer(s, { type: "event", ev: ev({ seq: 1, type: "progress", stage: "render", lang: "en", pct: 0, message: "", detail: { waiting: "render-slot" } }) });
    expect(s.stages[0]).toMatchObject({ key: "render.en", waitingRenderSlot: true, state: "running" });
    s = jobReducer(s, { type: "event", ev: ev({ seq: 2, type: "progress", stage: "render", lang: "en", pct: 0.5, message: "chunk 2/4", detail: {} }) });
    s = jobReducer(s, { type: "event", ev: ev({ seq: 1, type: "progress", stage: "render", lang: "en", pct: 0.1, message: "old", detail: {} }) });
    expect(s.stages[0]).toMatchObject({ pct: 0.5, message: "chunk 2/4", waitingRenderSlot: false });
    s = jobReducer(s, { type: "event", ev: ev({ seq: 3, type: "needs-approval", gate: "cost", stage: "voice", lang: "en", planHash: "c".repeat(64), reason: "unmet", summary: "$2" }) });
    s = jobReducer(s, { type: "event", ev: ev({ seq: 4, type: "needs-approval", gate: "cost", stage: "voice", lang: "en", planHash: "d".repeat(64), reason: "unmet", summary: "$3" }) });
    expect(s.gates).toHaveLength(1);
    expect(s.gates[0]!.planHash).toBe("d".repeat(64));
    s = jobReducer(s, { type: "event", ev: ev({ seq: 5, type: "job-end", status: "waiting-approval" }) });
    expect(s.ended).toBe("waiting-approval");
    expect(s.lastSeq).toBe(5);
    expect(s.log.at(-1)!.text).toContain("waiting-approval");
  });
});
