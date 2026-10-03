import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { measureEbur128, readWav, sha256File } from "@docmaker/core/node";
import { MOOD_BPM, beatGrid, generateMusic, instrumentsFor, musicHash, tonicMidi } from "../src/index";
import type { MusicGenOptions } from "../src/index";
import { makeCtx } from "./helpers";

const ctx = makeCtx();
const TENSE: MusicGenOptions = { mood: "tense", energy: "high", bpm: 95, bars: 8, seed: 1637, key: "A minor" };

/** Onset (ms) of the low-band attack near `ms`: first point where the 2.5 ms low-band energy exceeds 4× the level before. */
function lowOnsetNear(x: Float32Array, ms: number): number {
  const a = 1 - Math.exp((-2 * Math.PI * 200) / 48000);
  const c = Math.round((ms * 48000) / 1000);
  const from = Math.max(0, c - 2400), to = Math.min(x.length, c + 1920);
  let y = 0;
  for (let i = Math.max(0, from - 9600); i < from; i++) y += a * (x[i]! - y);
  const sq: number[] = [];
  for (let i = from; i < to; i++) { y += a * (x[i]! - y); sq.push(y * y); }
  const W = 120;
  const energy = (k: number) => { let e = 0; for (let j = k; j < k + W; j++) e += sq[j]!; return e / W; };
  const before = energy(0) + energy(W) + energy(2 * W); // [c − 50, c − 42.5] ms: the previous beat's tail
  for (let k = 3 * W; k + W < sq.length; k += 12) if (energy(k) > (4 * before) / 3) return ((from + k + W) * 1000) / 48000;
  return Number.NaN;
}

describe("procedural music", () => {
  it("reports an exact beat grid", () => {
    for (const bpm of [70, 95, 110, 123.5]) {
      const g = beatGrid(bpm, 16);
      expect(g.beatsMs.length).toBe(64);
      for (const [i, ms] of g.beatsMs.entries()) expect(Math.abs(ms - (i * 60000) / bpm)).toBeLessThanOrEqual(0.52);
      expect(g.downbeatsMs).toEqual(g.beatsMs.filter((_, i) => i % 4 === 0));
      expect(Math.abs(g.durationMs - (64 * 60000) / bpm)).toBeLessThanOrEqual(0.52);
    }
  });

  it("synthesises a −18 LUFS loop whose kicks land on the reported beats", async () => {
    const r = await generateMusic(TENSE, ctx);
    expect(r.bpm).toBe(95);
    expect(r.wavPath.startsWith(ctx.config.paths.music)).toBe(true);
    const w = await readWav(r.wavPath);
    expect(w.sampleRate).toBe(48000);
    expect(w.channels).toBe(2);
    expect(w.data[0]!.length).toBe(Math.round((32 * 60 * 48000) / 95));
    expect(r.durationMs).toBe(Math.round((32 * 60000) / 95));
    const m = await measureEbur128(r.wavPath, { config: ctx.config, signal: ctx.signal });
    expect(Math.abs(m.integratedLufs - -18)).toBeLessThan(0.5);
    expect(m.truePeakDbtp).toBeLessThan(0);
    const mono = w.data[0]!.map((v, i) => (v + w.data[1]![i]!) / 2);
    for (const ms of r.downbeatsMs.slice(1)) expect(Math.abs(lowOnsetNear(mono, ms) - ms), `downbeat ${ms}`).toBeLessThanOrEqual(5);
    const meta = JSON.parse(await readFile(r.wavPath.replace(/\.wav$/, ".json"), "utf8"));
    expect(meta.beatsMs).toEqual(r.beatsMs);
    expect(meta.instruments).toEqual(["bass", "hat", "kick", "pad"]);
  }, 60_000);

  it("loops seamlessly at the bar boundary", async () => {
    const r = await generateMusic(TENSE, ctx);
    const w = await readWav(r.wavPath);
    for (const c of w.data) {
      const N = c.length;
      let typical = 0;
      for (let i = 1; i < N; i++) typical += Math.abs(c[i]! - c[i - 1]!);
      typical /= N - 1;
      expect(Math.abs(c[0]! - c[N - 1]!)).toBeLessThan(6 * typical);
    }
  }, 60_000);

  it("is deterministic and cached by content hash", async () => {
    const a = await generateMusic(TENSE, ctx);
    const other = makeCtx();
    const b = await generateMusic(TENSE, other);
    expect(await sha256File(a.wavPath)).toBe(await sha256File(b.wavPath));
    const t0 = performance.now();
    await generateMusic(TENSE, other);
    expect(performance.now() - t0).toBeLessThan(500);
    expect(musicHash({ ...TENSE, seed: 1 })).not.toBe(musicHash(TENSE));
    expect(musicHash({ ...TENSE, energy: "low" })).not.toBe(musicHash(TENSE));
  }, 60_000);

  it("renders every mood/energy without clipping", async () => {
    for (const mood of ["ominous", "sad", "uplifting", "mysterious", "epic", "chill", "comedic", "none"] as const) {
      const r = await generateMusic({ mood, energy: mood === "epic" ? "high" : "low", bpm: MOOD_BPM[mood], bars: 4, seed: 7, key: "D minor" }, ctx);
      const w = await readWav(r.wavPath);
      let pk = 0;
      for (const c of w.data) for (const v of c) pk = Math.max(pk, Math.abs(v));
      expect(pk).toBeLessThan(0.9);
      expect(pk).toBeGreaterThan(0.01);
    }
  }, 120_000);

  it("chooses instruments, loops and keys per §11.3", () => {
    expect(instrumentsFor("tense", "mid")).toEqual(new Set(["pad", "bass", "kick", "hat"]));
    expect(instrumentsFor("sad", "low")).toEqual(new Set(["pad"]));
    expect(instrumentsFor("mysterious", "low").has("arp")).toBe(true);
    expect(instrumentsFor("ominous", "low").has("drone")).toBe(true);
    expect(instrumentsFor("uplifting", "high").has("kick")).toBe(true);
    expect(tonicMidi("A minor", "minor") % 12).toBe(9);
    expect(tonicMidi("A minor", "major") % 12).toBe(0); // relative major
    expect(tonicMidi("C major", "minor") % 12).toBe(9); // relative minor
  });

  it("rejects invalid requests", async () => {
    await expect(generateMusic({ ...TENSE, bpm: 10 }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(generateMusic({ ...TENSE, bars: 0 }, ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
