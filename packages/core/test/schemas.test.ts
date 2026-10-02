import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  Anchor, BeatId, BrowserDoc, CacheIndex, DOC_REGISTRY, DOC_VERSIONS, type DocKind, ExportTimeline, FactSheet, FixtureManifest, GlProbe, HomeConfig,
  JobEvent, NewProjectInput, OVERLAY_PROPS, COMPONENT_META, OverlayComponentId, OverlayItem, Script, SfxManifest, StyleData, TakeId, Transition, VoiceSettings,
  docEntryFor, P,
} from "../src/index";
import { TEST_STYLE } from "../src/testing/index";
import { SAMPLES } from "./samples";

const EXTRA: Partial<Record<DocKind, z.ZodType>> = {
  fixture: FixtureManifest, cacheIndex: CacheIndex, homeConfig: HomeConfig, glProbe: GlProbe, browser: BrowserDoc, sfxManifest: SfxManifest,
};
const schemaFor = (k: DocKind): z.ZodType => DOC_REGISTRY.find((e) => e.kind === k)?.schema ?? EXTRA[k]!;

describe("every persisted document schema", () => {
  it("has a sample for every DOC_VERSIONS kind", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(DOC_VERSIONS).sort());
  });
  for (const kind of Object.keys(DOC_VERSIONS) as DocKind[]) {
    describe(kind, () => {
      const s = SAMPLES[kind];
      const schema = schemaFor(kind);
      it("parses a valid sample", () => {
        const r = schema.safeParse(s.value);
        expect(r.success, JSON.stringify(r.error?.issues?.slice(0, 3))).toBe(true);
      });
      it("rejects a wrong schemaVersion", () => {
        expect(schema.safeParse({ ...s.value, schemaVersion: DOC_VERSIONS[kind] + 98 }).success).toBe(false);
      });
      it(`rejects a missing required field (${s.required})`, () => {
        const v = { ...s.value };
        delete v[s.required];
        expect(schema.safeParse(v).success).toBe(false);
      });
      if (s.rel) it("is found by docEntryFor at its path", () => expect(docEntryFor(s.rel!)?.kind).toBe(kind));
    });
  }
});

