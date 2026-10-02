// Language dispatch for number words. Internals work on digit strings so grouped numbers ("1 200 000")
// can be split back onto their display tokens.
import type { Lang } from "@docmaker/core";
import { DocmakerError } from "@docmaker/core";
import { EN_WORDS, cardinalGroupsEn, digitsEn, ordinalizeEn, pluralizeLastEn, yearEn } from "./numbers-en";
import { FR_WORDS, cardinalGroupsFr, digitsFr, ordinalizeFr } from "./numbers-fr";

export type NumberKind = "cardinal" | "year" | "ordinal" | "decimal";

export const LANG_WORDS = { en: EN_WORDS, fr: FR_WORDS } as const;

/** "1200000" → [1, 200, 0] (leading zeros ignored). */
export function digitGroups(intDigits: string): number[] {
  const d = intDigits.replace(/^0+(?=\d)/, "");
  const out: number[] = [];
  for (let end = d.length; end > 0; end -= 3) out.unshift(Number(d.slice(Math.max(0, end - 3), end)));
  return out.length ? out : [0];
}

/** Group words aligned with the given group sizes (most significant first). */
export function cardinalGroupWords(groups: number[], lang: Lang): string[] {
  return lang === "fr" ? cardinalGroupsFr(groups) : cardinalGroupsEn(groups);
}

export function cardinalFromDigits(intDigits: string, lang: Lang): string {
  return cardinalGroupWords(digitGroups(intDigits), lang).filter((s) => s !== "").join(" ");
}

export function digitWords(digits: string, lang: Lang): string {
  return lang === "fr" ? digitsFr(digits) : digitsEn(digits);
}

/** Fraction part: EN digit by digit; FR as a number unless it has a leading zero or more than 3 digits. */
export function fractionWords(frac: string, lang: Lang): string {
  if (lang === "fr" && !frac.startsWith("0") && frac.length <= 3) return cardinalFromDigits(frac, lang);
  return digitWords(frac, lang);
}

export function decimalFromDigits(intDigits: string, frac: string | null, lang: Lang): string {
  const head = cardinalFromDigits(intDigits, lang);
  if (frac === null || frac === "") return head;
  return `${head} ${LANG_WORDS[lang].point} ${fractionWords(frac, lang)}`;
}

export function yearWords(n: number, lang: Lang): string {
  if (lang === "en") {
    const y = yearEn(n);
    if (y !== null) return y;
  }
  return cardinalFromDigits(String(n), lang);
}

/** EN decades: 1630 → "sixteen thirties"; 1900 → "nineteen hundreds". */
export function decadeWords(n: number, lang: Lang): string {
  return lang === "en" ? pluralizeLastEn(yearWords(n, "en")) : `années ${yearWords(n, "fr")}`;
}

export function ordinalWords(n: number, lang: Lang, o?: { feminine?: boolean; second?: boolean }): string {
  if (lang === "fr") {
    if (n === 1) return o?.feminine ? "première" : "premier";
    if (n === 2 && o?.second) return o.feminine ? "seconde" : "second";
    return ordinalizeFr(cardinalFromDigits(String(n), "fr"));
  }
  return ordinalizeEn(cardinalFromDigits(String(n), "en"));
}

function plainDigits(n: number): string {
  return n.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 12 });
}

export function numberToWords(n: number, lang: Lang, kind: NumberKind): string {
  if (!Number.isFinite(n)) throw new DocmakerError("VALIDATION", `numberToWords: not a finite number (${n})`);
  if (n < 0) return `${LANG_WORDS[lang].minus} ${numberToWords(-n, lang, kind)}`;
  const s = plainDigits(n);
  const [int, frac] = s.split(".") as [string, string | undefined];
  if (frac !== undefined || kind === "decimal") return decimalFromDigits(int, frac ?? null, lang);
  if (kind === "year") return yearWords(n, lang);
  if (kind === "ordinal" && n > 0) return ordinalWords(n, lang);
  return cardinalFromDigits(int, lang);
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
/** Strict Roman numeral parser (canonical forms only); null when invalid. */
export function romanToInt(s: string): number | null {
  if (!/^[IVXLCDM]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]!]!, next = ROMAN[s[i + 1] ?? ""] ?? 0;
    total += v < next ? -v : v;
  }
  return intToRoman(total) === s ? total : null;
}
function intToRoman(n: number): string {
  const table: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let out = "";
  for (const [v, r] of table) while (n >= v) { out += r; n -= v; }
  return out;
}
