import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DocmakerError, ProgramLayout, Script, frameToMs, msToFrame, stableStringify } from "@docmaker/core";
import { TEST_STYLE } from "@docmaker/core/testing";
import { layoutProgram } from "../src/index";
import { buildInputs, makeOutline } from "./fixtures";
import { richScenario } from "./rich";

const here = dirname(fileURLToPath(import.meta.url));

describe("layoutProgram", () => {
  const sc = richScenario();
  const b = buildInputs({ script: sc.script, plans: sc.plans, slices: sc.slices, take: sc.take, frozen: sc.frozen, clips: sc.clips });
  const L = b.layout;

  it("produces a schema-valid layout", () => {
    expect(() => ProgramLayout.parse(L)).not.toThrow();
  });

  it("assigns every layout mode and emits sponsor markers", () => {
    const mode = (id: string) => L.segments.find((s) => s.segmentId === id)?.mode;
    expect(mode(sc.foundSeg.id)).toBe("clip");
    expect(mode(sc.narratedSeg.id)).toBe("clip-narrated");
    expect(mode(sc.cardSeg.id)).toBe("clip-card");
    expect(L.segments.some((s) => s.mode === "breath")).toBe(true);
    expect(L.sponsorMarkers).toHaveLength(1);
    expect(L.segments.some((s) => s.segmentId === L.sponsorMarkers[0]!.segmentId)).toBe(false);
  });

  it("beats tile their chapter", () => {
    for (const ch of L.chapters) {
      const bs = L.beats.filter((x) => x.chapterId === ch.chapterId);
      expect(bs.length).toBeGreaterThan(0);
      expect(bs[0]!.from).toBe(ch.from);
      for (let k = 0; k < bs.length; k++) {
        const x = bs[k]!;
        expect(x.from).toBeGreaterThanOrEqual(ch.from);
        expect(x.from + x.dur).toBeLessThanOrEqual(ch.from + ch.dur);
        expect(x.dur).toBeGreaterThan(0);
        if (k + 1 < bs.length) expect(x.from + x.dur).toBe(bs[k + 1]!.from);
        else expect(x.from + x.dur).toBe(ch.from + ch.dur);
        expect(x.beatId.startsWith(ch.chapterId + "-")).toBe(true);
      }
    }
    // chapters tile the program
    expect(L.chapters[0]!.from).toBe(0);
    const last = L.chapters.at(-1)!;
    expect(last.from + last.dur).toBe(L.durationInFrames);
  });

  it("quantises segment starts to frames", () => {
    for (const s of L.segments) {
      expect(s.startMs).toBe(frameToMs(msToFrame(s.startMs, L.fps), L.fps));
      expect(s.from).toBe(msToFrame(s.startMs, L.fps));
    }
    expect(L.durationMs).toBe(frameToMs(L.durationInFrames, L.fps));
  });

  it("keeps words strictly increasing and never overlapping", () => {
    for (let k = 1; k < L.words.length; k++) {
      expect(L.words[k]!.from).toBeGreaterThan(L.words[k - 1]!.from);
      expect(L.words[k - 1]!.from + L.words[k - 1]!.dur).toBeLessThanOrEqual(L.words[k]!.from);
    }
  });

  it("inserts the REVEAL pre-pause mid-segment (sum of insertions = extra duration)", () => {
    const s = L.segments.find((x) => x.segmentId === sc.revealSeg.id)!;
    expect(s.insertions).toEqual([{ afterWordIdx: 2, splitAtMs: expect.any(Number), ms: TEST_STYLE.pauses.preRevealMs }]);
    for (const x of L.segments) {
      const tk = sc.take.segments.find((t) => t.segmentId === x.segmentId);
      if (!tk || (x.mode !== "vo" && x.mode !== "clip-narrated")) continue;
      expect(x.endMs - x.startMs - tk.durationMs).toBe(x.insertions.reduce((a, i) => a + i.ms, 0));
    }
    const ws = L.words.slice(s.wordStart, s.wordEnd);
    const tk = sc.take.segments.find((t) => t.segmentId === s.segmentId)!;
    expect(ws[2]!.startMs).toBe(s.startMs + tk.words[2]!.startMs);
    expect(ws[3]!.startMs).toBe(s.startMs + tk.words[3]!.startMs + TEST_STYLE.pauses.preRevealMs);
    // the gap before the reveal word is the natural gap + preRevealMs
    expect(ws[3]!.startMs - ws[2]!.endMs).toBeGreaterThanOrEqual(TEST_STYLE.pauses.preRevealMs);
  });

  it("widens the gap before the title-sting chapter to 3.5 s and before others to the card read time", () => {
    const ch2 = L.chapters[1]!;
    expect(frameToMs(ch2.firstWordFrame! - ch2.from, L.fps)).toBeGreaterThanOrEqual(3500);
    const ch3 = L.chapters[2]!;
    expect(frameToMs(ch3.firstWordFrame! - ch3.from, L.fps)).toBeGreaterThanOrEqual(TEST_STYLE.pauses.chapterGapMs);
  });

  it("sizes clip passages, clip cards and breaths", () => {
    const clip = L.segments.find((x) => x.segmentId === sc.foundSeg.id)!;
    expect(clip.endMs - clip.startMs).toBe(4000);
    expect(clip.clipAssetId).toBe(sc.clips[0]!.assetId);
    expect(clip.clipPassageInMs).toBe(1000);
    const card = L.segments.find((x) => x.segmentId === sc.cardSeg.id)!;
    expect(card.endMs - card.startMs).toBe(Math.max(3000, Math.round(1000 * ([...sc.cardSeg.displayText].length / 15) + 1500)));
    expect(card.wordEnd - card.wordStart).toBe(0);
    const br = L.segments.find((x) => x.mode === "breath")!;
    expect(br.endMs - br.startMs).toBe(2000);
    const cn = L.segments.find((x) => x.segmentId === sc.narratedSeg.id)!;
    expect(cn.wordEnd - cn.wordStart).toBeGreaterThan(0);
    const cnBeat = L.beats.find((x) => x.beatId === `${sc.narratedSeg.id}-CLIP`)!;
    expect([cnBeat.wordStart, cnBeat.wordEnd]).toEqual([cn.wordStart, cn.wordEnd]);
  });

  it("fails with ANCHOR_MISSING when the take misses a narration segment", () => {
    const take = { ...sc.take, segments: sc.take.segments.slice(1) };
    try {
      layoutProgram({ ...b.layoutInput, take });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DocmakerError);
      expect((e as DocmakerError).code).toBe("ANCHOR_MISSING");
    }
  });

  it("is deterministic and matches the golden file", () => {
    const again = layoutProgram(b.layoutInput);
    const s = stableStringify(again, 0);
    expect(stableStringify(layoutProgram(b.layoutInput), 0)).toBe(s);
    const golden = join(here, "golden", "layout.json");
    if (!existsSync(golden) || process.env.UPDATE_GOLDEN === "1") {
      mkdirSync(dirname(golden), { recursive: true });
      writeFileSync(golden, stableStringify(again, 2));
    }
    expect(stableStringify(again, 2)).toBe(readFileSync(golden, "utf8"));
  });

  it("starts the program at the first kept chapter (onlyChapters)", () => {
    const kept = Script.parse({ ...sc.script, chapters: sc.script.chapters.slice(1) });
    const keptPlans = { ...sc.plans, plans: sc.plans.plans.filter((p) => p.chapterId !== "CH1") };
    const keptTexts = sc.slices.texts.filter((t) => !t.beatId.startsWith("CH1-"));
    const L2 = layoutProgram({
      ...b.layoutInput, script: kept, plans: keptPlans.plans, texts: keptTexts, outline: makeOutline(sc.script), onlyChapters: ["CH2", "CH3"],
    });
    expect(L2.chapters[0]!.chapterId).toBe("CH2");
    expect(L2.chapters[0]!.from).toBe(0);
    expect(L2.onlyChapters).toEqual(["CH2", "CH3"]);
    expect(L2.words[0]!.startMs).toBeGreaterThanOrEqual(TEST_STYLE.pauses.headMs);
  });

  it("works at 24 and 25 fps", () => {
    for (const fps of [24, 25] as const) {
      const L3 = layoutProgram({ ...b.layoutInput, fps });
      expect(L3.fps).toBe(fps);
      for (let k = 1; k < L3.words.length; k++) expect(L3.words[k]!.from).toBeGreaterThan(L3.words[k - 1]!.from);
    }
  });
});
