// Passage finder (§7.7): Smith–Waterman over normWord tokens; accept ≥ 0.6; pause-aware window; clamp to maxClipMs.
import { normWord } from "@docmaker/core";
import type { WordTiming } from "@docmaker/core";

export const PASSAGE_ACCEPT = 0.6;
export const PASSAGE_VIDEO_VERIFIED = 0.8;

/** Levenshtein ratio 1 − d / max(len). */
export function levRatio(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n]! / Math.max(m, n);
}

export interface Alignment { score: number; matched: number; queryLen: number; targetStart: number; targetEnd: number }

/**
 * Local alignment of query tokens inside target tokens. match +2 (equal, or Levenshtein ratio ≥ 0.8 for tokens ≥ 5 chars
 * when `fuzzy`), mismatch −1, gap −1. Returns the matched query-token count and the target span [start, end] (inclusive).
 */
export function smithWaterman(query: readonly string[], target: readonly string[], o?: { fuzzy?: boolean }): Alignment | null {
  const fuzzy = o?.fuzzy ?? true;
  const m = query.length;
  const n = target.length;
  if (m === 0 || n === 0) return null;
  const eq = (a: string, b: string) => a === b || (fuzzy && a.length >= 5 && b.length >= 5 && levRatio(a, b) >= 0.8);
  const H = new Int32Array((m + 1) * (n + 1));
  const at = (i: number, j: number) => i * (n + 1) + j;
  let best = 0;
  let bi = 0;
  let bj = 0;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const diag = H[at(i - 1, j - 1)]! + (eq(query[i - 1]!, target[j - 1]!) ? 2 : -1);
      const v = Math.max(0, diag, H[at(i - 1, j)]! - 1, H[at(i, j - 1)]! - 1);
      H[at(i, j)] = v;
      if (v > best) {
        best = v;
        bi = i;
        bj = j;
      }
    }
  }
  if (best === 0) return null;
  // Traceback.
  let i = bi;
  let j = bj;
  let matched = 0;
  let start = bj - 1;
  while (i > 0 && j > 0 && H[at(i, j)]! > 0) {
    const v = H[at(i, j)]!;
    const isEq = eq(query[i - 1]!, target[j - 1]!);
    if (v === H[at(i - 1, j - 1)]! + (isEq ? 2 : -1)) {
      if (isEq) matched++;
      start = j - 1;
      i--;
      j--;
    } else if (v === H[at(i - 1, j)]! - 1) {
      i--;
    } else {
      start = j - 1;
      j--;
    }
  }
  return { score: best, matched, queryLen: m, targetStart: start, targetEnd: bj - 1 };
}

export function tokenize(text: string): string[] {
  return text.split(/\s+/u).map(normWord).filter((t) => t !== "");
}

/** Finds `quote` in timed transcript words. null when below the 0.6 acceptance threshold.
 *  matchStartMs/matchEndMs bound the matched words themselves (the shot snap never cuts into them). */
export function findPassage(quote: string, words: readonly WordTiming[], o: { maxClipMs: number }): { score: number; startMs: number; endMs: number; matchedText: string; matchStartMs: number; matchEndMs: number } | null {
  const q = tokenize(quote);
  // Transcript word → token(s); keep a token → word index map (a word may hold several tokens, e.g. "can't stop").
  const toks: string[] = [];
  const owner: number[] = [];
  words.forEach((w, wi) => {
    for (const t of tokenize(w.text)) {
      toks.push(t);
      owner.push(wi);
    }
  });
  const al = smithWaterman(q, toks);
  if (!al) return null;
  const score = Math.round((al.matched / q.length) * 1000) / 1000;
  if (score < PASSAGE_ACCEPT) return null;
  const first = owner[al.targetStart]!;
  const last = owner[al.targetEnd]!;
  const matchStart = words[first]!.startMs;
  const matchEnd = words[last]!.endMs;
  let startMs = Math.max(0, matchStart - 300);
  let endMs = matchEnd + 300;
  // Extend the end to the next pause ≥ 400 ms within +1.5 s (finish the thought).
  for (let j = last; j < words.length - 1; j++) {
    if (words[j]!.endMs > matchEnd + 1500) break;
    const gap = words[j + 1]!.startMs - words[j]!.endMs;
    if (gap >= 400) {
      endMs = Math.max(endMs, words[j]!.endMs + Math.min(300, Math.floor(gap / 2)));
      break;
    }
  }
  if (last === words.length - 1) endMs = Math.max(endMs, matchEnd + 300);
  if (endMs - startMs > o.maxClipMs) {
    const centre = (matchStart + matchEnd) / 2;
    startMs = Math.max(0, Math.round(centre - o.maxClipMs / 2));
    endMs = startMs + o.maxClipMs;
  }
  const matchedText = words.slice(first, last + 1).map((w) => w.text).join(" ");
  return { score, startMs: Math.round(startMs), endMs: Math.round(endMs), matchedText, matchStartMs: matchStart, matchEndMs: matchEnd };
}
