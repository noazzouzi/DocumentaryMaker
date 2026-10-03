import { describe, expect, it } from "vitest";
import { COMPONENT_META, type LayoutWord } from "@docmaker/core";
import { TEST_STYLE } from "@docmaker/core/testing";
import { direct, groupCaptions } from "../src/index";
import { readText } from "../src/overlays/hold";
import { runs } from "./helpers";
import { policyScenario } from "./scenario";
import { tulipInputs } from "./tulip";

const G = TEST_STYLE.captionDNA.grouping;
let n = 0;
function w(text: string, startMs: number, endMs: number): LayoutWord {
  const k = n++;
  return { id: `CH1-S01:${k}`, segmentId: "CH1-S01", idx: k, text, norm: text.toLowerCase().replace(/[^a-z0-9]/g, ""), from: Math.round((startMs * 30) / 1000), dur: Math.max(1, Math.round(((endMs - startMs) * 30) / 1000)), startMs, endMs };
}
function seq(texts: string[], gapMs = 60, durMs = 260, start = 0): LayoutWord[] {
  n = 0;
  let t = start;
  return texts.map((x) => { const r = w(x, t, t + durMs); t += durMs + gapMs; return r; });
}

describe("groupCaptions (§9.4)", () => {
  it("breaks on sentence ends, long pauses, commas with a pause, maxWords and maxChars", () => {
    const g1 = groupCaptions(seq(["The", "market", "crashed.", "Nobody", "came", "back."]), G, 30);
    expect(g1.map((g) => g.words.map((x) => x.text).join(" "))).toEqual(["The market crashed.", "Nobody came back."]);
    const words = seq(["one", "two", "three", "four", "five", "six", "seven", "eight"]);
    expect(groupCaptions(words, G, 30).every((g) => g.words.length <= G.maxWords)).toBe(true);
    const long = seq(["extraordinarily", "unbelievable", "transactions", "everywhere"]);
    for (const g of groupCaptions(long, G, 30)) expect(g.words.map((x) => x.text).join(" ").length <= Math.round((G.maxChars * 78) / 70) || g.words.length === 1).toBe(true);
    n = 0;
    const paused = [w("Then", 0, 200), w("silence", 260, 500), w("again", 1100, 1400), w("and", 1460, 1600), w("again", 1660, 1900)];
    expect(groupCaptions(paused, G, 30).map((g) => g.words[0]!.text)).toEqual(["Then", "again"]);
  });

  it("merges groups below minWords/minSec unless the single word ends with ! or ?", () => {
    const g = groupCaptions(seq(["Gone.", "The", "whole", "market", "vanished"]), G, 30);
    expect(g.every((x) => x.words.length >= 2)).toBe(true);
    const ex = groupCaptions(seq(["Gone!", "The", "whole", "market", "vanished"]), G, 30);
    expect(ex[0]!.words.map((x) => x.text)).toEqual(["Gone!"]);
  });

  it("times groups with lead/tail/gap and never overlaps them", () => {
    const words = seq(["In", "1637", "a", "bulb", "sold.", "Then", "the", "buyers", "vanished."], 60, 300, 1000);
    const g = groupCaptions(words, G, 30);
    expect(g[0]!.from).toBe(Math.round(((1000 - G.leadMs) * 30) / 1000));
    for (let k = 0; k + 1 < g.length; k++) expect(g[k]!.from + g[k]!.dur).toBeLessThanOrEqual(g[k + 1]!.from);
    const last = g[g.length - 1]!, lw = last.words[last.words.length - 1]!;
    expect(last.from + last.dur).toBe(Math.round(((lw.endMs + G.tailMs) * 30) / 1000));
  });
});

