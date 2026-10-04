// §13.6 SRT: keyword groups excluded, every spoken word exactly once, ≤ 42 chars × 2 lines, timing format.
import { describe, expect, it } from "vitest";
import type { CaptionGroup, Timeline } from "@docmaker/core";
import { makeTimeline } from "@docmaker/core/testing";
import { srtGroups, wrapLines, writeSrt } from "../src/index";
import { joinWords, sentenceCase } from "../src/srt";

interface Cue { n: number; from: string; to: string; lines: string[] }
function parse(srt: string): Cue[] {
  return srt.split("\r\n\r\n").filter((b) => b.trim()).map((b) => {
    const [n, times, ...lines] = b.replace(/\r\n$/, "").split("\r\n");
    const [from, to] = times!.split(" --> ");
    return { n: Number(n), from: from!, to: to!, lines };
  });
}
const ms = (s: string) => {
  const m = /^(\d\d):(\d\d):(\d\d),(\d\d\d)$/.exec(s)!;
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
};

describe("writeSrt", () => {
  const t = makeTimeline({ seconds: 120 });
  const srt = writeSrt(t);
  const cues = parse(srt);

  it("numbers cues from 1, CRLF, HH:MM:SS,mmm, monotonic and non-overlapping", () => {
    expect(cues.length).toBeGreaterThan(5);
    cues.forEach((c, i) => {
      expect(c.n).toBe(i + 1);
      expect(ms(c.to)).toBeGreaterThan(ms(c.from));
      if (i > 0) expect(ms(c.from)).toBeGreaterThanOrEqual(ms(cues[i - 1]!.to));
    });
    expect(srt.replace(/\r\n/g, "")).not.toMatch(/\n/);
  });

  it("lines are ≤ 42 chars, at most 2 per cue", () => {
    for (const c of cues) {
      expect(c.lines.length).toBeGreaterThanOrEqual(1);
      expect(c.lines.length).toBeLessThanOrEqual(2);
      for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(42);
    }
  });

  it("every spoken word appears exactly once; keyword (burned) groups are never written", () => {
    const spoken = t.captions.filter((g) => g.variant === "srt").flatMap((g) => g.words.map((w) => w.text));
    const written = cues.flatMap((c) => c.lines.join(" ").split(" "));
    expect(written).toEqual(spoken);
    const kw = t.captions.filter((g) => g.variant === "keywords");
    expect(kw.length).toBeGreaterThan(0);
    expect(srtGroups(t).some((g) => g.variant === "keywords")).toBe(false);
  });

  it("an empty caption list gives an empty file", () => {
    expect(writeSrt({ ...t, captions: [] } as Timeline)).toBe("");
  });
});

describe("clip / translation groups", () => {
  const t = makeTimeline({ seconds: 20 });
  const seg = "CH9-S01";
  const g = (id: string, variant: CaptionGroup["variant"], from: number, words: string[]): CaptionGroup => ({
    id, start: { ref: "program", edge: "start", offset: from }, end: { ref: "program", edge: "start", offset: from + 30 }, from, dur: 30, segmentId: seg, variant, burn: true,
    words: words.map((w, i) => ({ wordId: `${variant === "clip" ? "clip" : "tr"}:${seg}:${variant === "clip" ? i : `0:${i}`}`, text: w, from: from + i * 5, dur: 5, tone: "normal", hero: false })),
  });
  it("translation pages replace the original-language clip words of the same segment", () => {
    const tt = { ...t, captions: [g("cap:clip:0", "clip", 500, ["Je", "ne", "regrette", "rien"]), g("capt:x:0", "translation", 500, ["I", "regret", "nothing"])] } as Timeline;
    const out = writeSrt(tt);
    expect(out).toContain("I regret nothing");
    expect(out).not.toContain("regrette");
  });
  it("clip groups are written when there is no translation", () => {
    const tt = { ...t, captions: [g("cap:clip:0", "clip", 500, ["We", "never", "sold", "anything."])] } as Timeline;
    expect(writeSrt(tt)).toContain("We never sold anything.");
  });
});

describe("text helpers", () => {
  it("wrapLines balances two lines and refuses what cannot fit", () => {
    expect(wrapLines("short")).toEqual(["short"]);
    const two = wrapLines("Merchants traded bulbs they had never seen, on paper, in smoky taverns")!;
    expect(two).toHaveLength(2);
    for (const l of two) expect(l.length).toBeLessThanOrEqual(42);
    expect(wrapLines("x".repeat(90))).toBeNull();
  });
  it("joinWords removes spaces before punctuation but keeps French guillemets", () => {
    expect(joinWords(["Hello", ",", "world", "!"])).toBe("Hello, world!");
    expect(joinWords(["«", "Bonjour", "»"])).toBe("« Bonjour »");
  });
  it("joinWords keeps the no-break spaces of French typography inside a word", () => {
    expect(joinWords(["puis", "plus", "rien", "du", "tout\u202F?"])).toBe("puis plus rien du tout\u202F?");
    expect(joinWords(["«\u202FBonjour\u202F»", "dit-il\u00A0:", "oui."])).toBe("«\u202FBonjour\u202F» dit-il\u00A0: oui.");
    expect(joinWords(["tout", "\u202F?"])).toBe("tout\u202F?");
  });
  it("sentenceCase only rewrites all-caps text", () => {
    expect(sentenceCase("THE FALL OF FTX. IT WAS FAST")).toBe("The fall of ftx. It was fast");
    expect(sentenceCase("The FTX collapse")).toBe("The FTX collapse");
    expect(sentenceCase("OK")).toBe("OK");
  });
});
