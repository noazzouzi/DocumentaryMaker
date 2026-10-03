// Number extraction and matching for fact-check rule (b): "1.2M", "1,2 million", « 1 200 000 », "5,500", "50 %".

export interface FoundNumber {
  raw: string; value: number; /** half of the displayed precision (rounding tolerance) */ tol: number; index: number;
  /** "ten times", "plus de 10 fois": a ratio claim; `bound` = "min" for "more than / over / plus de", "max" for "less than / moins de". */
  multiple?: { bound: "min" | "max" | null };
}

const MIN_BOUND = /(?:more than|over|at least|upwards of|plus de|au moins)\s+$/iu;
const MAX_BOUND = /(?:less than|fewer than|under|at most|moins de|au plus)\s+$/iu;
/** Ratio info when the number at [start, end) is followed by times/fois (or an "x" multiplier). */
function multipleAt(text: string, start: number, end: number): FoundNumber["multiple"] {
  if (!/^(?:\s+(?:times|fois)(?![\p{L}])|x(?![\p{L}\p{N}]))/iu.test(text.slice(end))) return undefined;
  const before = text.slice(Math.max(0, start - 24), start);
  return { bound: MIN_BOUND.test(before) ? "min" : MAX_BOUND.test(before) ? "max" : null };
}

/** True when a ratio claim ("ten times", "plus de 10 fois") agrees with the ratio of two cited figure values. */
export function ratioSupported(n: FoundNumber, figureValues: readonly number[]): boolean {
  if (!n.multiple) return false;
  const vals = figureValues.filter((v) => Number.isFinite(v) && v > 0);
  for (const a of vals) for (const b of vals) {
    if (a <= b) continue;
    const r = a / b;
    if (n.multiple.bound === "min" ? r >= n.value : n.multiple.bound === "max" ? r <= n.value : Math.abs(r - n.value) <= Math.max(0.5, 0.05 * n.value)) return true;
  }
  return false;
}

