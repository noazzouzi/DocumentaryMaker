import { describe, expect, it } from "vitest";
import { tokenizeDisplay } from "@docmaker/core";
import { buildTtsText, type TtsTextResult } from "../src/index";

const NUM = { lexicon: [], expandNumbers: true, stripTags: true };
const RAW = { lexicon: [], expandNumbers: false, stripTags: false };

/** Every display word has a span; spans are contiguous, ordered and cover all tts words. */
function checkSpans(spoken: string, r: TtsTextResult) {
  const display = tokenizeDisplay(spoken);
  expect(r.displayToTts).toHaveLength(display.length);
  let cursor = 0;
  for (const [a, b] of r.displayToTts) {
    expect(a).toBe(cursor);
    expect(b).toBeGreaterThanOrEqual(a);
    cursor = b;
  }
  expect(cursor).toBe(r.ttsWords.length);
  expect(r.ttsText).toBe(r.ttsWords.join(" "));
}
const spanText = (r: TtsTextResult, k: number) => r.ttsWords.slice(...r.displayToTts[k]!).join(" ");

describe("buildTtsText — passthrough", () => {
  it("keeps text untouched without options (FR punctuation, NBSP)", () => {
    const s = "Un pamphlet parlait d’une « fièvre de l’esprit ». Vraiment ?";
    const r = buildTtsText(s, "fr", RAW);
    checkSpans(s, r);
    expect(r.ttsText).toBe("Un pamphlet parlait d’une « fièvre de l’esprit ». Vraiment ?");
    expect(spanText(r, 4)).toBe("« fièvre");
  });
  it("leaves digits alone when expandNumbers is false (sherpa: espeak normalises)", () => {
    const r = buildTtsText("En 1637, 5 500 florins.", "fr", RAW);
    expect(r.ttsText).toBe("En 1637, 5 500 florins.");
  });
  it("handles empty and punctuation-only input", () => {
    expect(buildTtsText("", "en", NUM)).toEqual({ ttsText: "", ttsWords: [], displayToTts: [] });
    expect(buildTtsText(" « » ", "fr", NUM).ttsWords).toEqual([]);
  });
});

describe("buildTtsText — numbers (FR)", () => {
  it("FR cents, centimes, minus and n°", () => {
    const s = "1,20 € et 0,50 € puis 0,01 €, 2,00 € ; il faisait -5 degrés, −12,5 % ; voir page 2017, le n° 1999 et en 1999.";
    const r = buildTtsText(s, "fr", NUM);
    checkSpans(s, r);
    expect(r.ttsText).toBe(
      "un euro vingt et cinquante centimes puis un centime, deux euros ; il faisait moins cinq degrés, moins douze virgule cinq pour cent ; " +
      "voir page deux mille dix-sept, le numéro mille neuf cent quatre-vingt-dix-neuf et en mille neuf cent quatre-vingt-dix-neuf.",
    );
  });
  it("years after « en », grouped thousands split over their display words, florins", () => {
    const s = "En 1637, un seul bulbe de tulipe s’est vendu 5 500 florins à Haarlem.";
    const r = buildTtsText(s, "fr", NUM);
    checkSpans(s, r);
    expect(r.ttsText).toBe("En mille six cent trente-sept, un seul bulbe de tulipe s’est vendu cinq mille cinq cents florins à Haarlem.");
    expect(spanText(r, 1)).toBe("mille six cent trente-sept,");
    expect(spanText(r, 9)).toBe("cinq mille");
    expect(spanText(r, 10)).toBe("cinq cents");
  });
  it("ƒ and € symbols, cents, percent, ordinals, Roman centuries and regnal numbers", () => {
    const s = "Le XVIIe siècle, Louis XIV, le 1er mai, la 1re fois, 12,5 % des parts, 1 200 000 €, 3,05 ƒ et 50% de 2 €.";
    const r = buildTtsText(s, "fr", NUM);
    checkSpans(s, r);
    expect(r.ttsText).toBe(
      "Le dix-septième siècle, Louis quatorze, le premier mai, la première fois, douze virgule cinq pour cent des parts, " +
      "un million deux cent mille euros, trois florins cinq et cinquante pour cent de deux euros.",
    );
    // "1 200 000 €" → the last group is silent, the € token carries the currency word
    const d = tokenizeDisplay(s).map((w) => w.text);
    expect(spanText(r, d.indexOf("000"))).toBe("");
    expect(spanText(r, d.indexOf("€,"))).toBe("euros,");
  });
  it("singular below 2 (FR rule) and « Le »/« Ce » are never Roman numerals", () => {
    expect(buildTtsText("Ce bulbe valait 1,5 ƒ.", "fr", NUM).ttsText).toBe("Ce bulbe valait un virgule cinq florin.");
    expect(buildTtsText("Le Xe siècle.", "fr", NUM).ttsText).toBe("Le dixième siècle.");
  });
  it("round millions take « de/d' » before the currency; a currency after a written scale word is read", () => {
    const s = "Il a perdu 3 000 000 €, puis 5 millions €, 2 000 000 $ et 1 500 000 € ; 4,5 milliards € !";
    const r = buildTtsText(s, "fr", NUM);
    checkSpans(s, r);
    expect(r.ttsText).toBe(
      "Il a perdu trois millions d'euros, puis cinq millions d'euros, deux millions de dollars et un million cinq cent mille euros ; " +
      "quatre virgule cinq milliards d'euros !",
    );
    const d = tokenizeDisplay(s).map((w) => w.text);
    expect(spanText(r, d.indexOf("millions"))).toBe("millions");
    expect(spanText(r, d.indexOf("€,", d.indexOf("millions")))).toBe("d'euros,");
    expect(buildTtsText("He lost 5 million $.", "en", NUM).ttsText).toBe("He lost five million dollars.");
  });
  it("NBSP / narrow NBSP thousands separators", () => {
    const s = "Il y a 2 000 ans, 1 637 bulbes.";
    const r = buildTtsText(s, "fr", NUM);
    checkSpans(s, r);
    expect(r.ttsText).toBe("Il y a deux mille ans, mille six cent trente-sept bulbes.");
  });
});

