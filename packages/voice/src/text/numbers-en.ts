// English number words (American usage, no "and"): cardinals by 3-digit group, years, ordinals, decimals.

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
] as const;
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"] as const;
const SCALES = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion"] as const;

export function under100En(n: number): string {
  if (n < 20) return ONES[n]!;
  const t = Math.floor(n / 10), u = n % 10;
  return u === 0 ? TENS[t]! : `${TENS[t]}-${ONES[u]}`;
}

export function under1000En(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  if (h === 0) return under100En(r);
  return r === 0 ? `${ONES[h]} hundred` : `${ONES[h]} hundred ${under100En(r)}`;
}

/** Words for each 3-digit group of an integer digit string, most significant first ("" for a zero group). */
export function cardinalGroupsEn(groups: number[]): string[] {
  const n = groups.length;
  if (n > SCALES.length) throw new RangeError("number too large");
  if (groups.every((g) => g === 0)) return ["zero", ...groups.slice(1).map(() => "")];
  return groups.map((g, i) => {
    if (g === 0) return "";
    const scale = SCALES[n - 1 - i]!;
    return scale ? `${under1000En(g)} ${scale}` : under1000En(g);
  });
}

export function yearEn(n: number): string | null {
  if (n < 1000 || n > 9999) return null;
  const hi = Math.floor(n / 100), lo = n % 100;
  // 1000–1009 and 2000–2009 read as cardinals ("two thousand five")
  if (n % 1000 < 10 && (hi === 10 || hi === 20)) return null;
  if (lo === 0) return `${under100En(hi)} hundred`;
  if (lo < 10) return `${under100En(hi)} oh ${ONES[lo]}`;
  return `${under100En(hi)} ${under100En(lo)}`;
}

const ORD_IRREGULAR: Record<string, string> = {
  zero: "zeroth", one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth",
};

/** "twenty-one" → "twenty-first"; "one hundred" → "one hundredth". */
export function ordinalizeEn(cardinal: string): string {
  const m = /^(.*?)([a-z]+)$/.exec(cardinal);
  if (!m) return cardinal;
  const [, head, last] = m as unknown as [string, string, string];
  const ord = ORD_IRREGULAR[last] ?? (last.endsWith("y") ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return head + ord;
}

/** "twenty" → "twenties", "hundred" → "hundreds" (decades: 1630s). */
export function pluralizeLastEn(words: string): string {
  const m = /^(.*?)([a-z]+)$/.exec(words);
  if (!m) return words;
  const last = m[2]!;
  return m[1]! + (last.endsWith("y") ? `${last.slice(0, -1)}ies` : last.endsWith("x") ? `${last}es` : `${last}s`);
}

export function digitsEn(digits: string): string {
  return [...digits].map((d) => ONES[Number(d)]!).join(" ");
}

export const EN_WORDS = { minus: "minus", point: "point", percent: "percent", to: "to", and: "and" } as const;
