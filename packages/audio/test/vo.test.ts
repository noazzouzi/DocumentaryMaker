import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { frameToSample48k } from "@docmaker/core";
import type { ProgramLayout } from "@docmaker/core";
import { makeLayout } from "@docmaker/core/testing";
import { measureEbur128, readWav, sha256File, writeWav } from "@docmaker/core/node";
import { assembleVoProgram, planVoParts } from "../src/index";
import { makeCtx, tmpDir } from "./helpers";

const ctx = makeCtx();

/** Speech-like test audio: noise bursts with a syllable-rate envelope (level varies → loudnorm-friendly), seeded. */
function speechLike(n: number, seed: number, amp = 0.3): Float32Array {
  const x = new Float32Array(n);
  let s = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const env = 0.35 + 0.65 * Math.abs(Math.sin((2 * Math.PI * 4 * i) / 48000 + seed));
    x[i] = amp * env * ((s / 4294967296) * 2 - 1);
  }
  return x;
}

/** Writes one WAV per voiced segment; returns the source samples by segment id. */
async function writeSegments(layout: ProgramLayout, projectDir: string, o?: { sampleRate?: number; amp?: number }): Promise<Map<string, Float32Array>> {
  const out = new Map<string, Float32Array>();
  const sr = o?.sampleRate ?? 48000;
  for (const [k, seg] of layout.segments.entries()) {
    if (!seg.voFile) continue;
    const insMs = seg.insertions.reduce((a, x) => a + x.ms, 0);
    const n = Math.round(((seg.endMs - seg.startMs - insMs) * sr) / 1000);
    const x = speechLike(n, 17 + k, o?.amp);
    x[0] = 0.9; // a marker on the first sample of every segment
    out.set(seg.segmentId, x);
    const file = path.join(projectDir, seg.voFile);
    await mkdir(path.dirname(file), { recursive: true });
    await writeWav(file, { sampleRate: sr, channels: 1, data: [x] }, "f32");
  }
  return out;
}

describe("assembleVoProgram", () => {
  it("places every segment sample-exactly at frameToSample48k(from), splits REVEAL insertions with digital silence and bakes −16 LUFS", async () => {
    for (const fps of [24, 25, 30] as const) {
      const projectDir = tmpDir("audio-vo-");
      const layout = makeLayout({ seconds: 40, fps, withReveal: true, withClip: true });
      const withIns = layout.segments.find((s) => s.insertions.length > 0);
      expect(withIns, "the factory layout has a REVEAL insertion").toBeTruthy();
      const src = await writeSegments(layout, projectDir);
      const r = await assembleVoProgram({ layout, projectDir, outRel: "program/en/vo_program.wav" }, ctx);
      const file = path.join(projectDir, "program/en/vo_program.wav");
      expect(r.sha256).toBe(await sha256File(file));
      const w = await readWav(file);
      expect(w.sampleRate).toBe(48000);
      expect(w.channels).toBe(1);
      const L = frameToSample48k(layout.durationInFrames, fps);
      expect(Number.isInteger(L)).toBe(true);
      expect(w.data[0]!.length).toBe(L);
      expect(r.durationMs).toBe(Math.round((L * 1000) / 48000));
      const y = w.data[0]!;
      const g = Math.pow(10, r.bakedGainDb / 20);
      const covered = new Uint8Array(L);
      for (const seg of layout.segments) {
        if (!seg.voFile) continue;
        const x = src.get(seg.segmentId)!;
        const start = frameToSample48k(seg.from, fps);
        let split = x.length, gap = 0;
        if (seg.insertions.length) { split = Math.round((seg.insertions[0]!.splitAtMs * 48000) / 1000); gap = Math.round((seg.insertions[0]!.ms * 48000) / 1000); }
        // exact placement: the marker sample, then a strided comparison of both parts (s24 quantisation: 2^-23)
        expect(Math.abs(y[start]! - 0.9 * g)).toBeLessThan(1e-6);
        expect(Math.abs(y[start - 1] ?? 0)).toBe(0);
        for (let i = 0; i < x.length; i += 97) {
          const at = i < split ? start + i : start + gap + i;
          expect(Math.abs(y[at]! - x[i]! * g)).toBeLessThan(2e-6);
        }
        for (let i = 0; i < x.length; i++) covered[i < split ? start + i : start + gap + i] = 1;
        if (gap) for (let k = start + split; k < start + split + gap; k++) expect(y[k]).toBe(0);
      }
      // digital zero everywhere else
      for (let k = 0; k < L; k++) if (!covered[k]) expect(y[k]).toBe(0);
      const m = await measureEbur128(file, { config: ctx.config, signal: ctx.signal });
      expect(Math.abs(m.integratedLufs - -16)).toBeLessThan(0.5);
    }
  }, 120_000);

  it("guards the sample peak at −1.5 dBFS and reports the gain actually baked", async () => {
    const projectDir = tmpDir("audio-vo-peak-");
    const layout = makeLayout({ seconds: 20, fps: 30 });
    const src = await writeSegments(layout, projectDir, { amp: 0.01 }); // very quiet → large gain → the peak guard wins
    for (const x of src.values()) x[0] = 0.9;
    const r = await assembleVoProgram({ layout, projectDir, outRel: "vo.wav" }, ctx);
    const y = (await readWav(path.join(projectDir, "vo.wav"))).data[0]!;
    let pk = 0;
    for (const v of y) pk = Math.max(pk, Math.abs(v));
    expect(20 * Math.log10(pk)).toBeCloseTo(-1.5, 1);
    expect(r.bakedGainDb).toBeCloseTo(-1.5 - 20 * Math.log10(0.9), 1);
  }, 60_000);

  it("resamples non-48 kHz segments and plans parts deterministically", async () => {
    const projectDir = tmpDir("audio-vo-sr-");
    const layout = makeLayout({ seconds: 15, fps: 25, withReveal: true });
    await writeSegments(layout, projectDir, { sampleRate: 44100 });
    const r = await assembleVoProgram({ layout, projectDir, outRel: "vo.wav" }, ctx);
    expect(r.durationMs).toBe(Math.round((layout.durationInFrames * 1000) / 25));
    const lengths = new Map(layout.segments.filter((s) => s.voFile).map((s) => [path.resolve(projectDir, s.voFile!), 48000] as const));
    const parts = planVoParts(layout, projectDir, lengths);
    expect(parts.length).toBeGreaterThan(0);
    for (const p of parts) expect(p.dst).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("fails with UPSTREAM_MISSING when a segment file is absent, and writes digital silence for a program without voice", async () => {
    const projectDir = tmpDir("audio-vo-missing-");
    const layout = makeLayout({ seconds: 10, fps: 30 });
    await expect(assembleVoProgram({ layout, projectDir, outRel: "vo.wav" }, ctx)).rejects.toMatchObject({ code: "UPSTREAM_MISSING" });
    const silent = { ...layout, segments: layout.segments.map((s) => ({ ...s, voFile: null })) };
    const r = await assembleVoProgram({ layout: silent, projectDir, outRel: "vo.wav" }, ctx);
    expect(r.bakedGainDb).toBe(0);
    const y = (await readWav(path.join(projectDir, "vo.wav"))).data[0]!;
    expect(y.every((v) => v === 0)).toBe(true);
  }, 60_000);
});
