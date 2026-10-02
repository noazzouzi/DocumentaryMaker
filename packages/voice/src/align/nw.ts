// Needleman–Wunsch word alignment (match +2, mismatch −1, gap −1; accent-insensitive) + interpolation.
// Port of $SP/tts/node/voice.ts alignScriptToTranscript / charAlignmentToWords.
import type { WordTiming } from "@docmaker/core";
import { normWord } from "@docmaker/core";

/** Accent/case/punctuation-insensitive comparison key ("L’Écluse," → "l'ecluse"). */
export function alignKey(s: string): string {
  return normWord(s).replace(/[^\p{L}\p{N}']/gu, "");
}

const MATCH = 2, MISMATCH = -1, GAP = -1;

/** Matched index pairs [i, j] (a[i] ≡ b[j]) of the optimal global alignment, increasing in both. */
export function nwPairs(a: readonly string[], b: readonly string[]): [number, number][] {
  const A = a.map(alignKey), B = b.map(alignKey);
  const n = A.length, m = B.length;
  if (n === 0 || m === 0) return [];
  const W = m + 1;
  const score = new Int32Array((n + 1) * W);
  for (let i = 1; i <= n; i++) score[i * W] = i * GAP;
  for (let j = 1; j <= m; j++) score[j] = j * GAP;
  for (let i = 1; i <= n; i++) {
    const ai = A[i - 1]!;
    const row = i * W, prev = (i - 1) * W;
    for (let j = 1; j <= m; j++) {
      const s = ai !== "" && ai === B[j - 1] ? MATCH : MISMATCH;
      const d = score[prev + j - 1]! + s, u = score[prev + j]! + GAP, l = score[row + j - 1]! + GAP;
      score[row + j] = d >= u ? (d >= l ? d : l) : u >= l ? u : l;
    }
  }
  const pairs: [number, number][] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const s = score[i * W + j]!;
    const eq = A[i - 1] !== "" && A[i - 1] === B[j - 1];
    if (s === score[(i - 1) * W + j - 1]! + (eq ? MATCH : MISMATCH)) {
      if (eq) pairs.push([i - 1, j - 1]);
      i--; j--;
    } else if (s === score[(i - 1) * W + j]! + GAP) i--;
    else j--;
  }
  return pairs.reverse();
}

/** Generic display/tts span assignment from NW anchors. */
export function anchorSpans(display: readonly string[], tts: readonly string[]): [number, number][] {
  const spans: ([number, number] | null)[] = display.map(() => null);
  const pairs = nwPairs(display, tts);
  for (const [d, t] of pairs) spans[d] = [t, t + 1];
  const anchors: [number, number][] = [[-1, -1], ...pairs, [display.length, tts.length]];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [d0, t0] = anchors[k]!, [d1, t1] = anchors[k + 1]!;
    const dCount = d1 - d0 - 1, tFrom = t0 + 1, tCount = t1 - t0 - 1;
    if (dCount > 0) {
      for (let x = 0; x < dCount; x++) {
        const a = tFrom + Math.floor((tCount * x) / dCount);
        const b = tFrom + Math.floor((tCount * (x + 1)) / dCount);
        spans[d0 + 1 + x] = [a, b];
      }
    } else if (tCount > 0) {
      // extra tts words between two adjacent anchors: extend the previous anchor (or the next one at the start)
      if (d0 >= 0) spans[d0] = [spans[d0]![0], t1];
      else if (d1 < display.length) spans[d1] = [tFrom, spans[d1]![1]];
    }
  }
  let last = 0;
  return spans.map((sp) => {
    const r: [number, number] = sp ?? [last, last];
    last = r[1];
    return r;
  });
}

/** Returns exactly scriptWords.length timings; unmatched words are interpolated between their matched neighbours. */
export function alignScriptToTranscript(scriptWords: string[], asr: readonly WordTiming[]): (WordTiming & { matched: boolean })[] {
  const n = scriptWords.length;
  const out: ((WordTiming & { matched: boolean }) | null)[] = new Array(n).fill(null);
  for (const [i, j] of nwPairs(scriptWords, asr.map((w) => w.text))) {
    const a = asr[j]!;
    out[i] = { text: scriptWords[i]!, startMs: a.startMs, endMs: Math.max(a.startMs, a.endMs), confidence: a.confidence, matched: true };
  }
  for (let k = 0; k < n; k++) {
    if (out[k]) continue;
    let p = k - 1;
    while (p >= 0 && !out[p]) p--;
    let q = k + 1;
    while (q < n && !out[q]) q++;
    const count = q - p - 1;
    const start = p >= 0 ? out[p]!.endMs : q < n ? Math.max(0, out[q]!.startMs - 300 * count) : 0;
    let end = q < n ? out[q]!.startMs : start + 300 * count;
    if (end < start) end = start;
    // weight by characters so long words get more time
    const weights = scriptWords.slice(p + 1, q).map((w) => [...alignKey(w)].length + 1);
    const total = weights.reduce((x, y) => x + y, 0);
    let acc = 0;
    for (let r = p + 1; r < q; r++) {
      const w = weights[r - p - 1]!;
      const s = start + ((end - start) * acc) / total;
      acc += w;
      const e = start + ((end - start) * acc) / total;
      out[r] = { text: scriptWords[r]!, startMs: Math.round(s), endMs: Math.round(e), confidence: 0, matched: false };
    }
    k = q - 1;
  }
  return out as (WordTiming & { matched: boolean })[];
}

/** ElevenLabs character alignment → whitespace-delimited word timings (texts taken from `text` when counts agree). */
export function charAlignmentToWords(text: string, chars: string[], startsSec: number[], endsSec: number[]): WordTiming[] {
  const words: WordTiming[] = [];
  let cur: WordTiming | null = null;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const s = Math.max(0, Math.round((startsSec[i] ?? 0) * 1000));
    const e = Math.max(s, Math.round((endsSec[i] ?? startsSec[i] ?? 0) * 1000));
    if (/^\s+$/u.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { text: ch, startMs: s, endMs: e, confidence: null };
    else { cur.text += ch; cur.endMs = Math.max(cur.endMs, e); }
  }
  if (cur) words.push(cur);
  const toks = text.split(/\s+/u).filter(Boolean);
  if (toks.length === words.length) words.forEach((w, i) => { w.text = toks[i]!; });
  return words;
}

/** Word error rate of a hypothesis against a reference (alignKey-normalised Levenshtein / reference length). */
export function wordErrorRate(reference: readonly string[], hypothesis: readonly string[]): number {
  const R = reference.map(alignKey).filter(Boolean), H = hypothesis.map(alignKey).filter(Boolean);
  if (R.length === 0) return H.length === 0 ? 0 : 1;
  let prev = Array.from({ length: H.length + 1 }, (_, j) => j);
  for (let i = 1; i <= R.length; i++) {
    const cur = [i];
    for (let j = 1; j <= H.length; j++) cur.push(Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (R[i - 1] === H[j - 1] ? 0 : 1)));
    prev = cur;
  }
  return prev[H.length]! / R.length;
}
