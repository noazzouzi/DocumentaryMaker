import { describe, expect, it } from "vitest";
import { FactCheck, FactCheckItem, Timeline, docHash, stableStringify } from "@docmaker/core";
import { makeBeats, makeScript, makeTake } from "@docmaker/core/testing";
import { direct, layoutProgram } from "../src/index";
import { buildInputs, makeOutline } from "./fixtures";
import { errorsOf } from "./helpers";
import { policyScenario } from "./scenario";

describe("robustness", () => {
  it("degrades without music, SFX packs, picks or facts", () => {
    const sc = policyScenario({ seconds: 180, chapters: 3 });
    const out = direct({ ...sc.input, music: [], sfx: [], picks: { ...sc.input.picks, picks: [], portraits: [] } });
    expect(() => Timeline.parse(out.timeline)).not.toThrow();
    expect(out.timeline.audio.music).toEqual([]);
    expect(out.timeline.audio.sfx).toEqual([]);
    expect(out.timeline.video.every((c) => c.source.kind === "generated" || c.beatId?.endsWith("-CLIP"))).toBe(true);
    expect(errorsOf(out)).toEqual([]);
  });

  it("directs a French programme", () => {
    const script = makeScript({ lang: "fr", chapters: 3, segmentsPerChapter: 5, withBreath: true });
    const { plans, slices } = makeBeats(script, { cues: true });
    const b = buildInputs({ script, plans, slices, take: makeTake(script) });
    const out = direct(b.input);
    expect(out.timeline.lang).toBe("fr");
    expect(out.timeline.overlays.find((o) => o.component === "ChapterCard")?.props).toMatchObject({ kicker: expect.stringMatching(/^CHAPITRE /) });
    expect(errorsOf(out)).toEqual([]);
  });

  it("directs a one-chapter, one-segment programme", () => {
    const script = makeScript({ chapters: 1, segmentsPerChapter: 1 });
    const { plans, slices } = makeBeats(script, { cues: false });
    const b = buildInputs({ script, plans, slices, take: makeTake(script) });
    const out = direct(b.input);
    expect(out.timeline.video[0]!.from).toBe(0);
    expect(out.timeline.video.at(-1)!.from + out.timeline.video.at(-1)!.dur).toBe(out.timeline.durationInFrames);
    expect(errorsOf(out)).toEqual([]);
  });

  it("adds the safe-messaging card and honours a style letterbox", () => {
    const sc = policyScenario({ seconds: 120, chapters: 2 });
    const style = { ...sc.input.style, grade: { ...sc.input.style.grade, letterbox: 2.39 } };
    const out = direct({ ...sc.input, style, riskFlags: ["suicide_self_harm"] });
    const card = out.timeline.overlays.find((o) => o.component === "KineticText" && o.from + o.dur === out.timeline.durationInFrames)!;
    expect(card.dur).toBe(5 * out.timeline.fps);
    expect(JSON.stringify(card.props)).toContain("988");
    expect(out.timeline.overlays.some((o) => o.component === "Letterbox")).toBe(true);
  });

  it("never names minors or private victims, nor non-acknowledged private persons", () => {
    const sc0 = policyScenario({ seconds: 300, chapters: 3 });
    // make sure a PERSON_INTRO cue names Carolus Clusius
    const beat = sc0.input.texts.find((t) => /Clusius/.test(t.text) && !t.beatId.endsWith("-CLIP"))!;
    const k = beat.text.split(/\s+/).findIndex((w) => w.startsWith("Carolus"));
    const sc = { ...sc0, input: {
      ...sc0.input,
      plans: sc0.input.plans.map((p) => (p.id === beat.beatId ? { ...p, personIds: ["P1"], cueTags: [{ type: "PERSON_INTRO" as const, value: "Carolus Clusius" }] } : p)),
      texts: sc0.input.texts.map((t) => (t.beatId === beat.beatId ? { ...t, cueAnchorIdx: [Math.max(0, k)], onScreenText: "Carolus Clusius — botanist" } : t)),
    } };
    const pub = direct(sc.input);
    expect(pub.timeline.overlays.some((o) => o.component === "LowerThird" || o.component === "FreezeLabel")).toBe(true);
    const facts = { ...sc.input.facts, people: sc.input.facts.people.map((p) => (p.id === "P1" ? { ...p, publicFigure: false } : p)) };
    const out = direct({ ...sc.input, facts });
    expect(out.timeline.overlays.some((o) => JSON.stringify(o.props).includes("Carolus Clusius"))).toBe(false);
    const acked = direct({ ...sc.input, facts, personAcks: ["P1"] });
    expect(acked.timeline.overlays.some((o) => o.component === "LowerThird" || o.component === "FreezeLabel")).toBe(true);
    const minor = direct({ ...sc.input, facts: { ...facts, people: facts.people.map((p) => (p.id === "P1" ? { ...p, isMinorOrPrivateVictim: true } : p)) }, personAcks: ["P1"] });
    expect(minor.timeline.overlays.some((o) => JSON.stringify(o.props).includes("Carolus Clusius"))).toBe(false);
  });

  it("final takes and recordings change the voice disclosure labels", () => {
    const sc = policyScenario({ seconds: 120, chapters: 2 });
    const fin = direct({ ...sc.input, takeKind: "final", voiceProvider: "elevenlabs" });
    expect(fin.timeline.overlays.some((o) => o.component === "SourceLabel" && (o.props as { kind: string }).kind === "synthetic-voice")).toBe(true);
    const seg = sc.layout.segments.find((s) => s.mode === "vo")!.segmentId;
    const rec = direct({ ...sc.input, takeKind: "final", voiceProvider: "recording", pickupSegments: [seg] });
    const kinds = rec.timeline.overlays.filter((o) => o.component === "SourceLabel").map((o) => (o.props as { kind: string }).kind);
    expect(kinds).toContain("pickup-tts");
    expect(kinds).not.toContain("synthetic-voice");
    expect(rec.timeline.markers.some((m) => m.kind === "pickup")).toBe(true);
  });

  it("puts fact-check markers on unresolved items", () => {
    const sc = policyScenario({ seconds: 120, chapters: 2 });
    const seg = sc.layout.segments[2]!;
    const item = FactCheckItem.parse({ id: "FC-0123abcd", where: seg.segmentId, surface: "narration", sentence: "x", claimKind: "fact", verdict: "unsupported", risk: "high", factIds: [], problem: "no source", suggestedRewrite: "", origin: "llm", rule: null, resolution: "open", note: "" });
    const fc = FactCheck.parse({ schemaVersion: 1, lang: "en", scriptHash: "0".repeat(64), slicesHash: "0".repeat(64), publishHash: "0".repeat(64), items: [item, { ...item, id: "FC-0123abce", resolution: "rewritten" }], needsMoreResearch: [], titleThumbnailIssues: [], createdAt: "2026-10-02T00:00:00.000Z" });
    const out = direct({ ...sc.input, factCheck: fc });
    const mk = out.timeline.markers.filter((m) => m.kind === "factcheck");
    expect(mk.map((m) => m.id)).toEqual(["mk:factcheck:FC-0123abcd"]);
    expect(mk[0]!.frame).toBe(seg.from);
  });

  it("directs a 30-minute programme in reasonable time and size", () => {
    const sc = policyScenario({ seconds: 1800, chapters: 8 });
    const t0 = performance.now();
    const out = direct(sc.input);
    const ms = performance.now() - t0;
    expect(errorsOf(out)).toEqual([]);
    expect(ms).toBeLessThan(60_000);
    expect(stableStringify(out.timeline, 0).length).toBeLessThan(8 * 1024 * 1024);
  }, 120_000);

  it("layout and direct agree with onlyChapters filtering", () => {
    const script = makeScript({ chapters: 4, segmentsPerChapter: 3 });
    const kept = { ...script, chapters: script.chapters.slice(2) };
    const { plans, slices } = makeBeats(kept, { cues: true });
    const b = buildInputs({ script: kept, plans, slices, take: makeTake(kept), outline: makeOutline(script) });
    const L = layoutProgram({ ...b.layoutInput, onlyChapters: ["CH3", "CH4"] });
    expect(L.chapters.map((c) => c.chapterId)).toEqual(["CH3", "CH4"]);
    const layout = { ...L, voProgram: b.layout.voProgram };
    const out = direct({ ...b.input, layout, layoutHash: docHash(layout) });
    expect(out.timeline.onlyChapters).toEqual(["CH3", "CH4"]);
    const card = out.timeline.overlays.find((o) => o.component === "ChapterCard");
    expect(card?.props).toMatchObject({ kicker: "CHAPTER 3" });
    expect(errorsOf(out)).toEqual([]);
  });
});