describe("contract-specific invariants", () => {
  it("overlap transitions must have even durations", () => {
    expect(Transition.safeParse({ kind: "overlap", presentation: "dissolve", durationFrames: 13, direction: "left" }).success).toBe(false);
    expect(Transition.safeParse({ kind: "overlap", presentation: "dissolve", durationFrames: 14, direction: "left" }).success).toBe(true);
    expect(Transition.safeParse({ kind: "overlap", presentation: "dissolve", durationFrames: 2, direction: "left" }).success).toBe(false);
  });
  it("script segments must carry their chapter prefix and be unique", () => {
    const s = structuredClone(SAMPLES.script.value) as unknown as Script;
    s.chapters[0]!.segments[0]!.id = "CH2-S01";
    expect(Script.safeParse(s).success).toBe(false);
    const d = structuredClone(SAMPLES.script.value) as unknown as Script;
    d.chapters[0]!.segments[1]!.id = d.chapters[0]!.segments[0]!.id;
    expect(Script.safeParse(d).success).toBe(false);
  });
  it("fact sheets reject duplicate ids", () => {
    const f = structuredClone(SAMPLES.factsheet.value) as unknown as FactSheet;
    f.people.push({ ...f.people[0]! });
    expect(FactSheet.safeParse(f).success).toBe(false);
    const g = structuredClone(SAMPLES.factsheet.value) as unknown as FactSheet;
    g.quotes.push({ ...g.quotes[0]! });
    expect(FactSheet.safeParse(g).success).toBe(false);
  });
  it("id grammars", () => {
    for (const ok of ["CH3-B014", "CH3-S07-CLIP", "CH3-S09-BR"]) expect(BeatId.safeParse(ok).success).toBe(true);
    for (const bad of ["CH3-B14", "CH3-S07-clip", "B014"]) expect(BeatId.safeParse(bad).success).toBe(false);
    expect(TakeId.safeParse("take-0123456789ab").success).toBe(true);
    expect(TakeId.safeParse("take-20261002-1").success).toBe(false);
  });
  it("anchors and overlay items", () => {
    const a = Anchor.parse({ ref: "word", wordId: "CH1-S01:3", edge: "start", offset: -2, expectNorm: "auction" });
    expect(OverlayItem.safeParse({ id: "ov:CH1-B001:LowerThird:0", start: a, end: { ref: "program", edge: "start", offset: 120 }, from: 10, dur: 100, beatId: null, band: "graphics", z: 100, zone: "lowerThird", enterFrames: 10, exitFrames: 8, followsCamera: false, component: "LowerThird", props: { name: "Carolus Clusius", role: "Botanist", align: "left" } }).success).toBe(true);
    expect(OverlayItem.safeParse({ id: "x", start: a, end: a, from: 0, dur: 0, beatId: null, band: "graphics", z: 1, zone: "center", enterFrames: 0, exitFrames: 0, followsCamera: false, component: "LowerThird", props: { name: "", role: "", align: "left" } }).success).toBe(false);
  });
  it("component tables are complete", () => {
    expect(Object.keys(COMPONENT_META).sort()).toEqual([...OverlayComponentId.options].sort());
    expect(Object.keys(OVERLAY_PROPS).sort()).toEqual([...OverlayComponentId.options].sort());
  });
  it("TEST_STYLE (Appendix A) parses as StyleData and act shares sum to 1", () => {
    expect(StyleData.safeParse(TEST_STYLE).success).toBe(true);
    for (const sh of TEST_STYLE.scriptProfile.storyShapes) expect(Math.abs(sh.acts.reduce((a, b) => a + b.share, 0) - 1)).toBeLessThan(1e-6);
    expect(StyleData.safeParse({ ...TEST_STYLE, clipLayout: "nope" }).success).toBe(false);
    expect(StyleData.safeParse({ ...TEST_STYLE, manifest: { ...TEST_STYLE.manifest, id: "Bad Id" } }).success).toBe(false);
  });
  it("misc schemas", () => {
    expect(VoiceSettings.parse({ provider: "synthetic", voiceId: "synthetic-m1" }).cloneConsent).toBeNull();
    expect(VoiceSettings.safeParse({ provider: "synthetic", voiceId: "x", speed: 2 }).success).toBe(false);
    expect(NewProjectInput.parse({ idea: "abc" }).languages).toEqual(["en"]);
    expect(NewProjectInput.safeParse({ idea: "ab" }).success).toBe(false);
    expect(JobEvent.safeParse({ jobId: "j", seq: 0, at: "2026-10-02T00:00:00Z", type: "job-end", status: "succeeded" }).success).toBe(true);
    expect(JobEvent.safeParse({ jobId: "j", seq: -1, at: "2026-10-02T00:00:00Z", type: "job-end", status: "succeeded" }).success).toBe(false);
    const et = { name: "x", lang: "en", fps: { num: 30, den: 1 }, ntsc: false, width: 1920, height: 1080, durationFrames: 30, sampleRate: 48000, tcStartFrames: 0, media: [], video: [{ name: "V1", enabled: true, clips: [], transitions: [{ cutFrame: 10, duration: 4, kind: "dissolve" }] }], audio: [], markers: [] };
    expect(ExportTimeline.safeParse(et).success).toBe(true);
    expect(ExportTimeline.safeParse({ ...et, video: [{ name: "V1", enabled: true, clips: [], transitions: [{ cutFrame: 10, duration: 5, kind: "dissolve" }] }] }).success).toBe(false);
    expect(ExportTimeline.safeParse({ ...et, sampleRate: 44100 }).success).toBe(false);
  });
  it("docEntryFor returns null for unregistered paths and P builds registry paths", () => {
    expect(docEntryFor("research/dossier.md")).toBeNull();
    expect(docEntryFor("./timeline/fr.json")?.compact).toBe(true);
    expect(P.renderChunk("en", "draft", "abc")).toBe("render/en/draft/chunks/abc.ts");
  });
});
