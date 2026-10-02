import { describe, expect, it } from "vitest";
import { numberToWords } from "../src/index";
import { romanToInt } from "../src/text/numbers";

describe("numberToWords — English goldens", () => {
  const cases: [number, "cardinal" | "year" | "ordinal" | "decimal", string][] = [
    [0, "cardinal", "zero"],
    [7, "cardinal", "seven"],
    [13, "cardinal", "thirteen"],
    [21, "cardinal", "twenty-one"],
    [100, "cardinal", "one hundred"],
    [101, "cardinal", "one hundred one"],
    [999, "cardinal", "nine hundred ninety-nine"],
    [1000, "cardinal", "one thousand"],
    [5500, "cardinal", "five thousand five hundred"],
    [1_200_000, "cardinal", "one million two hundred thousand"],
    [3_000_000_000, "cardinal", "three billion"],
    [-4, "cardinal", "minus four"],
    [1637, "year", "sixteen thirty-seven"],
    [1900, "year", "nineteen hundred"],
    [1905, "year", "nineteen oh five"],
    [2000, "year", "two thousand"],
    [2005, "year", "two thousand five"],
    [2016, "year", "twenty sixteen"],
    [1066, "year", "ten sixty-six"],
    [1001, "year", "one thousand one"],
    [800, "year", "eight hundred"],
    [1, "ordinal", "first"],
    [2, "ordinal", "second"],
    [3, "ordinal", "third"],
    [5, "ordinal", "fifth"],
    [8, "ordinal", "eighth"],
    [9, "ordinal", "ninth"],
    [12, "ordinal", "twelfth"],
    [20, "ordinal", "twentieth"],
    [21, "ordinal", "twenty-first"],
    [100, "ordinal", "one hundredth"],
    [12.5, "decimal", "twelve point five"],
    [3.14, "decimal", "three point one four"],
    [0.05, "decimal", "zero point zero five"],
    [7, "decimal", "seven"],
    [2.5, "cardinal", "two point five"],
  ];
  it.each(cases)("%s (%s) → %s", (n, kind, want) => {
    expect(numberToWords(n, "en", kind)).toBe(want);
  });
});

describe("numberToWords — French goldens", () => {
  const cases: [number, "cardinal" | "year" | "ordinal" | "decimal", string][] = [
    [0, "cardinal", "zéro"],
    [1, "cardinal", "un"],
    [16, "cardinal", "seize"],
    [17, "cardinal", "dix-sept"],
    [21, "cardinal", "vingt et un"],
    [22, "cardinal", "vingt-deux"],
    [61, "cardinal", "soixante et un"],
    [70, "cardinal", "soixante-dix"],
    [71, "cardinal", "soixante et onze"],
    [77, "cardinal", "soixante-dix-sept"],
    [80, "cardinal", "quatre-vingts"],
    [81, "cardinal", "quatre-vingt-un"],
    [90, "cardinal", "quatre-vingt-dix"],
    [91, "cardinal", "quatre-vingt-onze"],
    [99, "cardinal", "quatre-vingt-dix-neuf"],
    [100, "cardinal", "cent"],
    [101, "cardinal", "cent un"],
    [200, "cardinal", "deux cents"],
    [201, "cardinal", "deux cent un"],
    [280, "cardinal", "deux cent quatre-vingts"],
    [1000, "cardinal", "mille"],
    [1001, "cardinal", "mille un"],
    [2000, "cardinal", "deux mille"],
    [5500, "cardinal", "cinq mille cinq cents"],
    [80_000, "cardinal", "quatre-vingt mille"],
    [200_000, "cardinal", "deux cent mille"],
    [1_000_000, "cardinal", "un million"],
    [2_000_000, "cardinal", "deux millions"],
    [80_000_000, "cardinal", "quatre-vingts millions"],
    [200_000_000, "cardinal", "deux cents millions"],
    [1_000_000_000, "cardinal", "un milliard"],
    [-3, "cardinal", "moins trois"],
    [1637, "year", "mille six cent trente-sept"],
    [2016, "year", "deux mille seize"],
    [1, "ordinal", "premier"],
    [2, "ordinal", "deuxième"],
    [5, "ordinal", "cinquième"],
    [9, "ordinal", "neuvième"],
    [17, "ordinal", "dix-septième"],
    [21, "ordinal", "vingt et unième"],
    [80, "ordinal", "quatre-vingtième"],
    [200, "ordinal", "deux centième"],
    [1000, "ordinal", "millième"],
    [12.5, "decimal", "douze virgule cinq"],
    [3.05, "decimal", "trois virgule zéro cinq"],
    [3.14, "decimal", "trois virgule quatorze"],
  ];
  it.each(cases)("%s (%s) → %s", (n, kind, want) => {
    expect(numberToWords(n, "fr", kind)).toBe(want);
  });
});

describe("numberToWords — guards", () => {
  it("rejects non-finite numbers", () => {
    expect(() => numberToWords(Number.NaN, "en", "cardinal")).toThrow(/finite/);
    expect(() => numberToWords(Infinity, "fr", "cardinal")).toThrow(/finite/);
  });
  it("parses canonical Roman numerals only", () => {
    expect(romanToInt("XVII")).toBe(17);
    expect(romanToInt("XIV")).toBe(14);
    expect(romanToInt("MCMXCIV")).toBe(1994);
    expect(romanToInt("IIII")).toBeNull();
    expect(romanToInt("Le")).toBeNull();
  });
});
