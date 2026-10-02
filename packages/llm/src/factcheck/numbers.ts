// Number extraction and matching for fact-check rule (b): "1.2M", "1,2 million", « 1 200 000 », "5,500", "50 %".

export interface FoundNumber { raw: string; value: number; /** half of the displayed precision (rounding tolerance) */ tol: number; index: number }

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

export function extractNumbers(text: string): FoundNumber[] {
  const out: FoundNumber[] = [];
  for (const m of text.matchAll(NUM)) {
    const { value, decimals } = parseNumberToken(m[1]!);
    if (!Number.isFinite(value)) continue;
    const suffix = (m[2] ?? m[3] ?? "").toLowerCase();
    const mult = suffix === "%" ? 1 : MULT[suffix] ?? 1;
    const unit = Math.pow(10, -decimals) * mult;
    out.push({ raw: m[0], value: value * mult, tol: mult > 1 ? unit / 2 : 1e-9 * Math.max(1, Math.abs(value)), index: m.index ?? 0 });
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
