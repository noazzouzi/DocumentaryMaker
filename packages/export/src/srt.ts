// SRT sidecar (§13.3): built from the non-burned full grouping ("srt") plus "clip" and "translation" groups; burned
// "keywords"/"pop"/"karaoke"/"rail" groups are selective on-screen text and are never written. ≤ 42 chars × 2 lines,
// sentence case, UTF-8, HH:MM:SS,mmm from frames. A clip segment with translation pages uses them instead of its
// original-language clip groups (the viewer reads the translation). Every word appears at most once.
import { srtTime, type CaptionGroup, type CaptionWord, type Timeline } from "@docmaker/core";

export const SRT_MAX_LINE = 42;
export const SRT_MAX_LINES = 2;
const SRT_VARIANTS = new Set<CaptionGroup["variant"]>(["srt", "clip", "translation"]);

/**
 * Words → text: single spaces, no space before closing punctuation. Only ordinary spaces are collapsed: the
 * no-break spaces of French typography (U+00A0, U+202F, e.g. "tout\u202F?") inside a word are kept.
 */
export function joinWords(words: readonly string[]): string {
  return words
    .map((w) => w.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ""))
    .filter(Boolean)
    .join(" ")
    .replace(/[ \t\r\n]+(?=[\u00A0\u202F][;:!?»])/g, "")
    .replace(/[ \t\r\n]+([,.;:!?…)\]»”])/g, (m, p: string) => (p === "»" ? m : p))
    .replace(/([([«“])[ \t\r\n]+/g, (m, p: string) => (p === "«" ? m : p));
}

/** All-caps groups (e.g. typed in caps) are converted to sentence case; mixed-case text is kept as written. */
export function sentenceCase(s: string): string {
  const letters = s.replace(/[^\p{L}]/gu, "");
  if (letters.length < 4 || letters !== letters.toUpperCase() || letters === letters.toLowerCase()) return s;
  const lower = s.toLocaleLowerCase();
  return lower.replace(/(^|[.!?…]\s+)(\p{L})/gu, (_, a: string, b: string) => a + b.toLocaleUpperCase());
}

/** Best break into ≤ maxLines lines of ≤ maxLen chars (balanced); null when it does not fit. */
export function wrapLines(text: string, maxLen = SRT_MAX_LINE, maxLines = SRT_MAX_LINES): string[] | null {
  if (text.length <= maxLen) return [text];
  if (maxLines < 2) return null;
  const words = text.split(" ");
  let best: string[] | null = null;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    if (a.length > maxLen || b.length > maxLen) continue;
    const score = Math.abs(a.length - b.length) + (/[,.;:!?]$/.test(a) ? -6 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = [a, b];
    }
  }
  return best;
}

interface Cue { from: number; to: number; lines: string[] }

/** Splits a group's words into cues that each fit 2 × 42 chars (timed by their words). */
function groupCues(g: { from: number; dur: number; words: CaptionWord[] }): Cue[] {
  const words = [...g.words].sort((a, b) => a.from - b.from);
  const cues: Cue[] = [];
  let i = 0;
  while (i < words.length) {
    let j = i + 1;
    let lines = wrapLines(sentenceCase(joinWords(words.slice(i, j).map((w) => w.text)))) ?? [joinWords([words[i]!.text])];
    // grow the chunk while it still fits
    while (j < words.length) {
      const next = wrapLines(sentenceCase(joinWords(words.slice(i, j + 1).map((w) => w.text))));
      if (!next) break;
      lines = next;
      j++;
    }
    const first = words[i]!;
    const last = words[j - 1]!;
    const from = i === 0 ? Math.min(g.from, first.from) : first.from;
    const to = j >= words.length ? Math.max(g.from + g.dur, last.from + last.dur) : words[j]!.from;
    cues.push({ from, to: Math.max(to, from + 1), lines });
    i = j;
  }
  return cues;
}

/** The caption groups written to the SRT (exported for tests and the publish kit). */
export function srtGroups(t: Timeline): CaptionGroup[] {
  const groups = t.captions.filter((g) => SRT_VARIANTS.has(g.variant));
  const translated = new Set(groups.filter((g) => g.variant === "translation").map((g) => g.segmentId));
  const chosen = groups.filter((g) => !(g.variant === "clip" && translated.has(g.segmentId)));
  const seen = new Set<string>();
  const out: CaptionGroup[] = [];
  for (const g of [...chosen].sort((a, b) => a.from - b.from || a.id.localeCompare(b.id))) {
    const words = g.words.filter((w) => {
      if (seen.has(w.wordId)) return false;
      seen.add(w.wordId);
      return w.text.trim() !== "";
    });
    if (words.length) out.push({ ...g, words });
  }
  return out;
}

export function writeSrt(t: Timeline): string {
  const cues = srtGroups(t).flatMap(groupCues).sort((a, b) => a.from - b.from);
  for (let k = 0; k + 1 < cues.length; k++) {
    const c = cues[k]!;
    const n = cues[k + 1]!;
    if (c.to > n.from) c.to = Math.max(c.from + 1, n.from);
  }
  const N = t.durationInFrames;
  const CRLF = "\r\n";
  return cues
    .map((c, i) => `${i + 1}${CRLF}${srtTime(c.from, t.fps)} --> ${srtTime(Math.min(c.to, Math.max(N, c.from + 1)), t.fps)}${CRLF}${c.lines.join(CRLF)}${CRLF}`)
    .join(CRLF);
}
