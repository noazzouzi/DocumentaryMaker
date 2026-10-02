// French number words (traditional orthography: hyphens below 100, "et" for 21…71, agreement of vingt/cent).

const UNITS = [
  "zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix",
  "onze", "douze", "treize", "quatorze", "quinze", "seize",
] as const;
const TENS = ["", "dix", "vingt", "trente", "quarante", "cinquante", "soixante"] as const;
/** [singular, plural] per 1000^k scale (k ≥ 2 are nouns and take an "s"). */
const SCALES: readonly (readonly [string, string])[] = [
  ["", ""], ["mille", "mille"], ["million", "millions"], ["milliard", "milliards"], ["billion", "billions"],
  ["billiard", "billiards"], ["trillion", "trillions"],
];

/** `invariant`: "quatre-vingt"/"cent" lose their plural "s" (before "mille"). */
export function under100Fr(n: number, invariant = false): string {
  if (n <= 16) return UNITS[n]!;
  if (n < 20) return `dix-${UNITS[n - 10]}`;
  const t = Math.floor(n / 10), u = n % 10;
  if (t <= 6) {
    if (u === 0) return TENS[t]!;
    if (u === 1) return `${TENS[t]} et un`;
    return `${TENS[t]}-${UNITS[u]}`;
  }
  if (t === 7) return u === 1 ? "soixante et onze" : `soixante-${under100Fr(10 + u)}`;
  if (t === 8) return u === 0 ? (invariant ? "quatre-vingt" : "quatre-vingts") : `quatre-vingt-${UNITS[u]}`;
  return `quatre-vingt-${under100Fr(10 + u)}`;
}

export function under1000Fr(n: number, invariant = false): string {
  const h = Math.floor(n / 100), r = n % 100;
  let head = "";
  if (h === 1) head = "cent";
  else if (h > 1) head = `${UNITS[h]} cent${r === 0 && !invariant ? "s" : ""}`;
  if (r === 0) return head || "zéro";
  const rest = under100Fr(r, invariant);
  return head ? `${head} ${rest}` : rest;
}

/** Words for each 3-digit group (most significant first; "" for a zero group). */
export function cardinalGroupsFr(groups: number[]): string[] {
  const n = groups.length;
  if (n > SCALES.length) throw new RangeError("nombre trop grand");
  if (groups.every((g) => g === 0)) return ["zéro", ...groups.slice(1).map(() => "")];
  return groups.map((g, i) => {
    if (g === 0) return "";
    const k = n - 1 - i;
    if (k === 0) return under1000Fr(g);
    if (k === 1) return g === 1 ? "mille" : `${under1000Fr(g, true)} mille`;
    const [sg, pl] = SCALES[k]!;
    return `${under1000Fr(g)} ${g > 1 ? pl : sg}`;
  });
}

/** "vingt et un" → "vingt et unième", "quatre-vingts" → "quatre-vingtième", "cinq" → "cinquième". */
export function ordinalizeFr(cardinal: string): string {
  const m = /^(.*?)([a-zàâäéèêëîïôöùûüç]+)$/.exec(cardinal);
  if (!m) return cardinal;
  const head = m[1]!;
  let last = m[2]!;
  if (last === "cinq") return `${head}cinquième`;
  if (last === "neuf") return `${head}neuvième`;
  if (/^(vingts|cents|millions|milliards|billions)$/.test(last)) last = last.slice(0, -1);
  return head + (last.endsWith("e") ? `${last.slice(0, -1)}ième` : `${last}ième`);
}

export function digitsFr(digits: string): string {
  return [...digits].map((d) => UNITS[Number(d)]!).join(" ");
}

export const FR_WORDS = { minus: "moins", point: "virgule", percent: "pour cent", to: "à", and: "et" } as const;
