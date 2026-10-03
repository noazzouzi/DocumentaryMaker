import path from "node:path";
import { describe, expect, it } from "vitest";
import { measureEbur128 } from "@docmaker/core/node";
import { gateGainDb, gatePasses, loudnessGate } from "../src/loudnessGate";
import { ffmpegSync, probeJson, testConfig, tmpDir } from "./helpers";

const signal = new AbortController().signal;

/** A short MP4 (video + AAC) whose music-like audio is normalised to `lufs` with peaks near `peakDb`. */
function hotMp4(file: string, o: { seconds: number; gainDb: number }): void {
  // level-varying tones (an amplitude-modulated chord) so loudness is realistic and true peaks overshoot after AAC
  ffmpegSync([
    "-f", "lavfi", "-i", `color=c=black:s=64x36:r=30:d=${o.seconds}`,
    "-f", "lavfi", "-i", `aevalsrc='0.45*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.7*t))+0.35*sin(2*PI*1650*t)*(0.5+0.5*sin(2*PI*3.1*t))+0.2*sin(2*PI*5300*t)':s=48000:d=${o.seconds}`,
    "-filter:a", `volume=${o.gainDb}dB`, "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-b:a", "256k", "-ac", "2",
    "-shortest", "-movflags", "+faststart", file,
  ]);
}

describe("loudness gate math", () => {
  it("gain = gate − TP − 0.3 dB, 0 when already under the gate", () => {
    expect(gateGainDb(0.5, -1)).toBe(-1.8);
    expect(gateGainDb(-0.4, -1)).toBe(-0.9);
    expect(gateGainDb(-1, -1)).toBe(0);
    expect(gateGainDb(-3, -1)).toBe(0);
  });
  it("passes only under the gate and within ±1 LU of the target", () => {
    expect(gatePasses({ integratedLufs: -14.4, truePeakDbtp: -1.3 }, -1, -14)).toBe(true);
    expect(gatePasses({ integratedLufs: -14, truePeakDbtp: -0.9 }, -1, -14)).toBe(false);
    expect(gatePasses({ integratedLufs: -15.2, truePeakDbtp: -2 }, -1, -14)).toBe(false);
  });
});

describe("loudnessGate on a synthetic AAC file", () => {
  it("brings a hot file under the gate and keeps the video stream", async () => {
    const t = await tmpDir();
    try {
      const config = testConfig(t.dir);
      const mp4 = path.join(t.dir, "hot.mp4");
      hotMp4(mp4, { seconds: 4, gainDb: 3 });
      const before = await measureEbur128(mp4, { config, signal });
      expect(before.truePeakDbtp).toBeGreaterThan(-1);
      const r = await loudnessGate(mp4, { gateDbtp: -1, targetLufs: before.integratedLufs - 1.5, config, signal });
      expect(r.attempts).toBeGreaterThanOrEqual(1);
      expect(r.attempts).toBeLessThanOrEqual(2);
      expect(r.truePeakDbtp).toBeLessThanOrEqual(-1);
      const after = await measureEbur128(mp4, { config, signal });
      expect(after.truePeakDbtp).toBeCloseTo(r.truePeakDbtp, 5);
      expect(r.ok).toBe(Math.abs(r.integratedLufs - (before.integratedLufs - 1.5)) <= 1);
      const p = probeJson(mp4);
      expect(p.streams.map((s) => s.codec_type).sort()).toEqual(["audio", "video"]);
      expect(Number(p.format.duration)).toBeCloseTo(4, 1);
    } finally {
      await t.cleanup();
    }
  });

  it("leaves a compliant file untouched (0 attempts)", async () => {
    const t = await tmpDir();
    try {
      const config = testConfig(t.dir);
      const mp4 = path.join(t.dir, "ok.mp4");
      hotMp4(mp4, { seconds: 3, gainDb: -12 });
      const before = await measureEbur128(mp4, { config, signal });
      const r = await loudnessGate(mp4, { gateDbtp: -1, targetLufs: before.integratedLufs, config, signal });
      expect(r.attempts).toBe(0);
      expect(r.ok).toBe(true);
      expect(r.truePeakDbtp).toBeCloseTo(before.truePeakDbtp, 5);
    } finally {
      await t.cleanup();
    }
  });
});
