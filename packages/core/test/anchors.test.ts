import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { type Anchor, buildAnchorIndex, docHash, isDocmakerError, resolveAnchor, resolveTimeline } from "../src/index";
import { makeLayout, makeTimeline } from "../src/testing/index";

const layout = makeLayout({ seconds: 30 });
const ix = buildAnchorIndex(layout, docHash(layout));

describe("resolveAnchor", () => {
  it("resolves every ref kind at both edges with offsets", () => {
    const w = layout.words[3]!;
    const s = layout.segments[1]!;
    const b = layout.beats[2]!;
    const c = layout.chapters[0]!;
    const cases: [Anchor, number][] = [
      [{ ref: "word", wordId: w.id, edge: "start", offset: 0, expectNorm: w.norm }, w.from],
      [{ ref: "word", wordId: w.id, edge: "end", offset: 2, expectNorm: null }, w.from + w.dur + 2],
      [{ ref: "segment", segmentId: s.segmentId, edge: "start", offset: -1 }, s.from - 1],
      [{ ref: "segment", segmentId: s.segmentId, edge: "end", offset: 0 }, s.from + s.dur],
      [{ ref: "beat", beatId: b.beatId, edge: "start", offset: 5 }, b.from + 5],
      [{ ref: "beat", beatId: b.beatId, edge: "end", offset: 0 }, b.from + b.dur],
      [{ ref: "chapter", chapterId: c.chapterId, edge: "end", offset: 0 }, c.from + c.dur],
      [{ ref: "program", edge: "start", offset: 42 }, 42],
      [{ ref: "program", edge: "end", offset: 0 }, layout.durationInFrames],
    ];
    for (const [a, f] of cases) expect(resolveAnchor(a, ix)).toBe(f);
  });
  it("clamps to [0, programEnd]", () => {
    expect(resolveAnchor({ ref: "program", edge: "start", offset: -50 }, ix)).toBe(0);
    expect(resolveAnchor({ ref: "program", edge: "end", offset: 50 }, ix)).toBe(layout.durationInFrames);
  });
  it("throws ANCHOR_MISSING for unknown ids", () => {
    for (const a of [
      { ref: "word", wordId: "CH9-S99:1", edge: "start", offset: 0, expectNorm: null },
      { ref: "beat", beatId: "CH9-B001", edge: "start", offset: 0 },
      { ref: "segment", segmentId: "CH9-S01", edge: "end", offset: 0 },
      { ref: "chapter", chapterId: "CH9", edge: "end", offset: 0 },
    ] as Anchor[]) {
      try {
        resolveAnchor(a, ix);
        expect.unreachable();
      } catch (e) {
        expect(isDocmakerError(e) && e.code === "ANCHOR_MISSING").toBe(true);
      }
    }
  });
});

describe("resolveTimeline", () => {
  it("is the identity on a director-like timeline built against the same layout", () => {
    for (const seconds of [5, 30, 120]) {
      const L = makeLayout({ seconds });
      const t = makeTimeline({ seconds });
      const r = resolveTimeline(t, buildAnchorIndex(L, docHash(L)));
      expect(r.dropped).toEqual([]);
      expect(isDeepStrictEqual(r.timeline, t)).toBe(true);
    }
  });
  it("throws VALIDATION (re-direct required) on another layout hash", () => {
    const t = makeTimeline({ seconds: 30 });
    try {
      resolveTimeline(t, { ...ix, layoutHash: "0".repeat(64) });
      expect.unreachable();
    } catch (e) {
      expect(isDocmakerError(e) && e.code === "VALIDATION" && /re-direct/.test(e.message)).toBe(true);
    }
  });
  it("re-resolves moved anchors, keeps video contiguous and drops items with missing anchors", () => {
    const t = makeTimeline({ seconds: 30 });
    const ov = t.overlays[t.overlays.length - 1]!;
    (ov.start as { offset: number }).offset += 3;
    ov.end = { ref: "word", wordId: "CH9-S99:0", edge: "start", offset: 0, expectNorm: null };
    const v = t.video[1]!;
    (v.start as { offset: number }).offset += 4;
    const r = resolveTimeline(t, ix);
    expect(r.dropped).toEqual([ov.id]);
    const vids = r.timeline.video;
    expect(vids[0]!.from).toBe(0);
    for (let i = 1; i < vids.length; i++) expect(vids[i]!.from).toBe(vids[i - 1]!.from + vids[i - 1]!.dur);
    expect(vids[vids.length - 1]!.from + vids[vids.length - 1]!.dur).toBe(t.durationInFrames);
    expect(vids[1]!.from).toBe(t.video[1]!.from + 4);
  });
});
