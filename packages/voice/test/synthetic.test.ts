import path from "node:path";
import { describe, expect, it } from "vitest";
import { run, readWav, readWavHeader, sha256File } from "@docmaker/core/node";
import { VoiceSettings } from "@docmaker/core";
import { SyntheticProvider, buildTtsText, planSyntheticWords, voPostChain } from "../src/index";
import { renderSynth } from "../src/providers/synth-dsp";
import { buildSynthPlan, renderSynthInWorker } from "../src/providers/synthetic";
import { makeCtx, tmpDir } from "./helpers";

const ctx = makeCtx();
const voice = VoiceSettings.parse({ provider: "synthetic", voiceId: "synthetic-m1", charsPerSec: 16.5 });
const TEXT = "In sixteen thirty-seven, a single tulip bulb sold for five thousand guilders. Then the buyers vanished, overnight.";
const words = buildTtsText(TEXT, "en", { lexicon: [], expandNumbers: true, stripTags: true }).ttsWords;

/** ffmpeg silencedetect onsets (silence_end, ms), excluding the end-of-file flush. */
async function onsets(file: string): Promise<number[]> {
  const r = await run(ctx.config.ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-af", "silencedetect=n=-50dB:d=0.04", "-f", "null", "-"], { signal: ctx.signal });
  const durMs = (await readWavHeader(file)).durationMs;
  return [...r.stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]) * 1000).filter((t) => t < durMs - 2);
}
/** Every detected onset is within 10 ms of a word start, and every word preceded by ≥ 40 ms of silence is detected. */
function expectOnsets(det: number[], starts: number[], ends: number[]) {
  for (const d of det) expect(Math.min(...starts.map((s) => Math.abs(s - d)))).toBeLessThanOrEqual(10);
  starts.forEach((s, i) => {
    const gap = i === 0 ? s : s - ends[i - 1]!;
    if (gap >= 45) expect(Math.min(...det.map((d) => Math.abs(d - s)))).toBeLessThanOrEqual(10);
  });
}

describe("synthetic timing plan (§8.3)", () => {
  it("starts at 120 ms, clamps word durations to [140, 900] ms, adds punctuation pauses", () => {
    const { words: w, totalMs } = planSyntheticWords(["a", "extraordinarily-long-compound-word,", "end.", "next"], 16.5);
    expect(w[0]).toMatchObject({ startMs: 120, endMs: 260 }); // 2 chars → 121 ms → clamped to 140
    expect(w[1]!.endMs - w[1]!.startMs).toBe(900);
    expect(w[1]!.startMs).toBe(260 + 60);
    expect(w[2]!.startMs).toBe(w[1]!.endMs + 60 + 180); // comma
    expect(w[3]!.startMs).toBe(w[2]!.endMs + 60 + 380); // full stop
    expect(totalMs).toBe(w[3]!.endMs + 250);
  });
  it("punctuation-only tokens take no time", () => {
    const { words: w } = planSyntheticWords(["«", "Bonjour", "»"], 16);
    expect(w[0]!.startMs).toBe(w[0]!.endMs);
    expect(w[1]!.startMs).toBe(w[0]!.startMs);
    expect(w[2]!.startMs).toBe(w[2]!.endMs);
  });
});

