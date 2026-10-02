import { describe, expect, it } from "vitest";
import {
  BeatPlansDoc, BeatSlicesDoc, FactSheet, FrozenAsset, MusicTrack, P, PicksDoc, ProgramLayout, Project, Script, SfxCategory, SfxEntry, SfxManifest,
  StyleData, Timeline, VoiceTrack, beatWordRanges, checkRefs, spokenText, stableStringify, timelineItemIds, validateLangParity,
} from "../src/index";
import {
  TEST_STYLE, makeBeats, makeFactSheet, makeFrozen, makeLayout, makeMusicTrack, makePicks, makeProject, makeScenario, makeScript, makeSfxEntry,
  makeSfxManifest, makeTake, makeTimeline,
} from "../src/testing/index";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } }, v: unknown) => {
  const r = schema.safeParse(v);
  expect(r.success, JSON.stringify(r.error?.issues.slice(0, 3))).toBe(true);
};

describe("testing factories produce schema-valid documents", () => {
  it("project, facts, style", () => {
    ok(Project, makeProject());
    ok(Project, makeProject({ languages: ["en", "fr"], targetMinutes: 30 }));
    ok(FactSheet, makeFactSheet({ people: 7, quotes: 5, figures: 3 }));
    ok(StyleData, TEST_STYLE);
  });
  it("scripts in EN and FR keep the same skeleton (parity) and contain digits and « »", () => {
    for (const o of [{}, { withClip: true, withBreath: true }, { chapters: 1, segmentsPerChapter: 1 }]) {
      const en = makeScript(o);
      const fr = makeScript({ ...o, lang: "fr" });
      ok(Script, en);
      ok(Script, fr);
      expect(validateLangParity(en, fr)).toEqual([]);
    }
    const fr = makeScript({ lang: "fr" });
    const all = fr.chapters.flatMap((c) => c.segments.map((s) => s.displayText)).join(" ");
    expect(all).toMatch(/«/);
    expect(all).toMatch(/\d/);
  });
  it("beats are exact slices with valid plan keys; synthetic beats carry no text", () => {
    const s = makeScript({ withClip: true, withBreath: true });
    const { plans, slices } = makeBeats(s);
    ok(BeatPlansDoc, plans);
    ok(BeatSlicesDoc, slices);
    expect(plans.plans.some((p) => p.id.endsWith("-CLIP"))).toBe(true);
    expect(plans.plans.some((p) => p.id.endsWith("-BR"))).toBe(true);
    for (const ch of s.chapters) for (const seg of ch.segments.filter((x) => x.type === "narration")) {
      const texts = slices.texts.filter((t) => plans.plans.find((p) => p.id === t.beatId)!.segmentId === seg.id).map((t) => t.text);
      expect(() => beatWordRanges(spokenText(seg, "vo"), texts)).not.toThrow();
    }
    expect(checkRefs({ scripts: { en: s }, plans, slices: { en: slices }, factSheet: makeFactSheet() })).toEqual([]);
  });
  it("takes, media, picks, sfx and music", () => {
    const s = makeScript();
    const take = makeTake(s);
    ok(VoiceTrack, take);
    expect(take.id).toMatch(/^scratch-[a-f0-9]{12}$/);
    expect(take.segments[0]!.file).toBe(P.takeSegment("en", take.id, take.segments[0]!.segmentId));
    expect(makeTake(s).id).toBe(take.id);
    const frozen = makeFrozen({ images: 3, videos: 2, portrait: true });
    for (const a of Object.values(frozen)) ok(FrozenAsset, a);
    expect(Object.values(frozen).filter((a) => a.height! > a.width!)).toHaveLength(1);
    const { plans } = makeBeats(makeScript({ withClip: true }));
    const picks = makePicks(plans, frozen);
    ok(PicksDoc, picks);
    expect(picks.clips).toHaveLength(1);
    const man = makeSfxManifest();
    ok(SfxManifest, man);
    expect(man.entries.map((e) => e.category)).toEqual(SfxCategory.options);
    ok(SfxEntry, makeSfxEntry({ category: "riser", variant: 3 }));
    const m = makeMusicTrack({ bpm: 120, seconds: 10 });
    ok(MusicTrack, m);
    expect(m.beatsMs.slice(0, 3)).toEqual([0, 500, 1000]);
    expect(m.downbeatsMs.slice(0, 2)).toEqual([0, 2000]);
  });
  it("layouts: beats tile their chapters, words increase, exact duration", () => {
    for (const o of [{ seconds: 5 }, { seconds: 60 }, { seconds: 120, withClip: true, withBreath: true, withReveal: true }, { seconds: 30, fps: 25 as const }]) {
      const L = makeLayout(o);
      ok(ProgramLayout, L);
      expect(L.durationInFrames).toBe(Math.round(o.seconds * (o.fps ?? 30)));
      for (const ch of L.chapters) {
        const bs = L.beats.filter((b) => b.chapterId === ch.chapterId);
        expect(bs[0]!.from).toBe(ch.from);
        for (let i = 1; i < bs.length; i++) expect(bs[i]!.from).toBe(bs[i - 1]!.from + bs[i - 1]!.dur);
        expect(bs[bs.length - 1]!.from + bs[bs.length - 1]!.dur).toBe(ch.from + ch.dur);
      }
      for (let i = 1; i < L.words.length; i++) expect(L.words[i]!.from).toBeGreaterThan(L.words[i - 1]!.from);
      expect(L.chapters[L.chapters.length - 1]!.from + L.chapters[L.chapters.length - 1]!.dur).toBe(L.durationInFrames);
    }
    const sc = makeScenario({ seconds: 120, withClip: true, withBreath: true, withReveal: true });
    expect(sc.layout.segments.filter((s) => s.insertions.length > 0)).toHaveLength(1);
    expect(sc.layout.segments.map((s) => s.mode)).toEqual(expect.arrayContaining(["vo", "clip", "breath"]));
  });
  it("timelines: valid, contiguous, unique ids, every M1 component, deterministic", () => {
    const t = makeTimeline({ seconds: 120 });
    ok(Timeline, t);
    expect(t.video[0]!.from).toBe(0);
    for (let i = 1; i < t.video.length; i++) expect(t.video[i]!.from).toBe(t.video[i - 1]!.from + t.video[i - 1]!.dur);
    const ids = timelineItemIds(t);
    expect(new Set(ids).size).toBe(ids.length);
    const comps = new Set(t.overlays.map((o) => o.component));
    for (const c of ["LowerThird", "ChapterCard", "TitleSting", "NumberCounter", "DateStamp", "MapPin", "DocumentCard", "KineticText", "KeywordSlam", "Stamp", "SourceLabel"]) expect(comps.has(c as never)).toBe(true);
    expect(t.captions.some((c) => c.burn)).toBe(true);
    expect(t.video.some((v) => v.transitionIn.kind === "overlap")).toBe(true);
    expect(t.video.some((v) => v.transitionIn.kind === "cover")).toBe(true);
    expect(t.video.some((v) => v.layout === "card")).toBe(true);
    expect(checkRefs({ timeline: t })).toEqual([]);
    expect(stableStringify(makeTimeline({ seconds: 120 }), 0)).toBe(stableStringify(t, 0));
    expect(makeTimeline({ seconds: 5 }).durationInFrames).toBe(150);
    ok(Timeline, makeTimeline({ seconds: 20, overlays: false, audio: false, transitions: false, fps: 24 }));
  });
  it("makeTimeline({seconds:1800}) is valid and ≤ 5 MB as compact JSON", () => {
    const t = makeTimeline({ seconds: 1800 });
    ok(Timeline, t);
    expect(t.durationInFrames).toBe(54000);
    const bytes = new TextEncoder().encode(stableStringify(t, 0)).length;
    expect(bytes).toBeLessThanOrEqual(5 * 1024 * 1024);
  });
});
