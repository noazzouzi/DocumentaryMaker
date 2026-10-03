// packages/core/src/util/tokenize.ts — the ONE tokenisation rule (§4.5, TOKENIZER_VERSION 1). Isomorphic.
import type { ScriptSegment } from "../schema/script";
import { DocmakerError } from "./errors";

export const TOKENIZER_VERSION = 1;
export interface DisplayWord { idx: number; text: string; norm: string; start: number; end: number }

const KEEP = /[^\p{L}\p{N}'%€$£.,-]/gu;
const MARKS = /\p{M}/gu;
const TRIM = /^['.,-]+|['.,-]+$/g;
/** Opening marks merge into the NEXT token; every other pure-punctuation token merges into the previous one. */
const OPENING = new Set(["«", "(", "[", "“", "‘", "¿", "¡"]);

/** NFKD; strip combining marks; lowercase; ’ ‘ → '; keep [\p{L}\p{N}'%€$£.,-]; trim leading/trailing '.,- */
export function normWord(s: string): string {
  return s
    .normalize("NFKD")
    .replace(MARKS, "")
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(KEEP, "")
    .replace(TRIM, "");
}

export function tokenizeDisplay(text: string): DisplayWord[] {
  const raw: { s: number; e: number; tok: string; norm: string }[] = [];
  for (const m of text.matchAll(/\S+/gu)) {
    const s = m.index;
    raw.push({ s, e: s + m[0].length, tok: m[0], norm: normWord(m[0]) });
  }
  const spans: { start: number; end: number; norm: string }[] = [];
  let pending: number | null = null; // start offset of punctuation waiting for the next word
  for (const r of raw) {
    if (r.norm !== "") {
      spans.push({ start: pending ?? r.s, end: r.e, norm: r.norm });
      pending = null;
      continue;
    }
    const opening = OPENING.has([...r.tok][0] ?? "");
    if (pending !== null || opening || spans.length === 0) {
      pending ??= r.s;
    } else {
      spans[spans.length - 1]!.end = r.e;
    }
  }
  if (pending !== null && spans.length > 0) spans[spans.length - 1]!.end = raw[raw.length - 1]!.e;
  return spans.map((sp, idx) => ({ idx, text: text.slice(sp.start, sp.end), norm: sp.norm, start: sp.start, end: sp.end }));
}

/**
 * Function words (normWord form) that never stand alone as a hero/slam word: articles, prepositions, conjunctions,
 * pronouns, auxiliaries. Shared by keyword captions, KeywordSlam/KineticText text choice and per-word reveals.
 */
export const FUNCTION_WORDS: Readonly<Record<"en" | "fr", ReadonlySet<string>>> = {
  en: new Set(["a", "an", "the", "of", "to", "in", "on", "at", "for", "and", "or", "but", "with", "by", "from", "they", "he", "she", "it", "we", "you", "i", "his", "her", "their", "its", "was", "were", "is", "are", "be", "had", "has", "have", "that", "this", "as", "so", "than", "then", "what", "who", "which", "not", "no"]),
  fr: new Set(["le", "la", "les", "l", "un", "une", "des", "de", "du", "d", "a", "au", "aux", "en", "dans", "sur", "pour", "par", "avec", "et", "ou", "mais", "il", "elle", "ils", "elles", "on", "nous", "vous", "je", "son", "sa", "ses", "leur", "leurs", "est", "sont", "etait", "que", "qui", "ce", "cette", "ne", "pas", "se", "s", "qu"]),
};

/** True when `word` (any form; normalised here) is a function word of `lang` (both languages when omitted). */
export function isFunctionWord(word: string, lang?: "en" | "fr"): boolean {
  const n = normWord(word);
  if (n === "") return true;
  // elided French forms ("l'", "d'", "qu'") normalise with their apostrophe
  const base = n.replace(/'$/, "");
  return lang ? FUNCTION_WORDS[lang].has(base) : FUNCTION_WORDS.en.has(base) || FUNCTION_WORDS.fr.has(base);
}

export function wordId(segmentId: string, idx: number): string {
  return `${segmentId}:${idx}`;
}

export function parseWordId(id: string): { segmentId: string; idx: number } {
  const m = /^(CH\d{1,2}-S\d{2,3}):(\d{1,4})$/.exec(id);
  if (!m) throw new DocmakerError("VALIDATION", `invalid word id "${id}"`);
  return { segmentId: m[1]!, idx: Number(m[2]) };
}

/** "CH3-S07" → "CH3" */
export function chapterOfSegment(segmentId: string): string {
  const m = /^(CH\d{1,2})-/.exec(segmentId);
  if (!m) throw new DocmakerError("VALIDATION", `invalid segment id "${segmentId}"`);
  return m[1]!;
}

/** "CH3-B014" | "CH3-S07-CLIP" | "CH3-S09-BR" → "CH3" */
export function chapterOfBeat(beatId: string): string {
  const m = /^(CH\d{1,2})-/.exec(beatId);
  if (!m) throw new DocmakerError("VALIDATION", `invalid beat id "${beatId}"`);
  return m[1]!;
}

/** The ONE definition of the text spoken (and tokenised) for a segment in a layout mode (voice, layout, director share it). */
export function spokenText(
  seg: Pick<ScriptSegment, "type" | "displayText" | "subtitleTranslation">,
  mode: "vo" | "clip-narrated" | "none",
): string {
  if (mode === "vo") return seg.displayText;
  if (mode === "clip-narrated") return seg.subtitleTranslation || seg.displayText;
  return "";
}

/**
 * Maps beat texts (exact contiguous slices, in order) onto display-word ranges [wordStart, wordEnd).
 * Throws VALIDATION when the slices do not reconstruct the segment (whitespace between slices is ignored)
 * or when a beat contains no display word. Clip and breath segments are never passed here.
 */
export function beatWordRanges(segmentText: string, beatTexts: string[]): { wordStart: number; wordEnd: number }[] {
  const ranges: { s: number; e: number }[] = [];
  let cur = 0;
  const skipWs = () => {
    while (cur < segmentText.length && /\s/u.test(segmentText[cur]!)) cur++;
  };
  beatTexts.forEach((b, i) => {
    const t = b.trim();
    skipWs();
    if (t === "" || !segmentText.startsWith(t, cur)) {
      throw new DocmakerError("VALIDATION", `beat ${i} is not an exact slice of the segment at offset ${cur}`, { details: { beat: b } });
    }
    ranges.push({ s: cur, e: cur + t.length });
    cur += t.length;
  });
  skipWs();
  if (cur !== segmentText.length) {
    throw new DocmakerError("VALIDATION", `beats do not cover the segment (stopped at offset ${cur} of ${segmentText.length})`);
  }
  const words = tokenizeDisplay(segmentText);
  const owner = words.map((w) => {
    let best = -1, bestOverlap = 0;
    ranges.forEach((r, i) => {
      const ov = Math.min(w.end, r.e) - Math.max(w.start, r.s);
      if (ov > bestOverlap) { bestOverlap = ov; best = i; }
    });
    return best;
  });
  return ranges.map((_, i) => {
    let first = -1, last = -1;
    owner.forEach((o, wi) => {
      if (o === i) { if (first < 0) first = wi; last = wi; }
    });
    if (first < 0) throw new DocmakerError("VALIDATION", `beat ${i} contains no display word`);
    return { wordStart: first, wordEnd: last + 1 };
  });
}

/** Time a chapter card / title sting needs before the narrator resumes: 1000·(enter/30 + max(1.2, chars/20 + 0.8)) − 200. */
export function chapterCardReadMs(title: string, enterFrames30: number): number {
  const chars = [...title].length;
  return Math.round(1000 * (enterFrames30 / 30 + Math.max(1.2, chars / 20 + 0.8))) - 200;
}
