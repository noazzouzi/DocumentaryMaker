// Trivially fixable slice mismatches (apostrophes, quotes, spacing, punctuation) are repaired in code: when the model's
// beat texts match the segment word for word (normWord), exact slices are re-cut from the segment itself.
import { beatWordRanges, tokenizeDisplay } from "@docmaker/core";

/** Exact slices when `beatTexts` already reconstruct the segment, re-cut slices when they match token-wise, else null. */
export function realignSlices(segmentText: string, beatTexts: readonly string[]): { slices: string[]; changed: boolean } | null {
  try {
    beatWordRanges(segmentText, beatTexts.map((t) => t.trim()));
    return { slices: beatTexts.map((t) => t.trim()), changed: false };
  } catch {
    /* try the token-wise alignment */
  }
  const words = tokenizeDisplay(segmentText);
  const counts = beatTexts.map((t) => tokenizeDisplay(t).length);
  if (counts.some((c) => c === 0) || counts.reduce((a, b) => a + b, 0) !== words.length) return null;
  const norms = beatTexts.flatMap((t) => tokenizeDisplay(t).map((w) => w.norm));
  if (norms.some((n, i) => n !== words[i]!.norm)) return null;
  const slices: string[] = [];
  let at = 0;
  for (const c of counts) {
    const first = words[at]!;
    const last = words[at + c - 1]!;
    slices.push(segmentText.slice(first.start, last.end).trim());
    at += c;
  }
  try {
    beatWordRanges(segmentText, slices);
  } catch {
    return null;
  }
  return { slices, changed: true };
}
