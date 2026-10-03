import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { WordTiming } from "@docmaker/core";
import { tokenizeDisplay } from "@docmaker/core";
import { alignScriptToTranscript, buildTtsText, charAlignmentToWords, estimateTimings, wordErrorRate } from "../src/index";
import { anchorSpans, mapDisplayToTts, shiftTimings, toTimedWords } from "../src/align/map";
import { tokensToWords, type WhisperItem } from "../src/align/whisper-cpp";
import { regionsFromAudio } from "../src/align/estimated";
import { mergeAsrWords } from "../src/align/faster-whisper";
import { alignKey, nwPairs } from "../src/align/nw";
import { DATA } from "./helpers";

const read = <T>(f: string) => JSON.parse(readFileSync(path.join(DATA, f), "utf8")) as T;
const script = readFileSync(path.join(DATA, "fr.txt"), "utf8").trim().split(/\s+/);
/** Piper phoneme-alignment ground truth: "2016" is spoken as 3 words (deux mille seize). */
function groundTruth(): { startMs: number; endMs: number }[] {
  const gt = read<{ startMs: number; endMs: number }[]>("piper_fr_words.json");
  return [gt[0]!, { startMs: gt[1]!.startMs, endMs: gt[3]!.endMs }, ...gt.slice(4)];
}

describe("charAlignmentToWords", () => {
  it("groups characters on whitespace and keeps the script's tokens", () => {
    const text = "En 2016, tout bascule.";
    const chars = [...text];
    const starts = chars.map((_, i) => i * 0.05);
    const ends = chars.map((_, i) => i * 0.05 + 0.04);
    const w = charAlignmentToWords(text, chars, starts, ends);
    expect(w.map((x) => x.text)).toEqual(["En", "2016,", "tout", "bascule."]);
    expect(w[0]).toEqual({ text: "En", startMs: 0, endMs: 90, confidence: null });
    expect(w[1]!.startMs).toBe(150);
    expect(w[3]!.endMs).toBe(Math.round((chars.length - 1) * 50 + 40));
  });
  it("handles leading/trailing/multiple spaces and empty input", () => {
    expect(charAlignmentToWords("", [], [], [])).toEqual([]);
    const w = charAlignmentToWords(" a  b ", [" ", "a", " ", " ", "b", " "], [0, 0.1, 0.2, 0.3, 0.4, 0.5], [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(w.map((x) => [x.text, x.startMs, x.endMs])).toEqual([["a", 100, 200], ["b", 400, 500]]);
  });
});

describe("alignScriptToTranscript (Needleman–Wunsch)", () => {
  it("returns exactly one timing per script word, accent/case-insensitive matches", () => {
    const asr: WordTiming[] = [
      { text: "le", startMs: 0, endMs: 100, confidence: 0.9 },
      { text: "ECLUSE", startMs: 120, endMs: 400, confidence: 0.8 },
      { text: "rapporta", startMs: 450, endMs: 800, confidence: 0.9 },
    ];
    const out = alignScriptToTranscript(["Le", "l’Écluse", "Écluse,", "rapporta"], asr);
    expect(out).toHaveLength(4);
    expect(out[0]).toMatchObject({ text: "Le", startMs: 0, endMs: 100, matched: true });
    expect(out[2]).toMatchObject({ text: "Écluse,", startMs: 120, matched: true });
    expect(out[1]!.matched).toBe(false);
    expect(out[1]!.startMs).toBe(100);
    expect(out[1]!.endMs).toBe(120);
    expect(out[3]).toMatchObject({ matched: true, startMs: 450 });
  });
  it("interpolates unmatched words at the start and the end", () => {
    const out = alignScriptToTranscript(["un", "deux", "trois", "quatre"], [{ text: "deux", startMs: 1000, endMs: 1200, confidence: 1 }]);
    expect(out.map((w) => w.matched)).toEqual([false, true, false, false]);
    expect(out[0]!.endMs).toBeLessThanOrEqual(1000);
    expect(out[2]!.startMs).toBe(1200);
    expect(out[3]!.endMs).toBeGreaterThan(out[2]!.endMs);
    for (let i = 1; i < out.length; i++) expect(out[i]!.startMs).toBeGreaterThanOrEqual(out[i - 1]!.startMs);
  });
  it("empty transcript → all interpolated, still script length", () => {
    const out = alignScriptToTranscript(["a", "b"], []);
    expect(out).toHaveLength(2);
    expect(out.every((w) => !w.matched)).toBe(true);
  });
  it("whisper.cpp DTW tokens on Piper FR audio: start MAE < 120 ms against phoneme ground truth (port of align_test)", () => {
    const caps = read<{ text: string; startMs: number; endMs: number; timestampMs: number | null; confidence: number }[]>("wcpp_captions_piper_fr_small.json");
    const items: WhisperItem[] = caps.map((c) => ({ text: c.text, offsets: { from: c.startMs, to: c.endMs }, tokens: [{ text: c.text, t_dtw: c.timestampMs === null ? -1 : c.timestampMs / 10, p: c.confidence, offsets: { from: c.startMs, to: c.endMs } }] }));
    const words = tokensToWords(items);
    const al = alignScriptToTranscript(script, words);
    const gt = groundTruth();
    expect(al).toHaveLength(gt.length);
    const err = al.map((w, i) => Math.abs(w.startMs - gt[i]!.startMs));
    const mae = err.reduce((a, b) => a + b, 0) / err.length;
    expect(mae).toBeLessThan(120);
  });
  it("faster-whisper words on the same audio: start MAE < 150 ms and few interpolations", () => {
    const fw = read<{ text: string; startMs: number; endMs: number; p: number }[]>("fw_turbo_piper_fr.json");
    const words = mergeAsrWords(fw);
    expect(words.map((w) => w.text)).toContain("l'acteur"); // elisions re-joined
    const al = alignScriptToTranscript(script, words);
    const gt = groundTruth();
    const mae = al.reduce((a, w, i) => a + Math.abs(w.startMs - gt[i]!.startMs), 0) / al.length;
    expect(mae).toBeLessThan(150);
    expect(al.filter((w) => !w.matched).map((w) => w.text)).toEqual(["bankable", "d'Hollywood,"]);
  });
});

/** The original full-matrix NW (score matrix + recomputed traceback), kept as the reference. */
function nwReference(a: readonly string[], b: readonly string[]): [number, number][] {
  const A = a.map(alignKey), B = b.map(alignKey);
  const n = A.length, m = B.length, W = m + 1;
  if (!n || !m) return [];
  const sc = new Int32Array((n + 1) * W);
  for (let i = 1; i <= n; i++) sc[i * W] = -i;
  for (let j = 1; j <= m; j++) sc[j] = -j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const d = sc[(i - 1) * W + j - 1]! + (A[i - 1] !== "" && A[i - 1] === B[j - 1] ? 2 : -1);
    sc[i * W + j] = Math.max(d, sc[(i - 1) * W + j]! - 1, sc[i * W + j - 1]! - 1);
  }
  const out: [number, number][] = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    const eq = A[i - 1] !== "" && A[i - 1] === B[j - 1];
    if (sc[i * W + j] === sc[(i - 1) * W + j - 1]! + (eq ? 2 : -1)) { if (eq) out.push([i - 1, j - 1]); i--; j--; }
    else if (sc[i * W + j] === sc[(i - 1) * W + j]! - 1) i--;
    else j--;
  }
  return out.reverse();
}

