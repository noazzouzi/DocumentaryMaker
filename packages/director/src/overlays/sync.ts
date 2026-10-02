// VO-synced sub-beats (§9.3 step 7a): Needleman–Wunsch (semi-global) alignment of an item's spoken text against the
// layout words of this and the next beat → `at` frames. Pure.
import { normWord, tokenizeDisplay, type LayoutWord } from "@docmaker/core";

const digits = (s: string) => s.replace(/[^\p{N}]/gu, "");

function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[n]!;
}

/** Token similarity in [0, 1]: exact, same digits, or normalised edit distance. */
export function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  const da = digits(a), db = digits(b);
  if (da !== "" && da === db) return 1;
  if (da !== "" || db !== "") return 0;
  const L = Math.max(a.length, b.length);
  if (L === 0) return 0;
  return 1 - lev(a, b) / L;
}

/**
 * Semi-global NW: every item token is aligned (or gapped) against `words`; leading/trailing narration words are free.
 * Returns, for each item token, the matched word index (or null).
 */
export function alignTokens(item: readonly string[], words: readonly string[]): (number | null)[] {
  const m = item.length, n = words.length;
  if (m === 0) return [];
  if (n === 0) return item.map(() => null);
  const MATCH = 2, MIS = -1, GAP_ITEM = -1, GAP_WORD = -0.6;
  const sc: Float64Array[] = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  const tb: Uint8Array[] = Array.from({ length: m + 1 }, () => new Uint8Array(n + 1)); // 0 diag, 1 up (item gap), 2 left (word gap)
  for (let i = 1; i <= m; i++) { sc[i]![0] = i * GAP_ITEM; tb[i]![0] = 1; }
  for (let j = 1; j <= n; j++) { sc[0]![j] = 0; tb[0]![j] = 2; } // free leading words
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const s = tokenSim(item[i - 1]!, words[j - 1]!);
      const diag = sc[i - 1]![j - 1]! + (s >= 0.8 ? MATCH * s : MIS);
      const up = sc[i - 1]![j]! + GAP_ITEM;
      const left = sc[i]![j - 1]! + (i === m ? 0 : GAP_WORD); // free trailing words
      let best = diag, t = 0;
      if (up > best) { best = up; t = 1; }
      if (left > best) { best = left; t = 2; }
      sc[i]![j] = best;
      tb[i]![j] = t;
    }
  }
  const out: (number | null)[] = item.map(() => null);
  let i = m, j = n;
  while (i > 0 && j > 0) {
    const t = tb[i]![j]!;
    if (t === 0) {
      if (tokenSim(item[i - 1]!, words[j - 1]!) >= 0.8) out[i - 1] = j - 1;
      i--; j--;
    } else if (t === 1) i--;
    else j--;
  }
  return out;
}

export const tokensOf = (s: string): string[] => tokenizeDisplay(s).map((w) => w.norm).filter((x) => x !== "");

export interface SyncMatch { first: LayoutWord; last: LayoutWord; matched: number; total: number }

/**
 * Finds `text` in `words` (in order, starting at word index `fromIdx`): the match is accepted when at least half of
 * the tokens (or a numeric token for 1–2 token texts) aligned.
 */
export function findSpoken(text: string, words: readonly LayoutWord[], fromIdx = 0): (SyncMatch & { endIdx: number }) | null {
  const toks = tokensOf(text);
  if (toks.length === 0 || fromIdx >= words.length) return null;
  const pool = words.slice(fromIdx);
  const al = alignTokens(toks, pool.map((w) => w.norm));
  const hits = al.filter((x): x is number => x !== null);
  if (hits.length === 0) return null;
  const ok = hits.length * 2 >= toks.length || (toks.length <= 2 && toks.some((t, k) => al[k] !== null && /\p{N}/u.test(t)));
  if (!ok) return null;
  const firstIdx = Math.min(...hits), lastIdx = Math.max(...hits);
  return { first: pool[firstIdx]!, last: pool[lastIdx]!, matched: hits.length, total: toks.length, endIdx: fromIdx + lastIdx + 1 };
}

/** Per-word sync of a quote text: `at` (relative to itemFrom) for every display word; null when unmatched. */
export function syncWords(text: string, words: readonly LayoutWord[], itemFrom: number): { text: string; at: number | null }[] {
  const dw = tokenizeDisplay(text);
  const al = alignTokens(dw.map((w) => w.norm), words.map((w) => w.norm));
  return dw.map((w, k) => ({ text: w.text, at: al[k] !== null && al[k] !== undefined ? Math.max(0, words[al[k]!]!.from - itemFrom) : null }));
}

/** Fills unmatched `at`s monotonically: interpolated between matched neighbours, else evenly spaced after the entry. */
export function fillAts(ats: (number | null)[], enter: number, step: number): number[] {
  const out: number[] = [];
  let lastKnown = enter - step;
  for (let k = 0; k < ats.length; k++) {
    const a = ats[k];
    if (a !== null && a !== undefined && a >= lastKnown) { out.push(a); lastKnown = a; continue; }
    // next known
    let nk = -1;
    for (let j = k + 1; j < ats.length; j++) if (ats[j] !== null && ats[j] !== undefined && ats[j]! > lastKnown) { nk = j; break; }
    const v = nk >= 0 ? lastKnown + (ats[nk]! - lastKnown) / (nk - k + 1) : lastKnown + step;
    const x = Math.max(0, Math.round(Math.max(v, lastKnown)));
    out.push(x);
    lastKnown = x;
  }
  return out;
}

export { normWord };