describe("buildTtsText — numbers (EN)", () => {
  it("years, guilders, scale words after a currency prefix, decimals, percent, ranges, decades, ordinals", () => {
    const s = "In 1637, a bulb sold for 5,500 guilders — about $1.5 million, 12.5% more than £3.50 and ƒ1,200. The 1630s, 1914-1918, the 21st and 2nd.";
    const r = buildTtsText(s, "en", NUM);
    checkSpans(s, r);
    expect(r.ttsText).toBe(
      "In sixteen thirty-seven, a bulb sold for five thousand five hundred guilders — about one point five million dollars, " +
      "twelve point five percent more than three pounds fifty and one thousand two hundred guilders. The sixteen thirties, " +
      "nineteen fourteen to nineteen eighteen, the twenty-first and second.",
    );
    const d = tokenizeDisplay(s).map((w) => w.text);
    expect(spanText(r, d.indexOf("$1.5"))).toBe("one point five");
    expect(spanText(r, d.indexOf("million,"))).toBe("million dollars,");
  });
  it("a 4-digit number quantifying a noun stays a cardinal; standalone / after context words it is a year", () => {
    expect(buildTtsText("1500 soldiers marched.", "en", NUM).ttsText).toBe("one thousand five hundred soldiers marched.");
    expect(buildTtsText("It ended in 2005.", "en", NUM).ttsText).toBe("It ended in two thousand five.");
    expect(buildTtsText("By 1066 England had changed.", "en", NUM).ttsText).toBe("By ten sixty-six England had changed.");
    expect(buildTtsText("One dollar: $1.", "en", NUM).ttsText).toBe("One dollar: one dollar.");
  });
  it("currency with cents: the plural follows the integer part; below one unit → sub-units; .00 is silent", () => {
    const s = "€1.20 each, $1.05, $2.50, $0.50, $0.01, £0.75 and $5.00.";
    const r = buildTtsText(s, "en", NUM);
    checkSpans(s, r);
    expect(r.ttsText).toBe("one euro twenty each, one dollar five, two dollars fifty, fifty cents, one cent, seventy-five pence and five dollars.");
    expect(buildTtsText("$1.5 and $1.", "en", NUM).ttsText).toBe("one point five dollars and one dollar.");
  });
  it("negative numbers, and 4-digit numbers after page/No./# stay cardinals", () => {
    const s = "It was -5 degrees, (−12.5%) and -$3; see page 2017. No. 1999, #2017 and in 1999.";
    const r = buildTtsText(s, "en", NUM);
    checkSpans(s, r);
    expect(r.ttsText).toBe(
      "It was minus five degrees, (minus twelve point five percent) and minus three dollars; see page two thousand seventeen. " +
      "Number one thousand nine hundred ninety-nine, number two thousand seventeen and in nineteen ninety-nine.",
    );
    expect(buildTtsText("The war of 1914-1918 and pre-1914 maps.", "en", NUM).ttsText).toBe("The war of nineteen fourteen to nineteen eighteen and pre-1914 maps.");
  });
  it("years in pairs, before a noun, at a sentence start and after a dash; plural count nouns stay cardinals", () => {
    const en = (t: string) => buildTtsText(t, "en", NUM).ttsText;
    expect(en("The bubble of 1636 and 1637 was famous.")).toBe("The bubble of sixteen thirty-six and sixteen thirty-seven was famous.");
    expect(en("From 1636 to 1637 prices rose.")).toBe("From sixteen thirty-six to sixteen thirty-seven prices rose.");
    expect(en("After the 1929 crash")).toBe("After the nineteen twenty-nine crash");
    expect(en("The year 1637 was rough. 1637 marked the end.")).toBe("The year sixteen thirty-seven was rough. sixteen thirty-seven marked the end.");
    expect(en("Prices 1636 – 1637 rose.")).toBe("Prices sixteen thirty-six – sixteen thirty-seven rose.");
    expect(en("a 1929 film")).toBe("a nineteen twenty-nine film");
    expect(en("The 1500 soldiers and 2000 people.")).toBe("The one thousand five hundred soldiers and two thousand people.");
    expect(en("See page 1637 and 1638 pages.")).toBe("See page one thousand six hundred thirty-seven and one thousand six hundred thirty-eight pages.");
  });
  it("Roman numerals: regnal ordinals after rulers' names and titles, cardinals after series words, others untouched", () => {
    const en = (t: string) => buildTtsText(t, "en", NUM).ttsText;
    expect(en("Henry VIII and Elizabeth II.")).toBe("Henry the eighth and Elizabeth the second.");
    expect(en("Pope Leo XIII and Pharaoh Thutmose III; Charles V.")).toBe("Pope Leo the thirteenth and Pharaoh Thutmose the third; Charles the fifth.");
    expect(en("World War II, World War I ended.")).toBe("World War Two, World War One ended.");
    expect(en("Apollo XI landed. Chapter II begins with Part III.")).toBe("Apollo eleven landed. Chapter two begins with Part three.");
    expect(en("After the War I went home. Then I left.")).toBe("After the War I went home. Then I left.");
    expect(en("Windsor XII Gin.")).toBe("Windsor XII Gin.");
    expect(buildTtsText("Louis XIV, le roi Charles X et la Partie II.", "fr", NUM).ttsText).toBe("Louis quatorze, le roi Charles dix et la Partie deux.");
  });
});