/** Seeded word sequence + an "ASR" copy with substitutions, deletions, insertions and a repeated phrase (a retake). */
function noisyPair(n: number, seed: number): [string[], string[]] {
  let x = seed >>> 0;
  const rnd = () => ((x = (Math.imul(x, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const vocab = Array.from({ length: 400 }, (_, k) => `w${k}`);
  const a = Array.from({ length: n }, () => vocab[Math.floor(rnd() * vocab.length)]!);
  const b: string[] = [];
  for (let k = 0; k < n; k++) {
    const r = rnd();
    if (r < 0.03) continue; // deletion
    if (r < 0.06) { b.push("zz"); continue; } // substitution
    b.push(a[k]!);
    if (r > 0.97) b.push("uh"); // insertion
    if (k % 997 === 500) b.push(...a.slice(k - 8, k + 1)); // retake of the last phrase
  }
  return [a, b];
}

describe("nwPairs", () => {
  it("matches the full-matrix reference (ties included) on small inputs", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const [a, b] = noisyPair(30 + seed * 7, seed);
      expect(nwPairs(a, b)).toEqual(nwReference(a, b));
    }
    expect(nwPairs(["a", "b"], ["b", "a"])).toEqual(nwReference(["a", "b"], ["b", "a"]));
    expect(nwPairs([], ["a"])).toEqual([]);
  });
  it("the banded alignment of a long recording equals the full one", () => {
    const [a, b] = noisyPair(2500, 7);
    expect(nwPairs(a, b, { fullCells: 0 })).toEqual(nwReference(a, b));
  });
  it("a 60-minute import (≈ 9k × 9k words) aligns in a band without a gigabyte matrix", () => {
    const [a, b] = noisyPair(9000, 3);
    const before = process.memoryUsage().arrayBuffers;
    const t0 = performance.now();
    const pairs = nwPairs(a, b);
    const ms = performance.now() - t0;
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(120 * 2 ** 20);
    expect(pairs.length).toBeGreaterThan(9000 * 0.9);
    for (const [i, j] of pairs) expect(a[i]).toBe(b[j]);
    expect(ms).toBeLessThan(10_000);
  }, 30_000);
});

describe("wordErrorRate", () => {
  it("normalises case, accents and punctuation", () => {
    expect(wordErrorRate(["Le", "marché", "s’effondre."], ["le", "MARCHE", "s'effondre"])).toBe(0);
    expect(wordErrorRate(["a", "b", "c", "d"], ["a", "x", "c"])).toBeCloseTo(0.5);
    expect(wordErrorRate([], [])).toBe(0);
  });
});

describe("display ↔ tts mapping", () => {
  it("mapDisplayToTts reuses buildTtsText's mapping for engine-built texts", () => {
    const spoken = "En 1637, 5 500 florins.";
    const r = buildTtsText(spoken, "fr", { lexicon: [], expandNumbers: true, stripTags: true });
    expect(mapDisplayToTts(spoken, r.ttsText, "fr", [])).toEqual(r.displayToTts);
  });
  it("anchors a user-edited ttsText on identical words", () => {
    const spoken = "Johnny Depp sues in 2018.";
    const edited = "Johnny Dep sues in twenty eighteen.";
    const spans = mapDisplayToTts(spoken, edited, "en", []);
    expect(spans).toEqual([[0, 1], [1, 2], [2, 3], [3, 4], [4, 6]]);
  });
  it("anchorSpans gives words with no counterpart empty spans and attaches extra tts words", () => {
    expect(anchorSpans(["a", "b", "c"], ["a", "c"])).toEqual([[0, 1], [1, 1], [1, 2]]);
    expect(anchorSpans(["a", "c"], ["a", "x", "y", "c"])).toEqual([[0, 3], [3, 4]]);
    expect(anchorSpans(["a"], ["x", "a"])).toEqual([[0, 2]]);
  });
  it("toTimedWords: min/max of tts words, interpolated empty spans, clamped and monotonic", () => {
    const display = tokenizeDisplay("Il a payé 5 500 florins [rires] hier.").map(({ idx, text }) => ({ idx, text }));
    const r = buildTtsText("Il a payé 5 500 florins [rires] hier.", "fr", { lexicon: [], expandNumbers: true, stripTags: true });
    let t = 100;
    const tts = r.ttsWords.map((w) => { const s = t; t += 300; return { text: w, startMs: s, endMs: s + 250, confidence: 0.9 }; });
    const tw = toTimedWords({ segmentId: "CH1-S01", display, displayToTts: r.displayToTts, tts, source: "provider", durationMs: t });
    expect(tw).toHaveLength(display.length);
    expect(tw[3]).toMatchObject({ wordId: "CH1-S01:3", text: "5", startMs: 1000, endMs: 1550, source: "provider", confidence: 0.9 });
    expect(tw[4]).toMatchObject({ text: "500", startMs: 1600, endMs: 2150 });
    const rires = tw.find((w) => w.text === "[rires]")!;
    expect(rires.source).toBe("interpolated");
    expect(rires.startMs).toBeGreaterThanOrEqual(tw[5]!.startMs);
    for (let i = 1; i < tw.length; i++) expect(tw[i]!.startMs).toBeGreaterThanOrEqual(tw[i - 1]!.startMs);
  });
  it("shiftTimings clamps at 0 and at the file duration", () => {
    const s = shiftTimings([{ text: "a", startMs: 20, endMs: 80, confidence: null }, { text: "b", startMs: 900, endMs: 1200, confidence: null }], 50, 1000);
    expect(s[0]).toMatchObject({ startMs: 0, endMs: 30 });
    expect(s[1]).toMatchObject({ startMs: 850, endMs: 1000 });
  });
});

describe("estimated timings", () => {
  it("are proportional to chars+1 (+0.5 after a comma) inside each region", () => {
    const w = estimateTimings(["ab,", "abcd", "«"], [{ startMs: 0, endMs: 900, words: [0, 3] }]);
    // weights 3+0.5 = 3.5 and 5, punctuation-only token 0
    expect(w[0]).toMatchObject({ startMs: 0, endMs: Math.round((900 * 3.5) / 8.5) });
    expect(w[1]!.endMs).toBe(900);
    expect(w[2]!.startMs).toBe(w[2]!.endMs);
  });
  it("snap sentence boundaries to the longest pauses of the audio", () => {
    const sr = 1000;
    const samples = new Float32Array(3000);
    const tone = (a: number, b: number) => { for (let i = a; i < b; i++) samples[i] = 0.5 * Math.sin(i); };
    tone(100, 1000); // sentence 1
    tone(1100, 1150); // tiny blip inside a pause
    tone(1500, 2800); // sentence 2
    const regions = regionsFromAudio(samples, sr, ["One", "sentence.", "Two", "more", "words."]);
    expect(regions).toHaveLength(2);
    expect(regions[0]!.startMs).toBeCloseTo(100, 0);
    expect(regions[1]!.endMs).toBeCloseTo(2800, 0);
    // the 100 ms gap before the blip is too short; the 350 ms pause after it is the boundary
    expect(regions[0]!.endMs).toBeCloseTo(1150, -1);
    expect(regions[1]!.startMs).toBeCloseTo(1500, -1);
  });
});