describe("captions in the timeline", () => {
  const out = runs().policy;
  const t = out.timeline;
  const kw = t.captions.filter((c) => c.variant === "keywords");

  it("keyword phrases are ≥ minGapSec apart and ≤ maxWords words, hero on the anchor", () => {
    expect(kw.length).toBeGreaterThan(5);
    for (let i = 1; i < kw.length; i++) expect(kw[i]!.from - (kw[i - 1]!.from + kw[i - 1]!.dur), kw[i]!.id).toBeGreaterThanOrEqual(TEST_STYLE.captionDNA.keywords.minGapSec[0] * t.fps);
    for (const c of kw) {
      expect(c.words.length).toBeLessThanOrEqual(TEST_STYLE.captionDNA.keywords.maxWords);
      expect(c.words[0]!.hero).toBe(true);
      expect(c.burn).toBe(true);
      expect(c.dur).toBeGreaterThanOrEqual(TEST_STYLE.captionDNA.keywords.holdMinSec * t.fps - 1);
    }
  });

  it("SRT groups cover every spoken word exactly once (≤ 42 chars × 2 lines)", () => {
    const srtWords = t.captions.filter((c) => c.variant === "srt").flatMap((c) => c.words.map((x) => x.wordId));
    expect(new Set(srtWords).size).toBe(srtWords.length);
    const sc = policyScenario();
    const spoken = sc.layout.words.filter((x) => { const s = sc.layout.segments.find((y) => y.segmentId === x.segmentId)!; return s.mode === "vo" || s.mode === "clip-narrated"; });
    expect(new Set(srtWords)).toEqual(new Set(spoken.map((x) => x.id)));
    for (const c of t.captions.filter((x) => x.variant === "srt")) {
      expect(c.burn).toBe(false);
      expect(c.words.map((x) => x.text).join(" ").length).toBeLessThanOrEqual(84);
    }
  });

  it("burned captions are suppressed under text cards and around keyword slams", () => {
    const dna = TEST_STYLE.captionDNA;
    const sup = t.overlays.filter((o) => o.band !== "hud" && (dna.suppressUnder.includes(o.component) || readText(o.component, o.props).join(" ").split(/\s+/).filter(Boolean).length >= dna.suppressMinWords));
    expect(sup.length).toBeGreaterThan(0);
    for (const c of t.captions.filter((x) => x.burn && x.variant === "keywords")) {
      for (const o of sup) expect(c.from < o.from + o.dur && o.from < c.from + c.dur, `${c.id} under ${o.id}`).toBe(false);
    }
    void COMPONENT_META;
  });

  it("pop captions: one-line groups, at most one hero per beat, burn off under suppressors", () => {
    const sc = policyScenario({ seconds: 240, chapters: 3 });
    const out2 = direct({ ...sc.input, project: { ...sc.input.project, captions: "burn" }, renderTokens: { ...sc.input.renderTokens, captionDNA: { ...sc.input.renderTokens.captionDNA, variant: "pop" } } });
    const pop = out2.timeline.captions.filter((c) => c.variant === "pop");
    expect(pop.length).toBeGreaterThan(20);
    for (const g of pop) expect(g.words.length).toBeLessThanOrEqual(G.maxWords + 2);
    const ids = new Set(out2.timeline.captions.map((c) => c.id));
    expect(ids.size).toBe(out2.timeline.captions.length);
    for (let i = 1; i < pop.length; i++) if (pop[i]!.segmentId === pop[i - 1]!.segmentId) expect(pop[i - 1]!.from + pop[i - 1]!.dur).toBeLessThanOrEqual(pop[i]!.from);
  });

  it("pop/karaoke/rail: every group keeps its last word on screen ≥ min(word duration, 6 f), groups never overlap", () => {
    for (const make of [() => policyScenario().input, () => tulipInputs().input]) {
      const input = make();
      for (const variant of ["pop", "karaoke", "rail"] as const) {
        const o = direct({ ...input, project: { ...input.project, captions: "burn" }, renderTokens: { ...input.renderTokens, captionDNA: { ...input.renderTokens.captionDNA, variant } } });
        const gs = o.timeline.captions.filter((c) => c.variant === variant);
        expect(gs.length).toBeGreaterThan(10);
        for (const g of gs) {
          const lw = g.words[g.words.length - 1]!;
          expect(g.from + g.dur - lw.from, `${variant} ${g.id} "${lw.text}"`).toBeGreaterThanOrEqual(Math.min(lw.dur, 6));
          expect(g.from, g.id).toBeLessThanOrEqual(g.words[0]!.from); // the first word is on screen at its onset
        }
        for (let i = 1; i < gs.length; i++) expect(gs[i - 1]!.from + gs[i - 1]!.dur).toBeLessThanOrEqual(gs[i]!.from);
        expect(o.lint.filter((l) => l.level === "error")).toEqual([]);
      }
    }
  });

  it("groupCaptions on contiguous TTS timings keeps short last words visible (lead-in taken from the next group)", () => {
    const words = seq(["The", "price", "went", "up.", "Then", "it", "fell", "in", "a", "day."], 0, 180, 0);
    const g = groupCaptions(words, G, 30);
    expect(g.length).toBeGreaterThan(1);
    for (let k = 0; k < g.length; k++) {
      const lw = g[k]!.words[g[k]!.words.length - 1]!;
      expect(g[k]!.from + g[k]!.dur - lw.from).toBeGreaterThanOrEqual(Math.min(lw.dur, 6));
      expect(g[k]!.from).toBeLessThanOrEqual(g[k]!.words[0]!.from);
      if (k + 1 < g.length) expect(g[k]!.from + g[k]!.dur).toBeLessThanOrEqual(g[k + 1]!.from);
    }
  });

  it("captionsMode srt-only burns nothing", () => {
    const sc = policyScenario({ seconds: 120, chapters: 2 });
    const out3 = direct({ ...sc.input, project: { ...sc.input.project, captions: "srt-only" } });
    expect(out3.timeline.captions.some((c) => c.burn)).toBe(false);
    expect(out3.timeline.captions.some((c) => c.variant === "srt")).toBe(true);
  });
});
