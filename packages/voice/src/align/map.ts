// tts-word timings → display-word TimedWords (§8.2): start = min, end = max of the word's tts words; empty spans
// interpolated (source "interpolated"); every time clamped to [0, durationMs] and kept monotonic.
import type { Lang, LexiconEntry, TimedWord, TimingSource, WordTiming } from "@docmaker/core";
import { tokenizeDisplay, wordId } from "@docmaker/core";
import { buildTtsText } from "../text/tts-text";
import { anchorSpans } from "./nw";

export { anchorSpans };

const tokens = (s: string) => s.split(/\s+/u).filter(Boolean);

/**
 * Display→tts spans for a (possibly user-edited) ttsText. Uses buildTtsText's own mapping when one of the
 * standard option sets reproduces ttsText exactly; otherwise anchors identical words (NW) and distributes
 * the unmatched tts words over the unmatched display words between anchors.
 */
export function mapDisplayToTts(spoken: string, ttsText: string, lang: Lang, lexicon: LexiconEntry[]): [number, number][] {
  const target = tokens(ttsText).join(" ");
  for (const expandNumbers of [true, false]) {
    for (const stripTags of [true, false]) {
      for (const lex of [lexicon, []]) {
        const r = buildTtsText(spoken, lang, { lexicon: lex, expandNumbers, stripTags });
        if (r.ttsText === target) return r.displayToTts;
      }
    }
  }
  const display = tokenizeDisplay(spoken).map((w) => w.text);
  return anchorSpans(display, tokens(ttsText));
}

export interface MapInput {
  segmentId: string;
  display: { idx: number; text: string }[];
  displayToTts: [number, number][];
  tts: readonly WordTiming[]; // one per tts word, already shifted to the final file
  source: TimingSource;
  durationMs: number;
}

/** Builds the TimedWords of one segment. */
export function toTimedWords(i: MapInput): TimedWord[] {
  const clamp = (x: number) => Math.max(0, Math.min(i.durationMs, Math.round(x)));
  const raw = i.display.map((d, k) => {
    const [a, b] = i.displayToTts[k] ?? [0, 0];
    const ws = i.tts.slice(a, b).filter((w) => w !== undefined);
    // zero-length tokens (pure punctuation) don't define a word's extent unless nothing else does
    const voiced = ws.filter((w) => w.endMs > w.startMs);
    const use = voiced.length ? voiced : ws;
    if (use.length === 0) return { d, t: null as null | { s: number; e: number; c: number | null } };
    const confs = use.map((w) => w.confidence).filter((c): c is number => c !== null);
    return {
      d,
      t: {
        s: Math.min(...use.map((w) => w.startMs)),
        e: Math.max(...use.map((w) => w.endMs)),
        c: confs.length ? confs.reduce((x, y) => x + y, 0) / confs.length : null,
      },
    };
  });
  const out: TimedWord[] = [];
  for (let k = 0; k < raw.length; k++) {
    const r = raw[k]!;
    if (r.t) {
      out.push({ wordId: wordId(i.segmentId, r.d.idx), text: r.d.text, startMs: clamp(r.t.s), endMs: clamp(r.t.e), confidence: r.t.c, source: i.source });
      continue;
    }
    // run of untimed display words [k, q)
    let q = k;
    while (q < raw.length && !raw[q]!.t) q++;
    const prev = out[out.length - 1];
    const next = q < raw.length ? raw[q]!.t : null;
    const count = q - k;
    const weights = raw.slice(k, q).map((x) => [...x.d.text].length + 1);
    let lo: number, hi: number;
    const gapStart = prev ? prev.endMs : 0;
    const gapEnd = next ? next.s : i.durationMs;
    if (gapEnd - gapStart >= 60 * count) {
      lo = gapStart; hi = gapEnd;
    } else if (prev) {
      // no room: share the previous word's interval
      const pw = [...prev.text].length + 1;
      const total = pw + weights.reduce((x, y) => x + y, 0);
      const span = prev.endMs - prev.startMs;
      const newPrevEnd = prev.startMs + Math.round((span * pw) / total);
      lo = newPrevEnd; hi = prev.endMs;
      prev.endMs = newPrevEnd;
    } else {
      lo = Math.max(0, gapEnd - 60 * count); hi = gapEnd;
    }
    const total = weights.reduce((x, y) => x + y, 0);
    let acc = 0;
    for (let x = k; x < q; x++) {
      const s = lo + ((hi - lo) * acc) / total;
      acc += weights[x - k]!;
      const e = lo + ((hi - lo) * acc) / total;
      out.push({ wordId: wordId(i.segmentId, raw[x]!.d.idx), text: raw[x]!.d.text, startMs: clamp(s), endMs: clamp(e), confidence: null, source: "interpolated" });
    }
    k = q - 1;
  }
  // monotonic onsets, end ≥ start
  for (let k = 0; k < out.length; k++) {
    const w = out[k]!;
    if (k > 0 && w.startMs < out[k - 1]!.startMs) w.startMs = out[k - 1]!.startMs;
    if (w.endMs < w.startMs) w.endMs = w.startMs;
  }
  return out;
}

/** Shifts provider timings by −shiftMs (clamped ≥ 0 and ≤ durationMs). */
export function shiftTimings(ws: readonly WordTiming[], shiftMs: number, durationMs: number): WordTiming[] {
  const c = (x: number) => Math.max(0, Math.min(durationMs, Math.round(x - shiftMs)));
  return ws.map((w) => ({ ...w, startMs: c(w.startMs), endMs: Math.max(c(w.startMs), c(w.endMs)) }));
}
