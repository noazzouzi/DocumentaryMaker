// Deterministic beat splitter (fallback when the LLM's beats do not reconstruct a segment, and the primary-language
// re-slice after an edit). Slices are EXACT contiguous substrings of the segment (trimmed), in order.
import { tokenizeDisplay } from "@docmaker/core";
import { splitSentences } from "../lexicon";

const SENTENCE_END = /[.!?…]["»”’)\] ]*$/u;
const CLAUSE_END = /[,;:—–]["»”’)\] ]*$|^[—–]$/u;
/** Cost of cutting after a word that ends a sentence / a clause / nothing (relative to a full-length miss = 1). */
const PENALTY = [0, 0.04, 0.2] as const;

/**
 * Splits `segmentText` into `charShares.length` slices whose lengths follow the shares, cutting preferably at sentence
 * ends, then at `, ; : —`, then between words. Empty `charShares` → one slice per sentence. Never returns more slices
 * than display words; never returns an empty slice.
 */
export function splitBeatsFallback(segmentText: string, charShares: number[]): string[] {
  const text = segmentText;
  const words = tokenizeDisplay(text);
  if (words.length === 0) return text.trim() === "" ? [] : [text.trim()];
  if (charShares.length === 0) {
    const sentences = splitSentences(text);
    return sentences.length > 0 ? sentences : [text.trim()];
  }
  const n = Math.max(1, Math.min(charShares.length, words.length));
  if (n === 1) return [text.trim()];
  const shares = charShares.slice(0, n).map((s) => (Number.isFinite(s) && s > 0 ? s : 0));
  const total = shares.reduce((a, b) => a + b, 0);
  const norm = total > 0 ? shares.map((s) => s / total) : shares.map(() => 1 / n);
  const len = words[words.length - 1]!.end - words[0]!.start;
  const base = words[0]!.start;

  // candidate cuts: before word k (k = 1..W-1)
  const cand = words.slice(1).map((w, k) => {
    const prevText = words[k]!.text;
    const prio = SENTENCE_END.test(prevText) ? 0 : CLAUSE_END.test(prevText) ? 1 : 2;
    return { pos: w.start, rel: (words[k]!.end - base) / Math.max(1, len), prio, word: k + 1 };
  });
  const targets: number[] = [];
  let acc = 0;
  for (let j = 0; j < n - 1; j++) {
    acc += norm[j]!;
    targets.push(acc);
  }
  // DP over (cut j, candidate c): strictly increasing candidates, n-1 cuts
  const C = cand.length;
  const INF = Number.POSITIVE_INFINITY;
  const dp: number[][] = [];
  const from: number[][] = [];
  for (let j = 0; j < n - 1; j++) {
    dp.push(new Array<number>(C).fill(INF));
    from.push(new Array<number>(C).fill(-1));
    let bestPrev = j === 0 ? 0 : INF;
    let bestPrevIdx = -1;
    for (let c = 0; c < C; c++) {
      if (j > 0 && c > 0 && dp[j - 1]![c - 1]! < bestPrev) {
        bestPrev = dp[j - 1]![c - 1]!;
        bestPrevIdx = c - 1;
      }
      if (bestPrev === INF) continue;
      // leave room for the remaining cuts
      if (C - c < n - 1 - j) continue;
      const cost = Math.abs(cand[c]!.rel - targets[j]!) + PENALTY[cand[c]!.prio];
      dp[j]![c] = bestPrev + cost;
      from[j]![c] = bestPrevIdx;
    }
  }
  let end = -1;
  let best = INF;
  for (let c = 0; c < C; c++) {
    if (dp[n - 2]![c]! < best) {
      best = dp[n - 2]![c]!;
      end = c;
    }
  }
  const picks: number[] = [];
  for (let j = n - 2, c = end; j >= 0 && c >= 0; j--) {
    picks.unshift(c);
    c = from[j]![c]!;
  }
  const cuts = picks.map((c) => cand[c]!.pos);
  const slices: string[] = [];
  let prev = 0;
  for (const cut of [...cuts, text.length]) {
    const s = text.slice(prev, cut).trim();
    if (s !== "") slices.push(s);
    prev = cut;
  }
  return slices;
}

/** Number of fallback beats for a segment packed to `avgBody` seconds (min 1), as equal shares. */
export function fallbackShares(text: string, cps: number, avgBody: number): number[] {
  const n = Math.max(1, Math.round(text.length / cps / avgBody));
  return Array.from({ length: n }, () => 1);
}