describe("buildTtsText — lexicon and tags", () => {
  it("lexicon: whole words, case-insensitive by default, punctuation preserved, multi-word matches", () => {
    const lexicon = [
      { match: "Haarlem", say: "Har-lem", caseSensitive: false },
      { match: "Semper Augustus", say: "Semper Ow goos tus", caseSensitive: false },
      { match: "FTX", say: "F T X", caseSensitive: true },
    ];
    const s = "À haarlem, le « Semper Augustus », et ftx ou FTX.";
    const r = buildTtsText(s, "fr", { lexicon, expandNumbers: true, stripTags: true });
    checkSpans(s, r);
    expect(r.ttsText).toBe("À Har-lem, le « Semper Ow goos tus », et ftx ou F T X.");
    const d = tokenizeDisplay(s).map((w) => w.text);
    expect(spanText(r, d.indexOf("« Semper") >= 0 ? d.indexOf("« Semper") : 3)).toBe("« Semper");
    expect(spanText(r, 4)).toBe("Ow goos tus »,");
  });
  it("lexicon wins over number expansion", () => {
    const r = buildTtsText("Le 747 a décollé.", "fr", { lexicon: [{ match: "747", say: "sept-quatre-sept", caseSensitive: false }], expandNumbers: true, stripTags: true });
    expect(r.ttsText).toBe("Le sept-quatre-sept a décollé.");
  });
  it("strips [tags] only when asked; a stripped word keeps an empty span", () => {
    const s = "[whispers] He lost everything. [sighs heavily] Then nothing.";
    const stripped = buildTtsText(s, "en", NUM);
    checkSpans(s, stripped);
    expect(stripped.ttsText).toBe("He lost everything. Then nothing.");
    expect(stripped.displayToTts[0]).toEqual([0, 0]);
    expect(buildTtsText(s, "en", { ...NUM, stripTags: false }).ttsText).toBe(s);
  });
});
