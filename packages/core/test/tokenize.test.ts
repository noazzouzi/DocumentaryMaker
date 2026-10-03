import { describe, expect, it } from "vitest";
import { beatWordRanges, chapterCardReadMs, chapterOfBeat, chapterOfSegment, isDocmakerError, isFunctionWord, normWord, parseWordId, spokenText, tokenizeDisplay, wordId } from "../src/index";

const texts = (s: string) => tokenizeDisplay(s).map((w) => w.text);
const norms = (s: string) => tokenizeDisplay(s).map((w) => w.norm);

describe("tokenizeDisplay (TOKENIZER_VERSION 1)", () => {
  it("merges French guillemets into the neighbouring words (U+00A0 and U+202F are whitespace)", () => {
    expect(texts("« Bonjour », dit-il.")).toEqual(["« Bonjour »,", "dit-il."]);
    expect(norms("« Bonjour », dit-il.")).toEqual(["bonjour", "dit-il"]);
    expect(texts("Il a dit « non ».")).toEqual(["Il", "a", "dit", "« non »."]);
    expect(texts("« Oui » !")).toEqual(["« Oui » !"]);
  });
  it("normalises apostrophes, accents and case", () => {
    expect(norms("l’Écluse")).toEqual(["l'ecluse"]);
    expect(norms("L'ÉCLUSE")).toEqual(["l'ecluse"]);
    expect(normWord("‘Œuvre’")).toBe("œuvre");
    expect(normWord("Ça")).toBe("ca");
  });
  it("splits numbers with narrow no-break spaces into separate words", () => {
    expect(norms("1 637 florins")).toEqual(["1", "637", "florins"]);
    expect(norms("5,500 guilders, 3.5% and 12€")).toEqual(["5,500", "guilders", "3.5%", "and", "12€"]);
  });
  it("attaches dashes and ellipses to the previous word, openers to the next", () => {
    expect(texts("Then — nothing …")).toEqual(["Then —", "nothing …"]);
    expect(texts("( see ) it")).toEqual(["( see )", "it"]);
    expect(texts("— Start")).toEqual(["— Start"]);
  });
  it("keeps character offsets and indexes", () => {
    const s = "« Bonjour », dit-il.";
    for (const w of tokenizeDisplay(s)) expect(s.slice(w.start, w.end)).toBe(w.text);
    expect(tokenizeDisplay(s).map((w) => w.idx)).toEqual([0, 1]);
    expect(tokenizeDisplay("")).toEqual([]);
    expect(tokenizeDisplay(" — … ")).toEqual([]);
  });
});

describe("ids and spoken text", () => {
  it("word ids round-trip", () => {
    expect(wordId("CH3-S07", 12)).toBe("CH3-S07:12");
    expect(parseWordId("CH3-S07:12")).toEqual({ segmentId: "CH3-S07", idx: 12 });
    expect(() => parseWordId("CH3:12")).toThrow();
    expect(chapterOfSegment("CH12-S101")).toBe("CH12");
    expect(chapterOfBeat("CH3-S07-CLIP")).toBe("CH3");
    expect(chapterOfBeat("CH3-B014")).toBe("CH3");
  });
  it("spokenText per mode", () => {
    const seg = { type: "clip" as const, displayText: "It is a fever.", subtitleTranslation: "C’est une fièvre." };
    expect(spokenText(seg, "vo")).toBe("It is a fever.");
    expect(spokenText(seg, "clip-narrated")).toBe("C’est une fièvre.");
    expect(spokenText({ ...seg, subtitleTranslation: "" }, "clip-narrated")).toBe("It is a fever.");
    expect(spokenText(seg, "none")).toBe("");
  });
});

describe("beatWordRanges", () => {
  const seg = "In 1637, a bulb sold for 5,500 guilders. « Madness », said one pamphlet. It collapsed.";
  it("maps exact slices to display-word ranges", () => {
    const r = beatWordRanges(seg, ["In 1637, a bulb sold for 5,500 guilders.", "« Madness », said one pamphlet.", "It collapsed."]);
    expect(r).toEqual([{ wordStart: 0, wordEnd: 8 }, { wordStart: 8, wordEnd: 12 }, { wordStart: 12, wordEnd: 14 }]);
  });
  it("throws VALIDATION when slices do not reconstruct the segment", () => {
    for (const bad of [["In 1637, a bulb sold for 5,500 guilders."], ["In 1637, a bulb", "sold for 5,500 guilders!", "« Madness », said one pamphlet. It collapsed."], ["", seg]]) {
      try {
        beatWordRanges(seg, bad);
        expect.unreachable();
      } catch (e) {
        expect(isDocmakerError(e) && e.code === "VALIDATION").toBe(true);
      }
    }
  });
});

describe("chapterCardReadMs", () => {
  it("follows 1000·(enter/30 + max(1.2, chars/20 + 0.8)) − 200", () => {
    expect(chapterCardReadMs("The Bulb", 12)).toBe(Math.round(1000 * (12 / 30 + 1.2)) - 200); // short title → 1.2 s floor
    const long = "The Day the Buyers Stopped Showing Up";
    expect(chapterCardReadMs(long, 12)).toBe(Math.round(1000 * (0.4 + long.length / 20 + 0.8)) - 200);
    expect(chapterCardReadMs("Écluse", 0)).toBe(1000);
  });
});

describe("isFunctionWord", () => {
  it("articles, prepositions and pronouns in either case and with punctuation; content words are not", () => {
    expect(isFunctionWord("THE", "en")).toBe(true);
    expect(isFunctionWord("of,", "en")).toBe(true);
    expect(isFunctionWord("TWIST", "en")).toBe(false);
    expect(isFunctionWord("l'", "fr")).toBe(true);
    expect(isFunctionWord("Les", "fr")).toBe(true);
    expect(isFunctionWord("chute", "fr")).toBe(false);
    expect(isFunctionWord("le")).toBe(true); // either language when none is given
    expect(isFunctionWord("—")).toBe(true); // punctuation only
  });
});
