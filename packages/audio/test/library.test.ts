import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ffmpeg, measureEbur128, readWavHeader } from "@docmaker/core/node";
import { generateMusic, gridFromBeats, scanMusicLibrary } from "../src/index";
import { makeCtx, tmpDir } from "./helpers";

const ctx = makeCtx();
const CC0 = { code: "CC0", version: "1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/", commercialOk: true, derivativesOk: true, attributionRequired: false, attributionText: null, restrictions: [] };

/** A python with numpy for the beats sidecar: DOCMAKER_TEST_PYTHON, else a system python3 that imports numpy. */
function numpyPython(): string | null {
  for (const p of [process.env.DOCMAKER_TEST_PYTHON, "python3"]) {
    if (!p) continue;
    try {
      execFileSync(p, ["-c", "import numpy"], { stdio: "ignore" });
      return p.includes("/") ? p : execFileSync("sh", ["-c", `command -v ${p}`]).toString().trim();
    } catch { /* next */ }
  }
  return null;
}

async function tone(file: string, seconds: number, extra: string[] = []) {
  mkdirSync(path.dirname(file), { recursive: true });
  // level-varying signal (two-pass loudnorm stays linear when LRA > 0)
  await ffmpeg(["-f", "lavfi", "-i", `aevalsrc='0.3*sin(2*PI*220*t)*(0.4+0.6*abs(sin(2*PI*0.5*t)))':s=44100:d=${seconds}`, ...extra, file], { config: ctx.config, signal: ctx.signal });
}

describe("scanMusicLibrary", () => {
  it("normalises tracks, reads moods (moods.json, folder) and licences, never defaulting rights", async () => {
    const lib = tmpDir("audio-lib-");
    await tone(path.join(lib, "tense", "Night_Chase-01.wav"), 6);
    await tone(path.join(lib, "misc", "calm.flac"), 5);
    await tone(path.join(lib, "misc", "loose.m4a"), 5, ["-c:a", "aac"]);
    writeFileSync(path.join(lib, "misc", "moods.json"), JSON.stringify({ "calm.flac": ["sad", "Chill", "not-a-mood"] }));
    writeFileSync(path.join(lib, "tense", "license.json"), JSON.stringify(CC0));
    writeFileSync(path.join(lib, "misc", "license.json"), JSON.stringify({ files: { "calm.flac": { ...CC0, code: "CC-BY", attributionRequired: true, attributionText: "Calm by Someone (CC BY 4.0)" } } }));
    writeFileSync(path.join(lib, "notes.txt"), "not audio");
    const tracks = await scanMusicLibrary(lib, ctx);
    expect(tracks.map((t) => t.title)).toEqual(["calm", "loose", "Night Chase 01"]);
    const [calm, loose, chase] = tracks as [typeof tracks[0], typeof tracks[0], typeof tracks[0]];
    expect(chase.moods).toEqual(["tense"]);
    expect(chase.license.code).toBe("CC0");
    expect(calm.moods).toEqual(["sad", "chill"]);
    expect(calm.license.code).toBe("CC-BY");
    expect(loose.moods).toEqual([]); // "misc" is not a mood, no moods.json entry
    expect(loose.license.code).toBe("UNKNOWN");
    expect(loose.license.restrictions).toContain("unknown-rights");
    for (const t of tracks) {
      expect(t.file.startsWith(path.join(ctx.config.paths.cache, "music-norm"))).toBe(true);
      const h = await readWavHeader(t.file);
      expect(h.sampleRate).toBe(48000);
      expect(h.channels).toBe(2);
      expect(h.bitsPerSample).toBe(16);
      expect(Math.abs(t.durationMs - (t.title === "Night Chase 01" ? 6000 : 5000))).toBeLessThan(60);
      const m = await measureEbur128(t.file, { config: ctx.config, signal: ctx.signal });
      expect(Math.abs(m.integratedLufs - -18)).toBeLessThan(1);
    }
    // no sidecar in this home → no grid, but the tracks are usable
    for (const t of tracks) { expect(t.beatsMs).toEqual([]); expect(t.bpm).toBeNull(); }
    // a second scan reuses the normalised files
    const t0 = performance.now();
    const again = await scanMusicLibrary(lib, ctx);
    expect(again.map((t) => t.file)).toEqual(tracks.map((t) => t.file));
    expect(performance.now() - t0).toBeLessThan(5000);
    await expect(scanMusicLibrary(path.join(lib, "nope"), ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  }, 120_000);

  it("builds a steady latency-corrected grid from the tracker output", () => {
    const g = gridFromBeats({ duration: 10, bpm: 120, period: 0.5, phase: 0.24, beats: [{ t: 0.24, n: 0, bar_pos: 3 }, { t: 0.74, n: 1, bar_pos: 0 }] }, 3000);
    expect(g.beatsMs).toEqual([250, 750, 1250, 1750, 2250, 2750]);
    expect(g.downbeatsMs).toEqual([750, 2750]);
    expect(gridFromBeats({ duration: 1, bpm: 0, period: 0, phase: 0, beats: [] }, 1000).beatsMs).toEqual([]);
  });

  const py = numpyPython();
  it.skipIf(!py)("finds the tempo and downbeats of a procedural kick track with the beats sidecar", async () => {
    const c = makeCtx();
    mkdirSync(path.join(c.config.paths.pyVenv, "bin"), { recursive: true });
    // a wrapper, not a symlink: a symlinked venv interpreter would lose its site-packages
    writeFileSync(path.join(c.config.paths.pyVenv, "bin", "python"), `#!/bin/sh\nexec "${py}" "$@"\n`, { mode: 0o755 });
    const m = await generateMusic({ mood: "tense", energy: "high", bpm: 95, bars: 16, seed: 3, key: "E minor" }, c);
    const lib = tmpDir("audio-lib-beats-");
    mkdirSync(path.join(lib, "tense"));
    await ffmpeg(["-i", m.wavPath, "-c:a", "pcm_s16le", path.join(lib, "tense", "bed.wav")], { config: c.config, signal: c.signal });
    const [t] = await scanMusicLibrary(lib, c);
    expect(t!.bpm).toBeCloseTo(95, 0);
    // every detected beat is within 25 ms of a true beat; downbeats are every 4th beat (bar phase is a heuristic)
    for (const d of t!.beatsMs) {
      const nearest = Math.min(...m.beatsMs.map((x) => Math.abs(x - d)));
      expect(nearest, `beat ${d}`).toBeLessThanOrEqual(25);
    }
    expect(t!.beatsMs.length).toBeGreaterThanOrEqual(60);
    const k0 = t!.beatsMs.indexOf(t!.downbeatsMs[0]!);
    expect(t!.downbeatsMs).toEqual(t!.beatsMs.filter((_, k) => k >= k0 && (k - k0) % 4 === 0));
  }, 180_000);
});
