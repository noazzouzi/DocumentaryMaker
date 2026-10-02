// Sentence boundaries and request chunking over tts words.

const CLOSERS = /[»”"’')\]]+$/u;
const ABBREV = new Set(["m", "mm", "mme", "mlle", "dr", "st", "ste", "mr", "mrs", "ms", "jr", "sr", "vs", "etc", "av", "apr", "j.-c", "cf", "p", "no", "vol"]);

/** Trailing punctuation class of a tts word: "stop" (.!?…), "comma" (,;:) or null. */
export function trailingPause(word: string): "stop" | "comma" | null {
  const w = word.replace(CLOSERS, "");
  if (/[.!?…]$/u.test(w)) {
    if (/\.$/.test(w) && !/[!?…]/u.test(w)) {
      const core = w.slice(0, -1).toLowerCase().replace(/^[«“"‘'(]+/u, "");
      if (ABBREV.has(core) || /^\p{Lu}$/u.test(w.slice(0, -1))) return null; // "M.", "Dr.", initials
    }
    return "stop";
  }
  if (/[,;:—–]$/u.test(w)) return "comma";
  return null;
}

/** [start, end) tts-word ranges of each sentence (the last range always ends at words.length). */
export function sentenceRanges(words: readonly string[]): [number, number][] {
  const out: [number, number][] = [];
  let s = 0;
  words.forEach((w, i) => {
    if (trailingPause(w) === "stop") {
      out.push([s, i + 1]);
      s = i + 1;
    }
  });
  if (s < words.length) out.push([s, words.length]);
  return out;
}

const textLen = (words: readonly string[], a: number, b: number) => words.slice(a, b).join(" ").length;

/**
 * Splits words into request chunks of at most maxChars, cutting at sentence ends (then at commas, then
 * anywhere). Returns [start, end) word ranges covering all words in order.
 */
export function chunkAtSentences(words: readonly string[], maxChars: number): [number, number][] {
  if (words.length === 0) return [];
  if (textLen(words, 0, words.length) <= maxChars) return [[0, words.length]];
  const pieces: [number, number][] = [];
  for (const [a, b] of sentenceRanges(words)) {
    if (textLen(words, a, b) <= maxChars) { pieces.push([a, b]); continue; }
    // long sentence: cut after commas, then hard cuts
    let s = a;
    for (let i = a; i < b; i++) {
      const tooLong = textLen(words, s, i + 1) > maxChars;
      if (tooLong && i > s) { pieces.push([s, i]); s = i; }
      if (trailingPause(words[i]!) === "comma" && textLen(words, s, i + 1) > maxChars / 2) { pieces.push([s, i + 1]); s = i + 1; }
    }
    if (s < b) pieces.push([s, b]);
  }
  const out: [number, number][] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && textLen(words, last[0], p[1]) <= maxChars) last[1] = p[1];
    else out.push([p[0], p[1]]);
  }
  return out;
}
