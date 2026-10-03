// Edit-quality regressions (P4): no bare generated backdrop longer than DEAD_AIR_MAX_SEC; slams and kinetic cards
// never read as a lone function word.
import { describe, expect, it } from "vitest";
import { isFunctionWord } from "@docmaker/core";
import { bareStretches } from "../src/dead-air";
import { contentText } from "../src/overlays/cues";
import { deadAirStretches } from "../src/stats";
import { direct } from "../src/index";
import { errorsOf, runs } from "./helpers";
import { tulipInputs } from "./tulip";

/** The tulip programme as the online demo directed it: graphic beats (map, document, text card, motion graphic) have no
 *  picked picture, so their shots are generated backdrops under late-entering cards (CH2-B008 QuoteCard, CH3-B002 timeline). */
function tulipBackdrops() {
  const built = tulipInputs();
  const graphic = new Set(built.plans.plans.filter((p) => ["map", "document_screenshot", "text_card", "motion_graphic"].includes(p.visualKind)).map((p) => p.id));
  built.input.picks = { ...built.input.picks, picks: built.input.picks.picks.filter((p) => !graphic.has(p.beatId)) };
  return direct(built.input);
}

describe("dead air (bare generated backdrops)", () => {
  it("bareStretches subtracts foreground spans from backdrop-only runs", () => {
    const pics = [{ from: 0, end: 30, bare: false }, { from: 30, end: 120, bare: true }, { from: 120, end: 200, bare: true }, { from: 200, end: 260, bare: false }];
    expect(bareStretches(pics, [], 36)).toEqual([{ from: 30, end: 200 }]);
    expect(bareStretches(pics, [{ from: 60, end: 180 }], 36)).toEqual([]);
    expect(bareStretches(pics, [{ from: 100, end: 150 }], 36)).toEqual([{ from: 30, end: 100 }, { from: 150, end: 200 }]);
    expect(bareStretches(pics, [{ from: 0, end: 160 }], 36)).toEqual([{ from: 160, end: 200 }]);
  });
  it("tulip with backdrop-only graphic beats: every stretch is filled (card early entry / hold, kinetic text, held shot)", () => {
    const out = tulipBackdrops();
    const t = out.timeline;
    const left = deadAirStretches(t).map((s) => `${(s.from / t.fps).toFixed(2)}–${(s.end / t.fps).toFixed(2)} s`);
    expect(left).toEqual([]);
    expect(errorsOf(out)).toEqual([]);
    expect(out.lint.filter((l) => l.rule === "DEAD_AIR")).toEqual([]);
    // the Mackay quote card (CH2-B008) now opens with its beat instead of 2–3 s into a bare backdrop
    const quote = t.overlays.find((o) => o.beatId === "CH2-B008" && o.component === "QuoteCard")!;
    const beatShot = t.video.find((c) => c.beatId === "CH2-B008")!;
    expect(quote.from - beatShot.from).toBeLessThanOrEqual(Math.round(1.2 * t.fps));
    // its words still appear when they are spoken (absolute frames unchanged by the earlier entry)
    const words = (quote.props as { words: { at: number }[] }).words;
    for (const w of words) expect(quote.from + w.at).toBeGreaterThanOrEqual(beatShot.from);
    // the CH3-B002 timeline opens on its first event (localized date), the second waits for its spoken date
    const tl = t.overlays.find((o) => o.beatId === "CH3-B002" && o.component === "TimelineGraphic")!;
    const evs = (tl.props as { events: { at: number; dateLabel: string }[] }).events;
    expect(evs.map((e) => e.dateLabel)).toEqual(["5 Feb 1637", "24 Feb 1637"]);
    expect(evs[0]!.at).toBeLessThanOrEqual(tl.enterFrames + 4);
  });
  for (const name of ["rich", "policy", "tulip"] as const) {
    it(`${name}: no backdrop-only stretch longer than 1.2 s, no lint error`, () => {
      const out = runs()[name];
      const fps = out.timeline.fps;
      const left = deadAirStretches(out.timeline).map((s) => `${(s.from / fps).toFixed(2)}–${(s.end / fps).toFixed(2)} s`);
      expect(left).toEqual([]);
      expect(errorsOf(out)).toEqual([]);
    });
  }
});

describe("no lone function word on a slam or kinetic card", () => {
  it("contentText drops trailing function words and refuses function-word-only text", () => {
    expect(contentText("the", "en")).toBeNull();
    expect(contentText("Of the", "en")).toBeNull();
    expect(contentText("prices collapsed and", "en")).toBe("prices collapsed");
    expect(contentText("The twist", "en")).toBe("The twist");
    expect(contentText("la", "fr")).toBeNull();
    expect(contentText("la chute", "fr")).toBe("la chute");
  });
  it("timelines: every KeywordSlam / KineticText carries a content word", () => {
    for (const out of Object.values(runs())) {
      for (const o of out.timeline.overlays) {
        if (o.component !== "KeywordSlam" && o.component !== "KineticText") continue;
        const p = o.props as { text?: string; lines?: string[] };
        const text = o.component === "KeywordSlam" ? p.text! : p.lines!.join(" ");
        expect(text.split(/\s+/).some((w) => !isFunctionWord(w, out.timeline.lang)), `${o.id}: "${text}"`).toBe(true);
      }
    }
  });
});
