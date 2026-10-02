import { describe, expect, it } from "vitest";
import { type DocSet, checkRefs, collectAssetIds, timelineItemIds, validateLangParity } from "../src/index";
import { makeBeats, makeFactSheet, makeFrozen, makePicks, makeProject, makeScript, makeTimeline } from "../src/testing/index";

const rules = (d: DocSet) => checkRefs(d).filter((i) => i.level === "error").map((i) => i.rule);
const clone = <T>(x: T): T => structuredClone(x);

const project = makeProject({ languages: ["en", "fr"] });
const en = makeScript({ withClip: true, withBreath: true });
const fr = makeScript({ lang: "fr", withClip: true, withBreath: true });
const { plans, slices } = makeBeats(en);
const fs = makeFactSheet();
const frozen = { schemaVersion: 1 as const, assets: makeFrozen() };
const picks = makePicks(plans, frozen.assets);
const timeline = makeTimeline({ seconds: 30 });
const good: DocSet = { project, factSheet: fs, scripts: { en, fr }, plans, slices: { en: slices }, picks, frozen, timeline };

describe("checkRefs", () => {
  it("is clean on a consistent factory set", () => {
    expect(checkRefs(good)).toEqual([]);
  });
  it("REF_PROJECT", () => {
    expect(rules({ project: { ...project, primaryLang: "fr", languages: ["en"] } })).toContain("REF_PROJECT");
    expect(rules({ project: { ...project, languages: ["en", "en"] } })).toContain("REF_PROJECT");
    expect(rules({ project: { ...project, languages: ["fr"], primaryLang: "fr" } })).toContain("REF_PROJECT"); // voice.en left over
  });
  it("REF_SEGMENT (unparsed documents)", () => {
    const s = clone(en);
    s.chapters[0]!.segments[0]!.id = "CH2-S01";
    expect(rules({ scripts: { en: s } })).toContain("REF_SEGMENT");
  });
  it("REF_BEAT_SEGMENT", () => {
    const p = clone(plans);
    p.plans[0]!.segmentId = "CH1-S77";
    expect(rules({ scripts: { en }, plans: p })).toContain("REF_BEAT_SEGMENT");
    const q = clone(plans);
    const clipBeat = q.plans.find((x) => x.id.endsWith("-CLIP"))!;
    clipBeat.id = clipBeat.id.replace("-CLIP", "-BR");
    expect(rules({ scripts: { en }, plans: q })).toContain("REF_BEAT_SEGMENT");
  });
  it("REF_BEAT_FACTS", () => {
    const p = clone(plans);
    p.plans[0]!.personIds = ["P99"];
    p.plans[1]!.factIds = ["N77"];
    p.plans[2]!.quoteId = "Q42";
    expect(checkRefs({ factSheet: fs, plans: p }).filter((i) => i.rule === "REF_BEAT_FACTS")).toHaveLength(3);
  });
  it("REF_SLICE_PLAN", () => {
    const s = clone(slices);
    s.texts = s.texts.filter((x) => x.beatId !== plans.plans[0]!.id);
    expect(rules({ plans, slices: { en: s } })).toContain("REF_SLICE_PLAN");
    const t = clone(slices);
    t.texts.find((x) => x.beatId.endsWith("-CLIP"))!.text = "should be empty";
    expect(rules({ plans, slices: { en: t } })).toContain("REF_SLICE_PLAN");
  });
  it("REF_PICK and REF_CLIP", () => {
    const p = clone(picks);
    p.picks[0]!.assetId = "f".repeat(64);
    expect(rules({ plans, picks: p, frozen })).toContain("REF_PICK");
    const q = clone(picks);
    q.clips[0]!.segmentId = "CH1-S01";
    expect(rules({ scripts: { en }, picks: q, frozen })).toContain("REF_CLIP");
  });
  it("REF_QUOTE", () => {
    const f = clone(fs);
    f.quotes[0]!.speakerId = "P99";
    f.quotes[1]!.sourceId = "S99";
    expect(checkRefs({ factSheet: f }).filter((i) => i.rule === "REF_QUOTE")).toHaveLength(2);
  });
  it("REF_TIMELINE_ASSETS", () => {
    const t = clone(timeline);
    const first = collectAssetIds(t)[0]!;
    delete t.assets[first];
    expect(rules({ timeline: t })).toContain("REF_TIMELINE_ASSETS");
  });
  it("REF_OVERRIDE_TARGET is a warning", () => {
    const issues = checkRefs({
      timeline,
      overrides: { schemaVersion: 1, lang: "en", overrides: [{ id: "o1", createdAt: "2026-10-02T00:00:00Z", target: { itemId: "ov:nope", component: null, beatId: null, planKey: null, assetId: null, wordNorm: null }, override: { op: "removeItem", itemId: "ov:nope" } }] },
    });
    expect(issues).toEqual([expect.objectContaining({ rule: "REF_OVERRIDE_TARGET", level: "warn" })]);
  });
  it("LANG_PARITY", () => {
    const f = clone(fr);
    f.chapters[0]!.segments.reverse();
    expect(rules({ project, scripts: { en, fr: f } })).toContain("LANG_PARITY");
  });
});

describe("validateLangParity", () => {
  it("accepts transcreations with the same skeleton and rejects any skeleton change", () => {
    expect(validateLangParity(en, fr)).toEqual([]);
    const a = clone(fr);
    a.chapters[1]!.segments.pop();
    expect(validateLangParity(en, a).length).toBeGreaterThan(0);
    const b = clone(fr);
    b.chapters[1]!.segments.find((s) => s.type === "clip")!.quoteId = "Q2";
    expect(validateLangParity(en, b)[0]!.rule).toBe("LANG_PARITY");
    const c = clone(fr);
    c.chapters.pop();
    expect(validateLangParity(en, c).length).toBe(1);
  });
});

describe("collectAssetIds / timelineItemIds", () => {
  it("collects sources, overlay props and audio assets, sorted and unique", () => {
    const ids = collectAssetIds(timeline);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(timeline.audio.voProgram.assetId);
    for (const v of timeline.video) if (v.source.kind === "image") expect(ids).toContain(v.source.assetId);
    const t = clone(timeline);
    const ov = t.overlays[0]!;
    (ov as { props: Record<string, unknown> }).props = { ...(ov.props as Record<string, unknown>), portraitAssetId: "e".repeat(64) };
    expect(collectAssetIds(t)).toContain("e".repeat(64));
  });
  it("lists every item id (duplicates kept)", () => {
    const ids = timelineItemIds(timeline);
    expect(new Set(ids).size).toBe(ids.length);
    const t = clone(timeline);
    t.captions.push(t.captions[0]!);
    expect(new Set(timelineItemIds(t)).size).toBe(timelineItemIds(t).length - 1);
  });
});