describe("SyntheticProvider", () => {
  it("writes 48 kHz mono s16 whose audible onsets match the word timings within 10 ms", async () => {
    const dir = tmpDir();
    const p = new SyntheticProvider({ repoRoot: ctx.config.repoRoot, useWorker: "never" });
    const out = path.join(dir, "a.wav");
    const r = await p.synthesize({ segmentId: "CH1-S01", text: words.join(" "), ttsWords: words, lang: "en", voice, seed: 7 }, out, ctx.signal);
    const h = await readWavHeader(out);
    expect(h).toMatchObject({ sampleRate: 48000, channels: 1, bitsPerSample: 16, format: "pcm" });
    expect(Math.abs(h.durationMs - r.durationMs)).toBeLessThanOrEqual(1);
    expect(r.timingSource).toBe("synthetic");
    expect(r.words).toHaveLength(words.length);
    const det = await onsets(out);
    expect(det).toHaveLength(r.words!.length);
    expectOnsets(det, r.words!.map((w) => w.startMs), r.words!.map((w) => w.endMs));
  });

  it("is deterministic (same bytes) and seed-sensitive", async () => {
    const dir = tmpDir();
    const p = new SyntheticProvider({ repoRoot: ctx.config.repoRoot, useWorker: "never" });
    const req = { segmentId: "CH1-S01", text: words.join(" "), ttsWords: words, lang: "en" as const, voice, seed: 3 };
    await p.synthesize(req, path.join(dir, "1.wav"), ctx.signal);
    await p.synthesize(req, path.join(dir, "2.wav"), ctx.signal);
    await p.synthesize({ ...req, seed: 4 }, path.join(dir, "3.wav"), ctx.signal);
    const [a, b, c] = await Promise.all(["1", "2", "3"].map((n) => sha256File(path.join(dir, `${n}.wav`))));
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it("renders identically in a worker thread", async () => {
    const dir = tmpDir();
    const req = { segmentId: "CH1-S01", text: words.join(" "), ttsWords: words, lang: "en" as const, voice, seed: 5 };
    await new SyntheticProvider({ repoRoot: ctx.config.repoRoot, useWorker: "never" }).synthesize(req, path.join(dir, "main.wav"), ctx.signal);
    await new SyntheticProvider({ repoRoot: ctx.config.repoRoot, useWorker: "always" }).synthesize(req, path.join(dir, "worker.wav"), ctx.signal);
    expect(await sha256File(path.join(dir, "worker.wav"))).toBe(await sha256File(path.join(dir, "main.wav")));
  });

  it("the worker really runs (Node type stripping loads synth-dsp.ts) and matches the main thread sample for sample", async () => {
    const { plan } = buildSynthPlan(words, { cps: 16.5, f0: 190, seed: 2 });
    const dsp = path.join(ctx.config.repoRoot, "packages/voice/src/providers/synth-dsp.ts");
    const fromWorker = await renderSynthInWorker(plan, dsp, ctx.signal);
    expect(fromWorker).toBeInstanceOf(Float32Array);
    expect(Buffer.from(fromWorker!.buffer).equals(Buffer.from(renderSynth(plan).buffer))).toBe(true);
    expect(await renderSynthInWorker(plan, "/nonexistent/synth-dsp.ts", ctx.signal)).toBeNull();
  });

  it("normalises voiced RMS to −20 dBFS, silence is digital zero, higher voice has a higher f0", () => {
    const { plan, words: w } = buildSynthPlan(words, { cps: 16.5, f0: 110, seed: 1 });
    const s = renderSynth(plan);
    let sum = 0, n = 0;
    for (let i = 0; i < s.length; i++) if (s[i] !== 0) { sum += s[i]! * s[i]!; n++; }
    expect(20 * Math.log10(Math.sqrt(sum / n))).toBeCloseTo(-20, 0);
    const gapStart = Math.round((w[0]!.endMs + 5) * 48), gapEnd = Math.round((w[1]!.startMs - 1) * 48);
    for (let i = gapStart; i < gapEnd; i++) expect(s[i]).toBe(0);
    expect(s.slice(0, 119 * 48).every((x) => x === 0)).toBe(true);
  });

  it("lists the two synthetic voices for each language with a PROCEDURAL synthetic licence", async () => {
    const v = await new SyntheticProvider({ repoRoot: null }).listVoices("fr");
    expect(v.map((x) => x.id)).toEqual(["synthetic-m1", "synthetic-f1"]);
    expect(v[0]!.license).toMatchObject({ code: "PROCEDURAL", restrictions: ["synthetic"] });
  });
});

describe("post chain (§8.4)", () => {
  it("trims the lead (keeping 30 ms) and the tail, outputs 48 kHz mono s16; shifted words still match onsets", async () => {
    const dir = tmpDir();
    const p = new SyntheticProvider({ repoRoot: ctx.config.repoRoot, useWorker: "never" });
    const raw = path.join(dir, "raw.wav");
    const r = await p.synthesize({ segmentId: "CH1-S01", text: words.join(" "), ttsWords: words, lang: "en", voice, seed: 9 }, raw, ctx.signal);
    const out = path.join(dir, "post.wav");
    const post = await voPostChain(raw, out, { kind: "tts", rawFormat: null }, ctx);
    expect(post.leadTrimMs).toBe(90); // speech starts at 120 ms → keep 30 ms
    const h = await readWavHeader(out);
    expect(h).toMatchObject({ sampleRate: 48000, channels: 1, bitsPerSample: 16 });
    const lastEnd = r.words![r.words!.length - 1]!.endMs;
    expect(post.durationMs).toBeLessThan(r.durationMs - 90);
    expect(post.durationMs).toBeGreaterThanOrEqual(lastEnd - 90);
    const det = await onsets(out);
    expect(det.length).toBe(r.words!.length - 1); // the 30 ms lead pad is shorter than d = 40 ms
    expectOnsets(det, r.words!.map((w) => Math.max(0, w.startMs - post.leadTrimMs)), r.words!.map((w) => Math.max(0, w.endMs - post.leadTrimMs)));
  });

  it("decodes raw s16le PCM at another rate and leaves short leading silence alone", async () => {
    const dir = tmpDir();
    const sr = 44100;
    const pcm = Buffer.alloc(sr * 2); // 1 s: 20 ms silence, then a tone
    for (let i = Math.round(0.02 * sr); i < sr; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / sr)), i * 2);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path.join(dir, "a.pcm"), pcm);
    const post = await voPostChain(path.join(dir, "a.pcm"), path.join(dir, "a.wav"), { kind: "recording", rawFormat: { sampleRate: sr, pcm: true } }, ctx);
    expect(post.leadTrimMs).toBe(0);
    expect(post.durationMs).toBeGreaterThanOrEqual(990);
    const w = await readWav(path.join(dir, "a.wav"));
    expect(w.sampleRate).toBe(48000);
  });
});