const MULT: Record<string, number> = {
  k: 1e3, thousand: 1e3, thousands: 1e3, mille: 1e3, millier: 1e3, milliers: 1e3,
  m: 1e6, million: 1e6, millions: 1e6, mn: 1e6,
  bn: 1e9, b: 1e9, billion: 1e9, billions: 1e9, milliard: 1e9, milliards: 1e9,
};
const NUM = /(?<![\p{L}\p{N}])(\d{1,3}(?:[   .,'’]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?:[   ]?(%|k|K|M|bn|Bn|B|mn)|\s+(thousands?|millions?|billions?|milliers?|mille|milliards?))?(?![\p{L}\p{N}])/gu;

/** Parses one numeric token (without multiplier), resolving EN/FR separators. Returns value and decimal places. */
export function parseNumberToken(tok: string): { value: number; decimals: number } {
  let t = tok.replace(/[   '’]/g, "");
  const lastDot = t.lastIndexOf(".");
  const lastComma = t.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const thou = dec === "." ? "," : ".";
    t = t.split(thou).join("").replace(dec, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const groups = t.split(sep);
    const thousands = groups.length > 1 && groups.slice(1).every((g) => g.length === 3) && groups[0]!.length <= 3 && groups[0] !== "0";
    t = thousands ? groups.join("") : groups.join(".");
  }
  const decimals = t.includes(".") ? t.length - t.indexOf(".") - 1 : 0;
  return { value: Number(t), decimals };
}

// ---------------------------------------------------------------- spelled-out figures (EN/FR)
const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13,
  quatorze: 14, quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
}; // "six" is shared by EN and FR
const HUNDRED = new Set(["hundred", "cent", "cents"]);
const SCALES: Record<string, number> = {
  thousand: 1e3, mille: 1e3, million: 1e6, millions: 1e6, billion: 1e9, billions: 1e9, milliard: 1e9, milliards: 1e9,
};
const ARTICLES = new Set(["a", "an"]);
const CONNECTORS = new Set(["and", "et"]);
const TIMES = new Set(["times", "fois"]);
const isNumWord = (w: string) => w in UNITS || HUNDRED.has(w) || w in SCALES;

/**
 * Spelled-out figures: a run of number words that contains a scale word ("two hundred million", "deux millions",
 * "a thousand") or that is followed by times/fois ("ten times"). Small counts ("two brothers", "un homme") are not
 * figures and are ignored; so are bare plurals ("thousands of", "des milliers").
 */
export function extractWordNumbers(text: string): FoundNumber[] {
  const toks = [...text.matchAll(/\p{L}+/gu)].map((m) => ({ w: m[0].toLowerCase(), start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
  const joined = (a: number, b: number) => /^[\s\u00a0\u202f-]+$/u.test(text.slice(toks[a]!.end, toks[b]!.start));
  const out: FoundNumber[] = [];
  for (let i = 0; i < toks.length; i++) {
    const first = toks[i]!.w;
    const nextScale = !!toks[i + 1] && (HUNDRED.has(toks[i + 1]!.w) || toks[i + 1]!.w in SCALES) && joined(i, i + 1);
    if (!(first in UNITS) && !(ARTICLES.has(first) && nextScale)) continue;
    let j = i;
    while (j + 1 < toks.length && joined(j, j + 1)) {
      const nx = toks[j + 1]!.w;
      if (isNumWord(nx)) j++;
      else if (CONNECTORS.has(nx) && j + 2 < toks.length && joined(j + 1, j + 2) && toks[j + 2]!.w in UNITS) j += 2;
      else break;
    }
    let total = 0;
    let current = 0;
    let scaled = false;
    for (let k = i; k <= j; k++) {
      const w = toks[k]!.w;
      if (CONNECTORS.has(w)) continue;
      if (k === i && !(w in UNITS)) { current = 1; continue; } // "a"/"an" before a scale word
      if (w === "quatre" && k < j && (toks[k + 1]!.w === "vingt" || toks[k + 1]!.w === "vingts")) { current += 80; k++; continue; }
      if (w in UNITS) current += UNITS[w]!;
      else if (HUNDRED.has(w)) { current = (current || 1) * 100; scaled = true; }
      else if (w in SCALES) { total += (current || 1) * SCALES[w]!; current = 0; scaled = true; }
    }
    const value = total + current;
    const next = toks[j + 1];
    const times = !!next && TIMES.has(next.w) && joined(j, j + 1);
    if (value >= 2 && (scaled || times)) {
      // precision = the place value of the last word: "two hundred million" ± 0.5 M, "two hundred and fifty" ± 0.5
      const lastW = toks[j]!.w;
      const place = HUNDRED.has(lastW) ? 100 : SCALES[lastW] ?? 1;
      const multiple = times ? multipleAt(text, toks[i]!.start, toks[j]!.end) : undefined;
      out.push({ raw: text.slice(toks[i]!.start, toks[j]!.end), value, tol: place / 2, index: toks[i]!.start, ...(multiple ? { multiple } : {}) });
    }
    i = j;
  }
  return out;
}

/** Digits (with separators and multipliers) and spelled-out figures, in text order. */
export function extractNumbers(text: string): FoundNumber[] {
  return [...extractDigitNumbers(text), ...extractWordNumbers(text)].sort((a, b) => a.index - b.index);
}

function extractDigitNumbers(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  for (const m of text.matchAll(NUM)) {
    const { value, decimals } = parseNumberToken(m[1]!);
    if (!Number.isFinite(value)) continue;
    const suffix = (m[2] ?? m[3] ?? "").toLowerCase();
    const mult = suffix === "%" ? 1 : MULT[suffix] ?? 1;
    const unit = Math.pow(10, -decimals) * mult;
    const index = m.index ?? 0;
    const multiple = suffix === "" ? multipleAt(text, index, index + m[0].length) : undefined;
    out.push({ raw: m[0], value: value * mult, tol: mult > 1 ? unit / 2 : 1e-9 * Math.max(1, Math.abs(value)), index, ...(multiple ? { multiple } : {}) });
  }
  return out;
}

/** Every number mentioned in fact-sheet strings (dates "1637-02-03" → 1637, 2, 3). */
export function numbersIn(strings: readonly string[]): number[] {
  const out: number[] = [];
  for (const s of strings) {
    for (const d of s.matchAll(/\d+/g)) out.push(Number(d[0]));
    for (const n of extractNumbers(s)) out.push(n.value);
  }
  return out;
}

export function matchesAny(n: FoundNumber, allowed: readonly number[]): boolean {
  return allowed.some((a) => Math.abs(a - n.value) <= Math.max(n.tol, 1e-9 * Math.max(1, Math.abs(a))));
}
