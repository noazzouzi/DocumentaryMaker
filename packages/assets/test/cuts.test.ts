// Shot-boundary snap for clip passages: scdet fallback, the `cuts` sidecar (python/docmaker_sidecar/cmd_cuts.py), snap rules.
import { execFileSync } from "node:child_process";
import { mkdirSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detectCuts, parseScdet, snapToCuts } from "../src/youtube/cuts";
import { cleanup, makeConfig, tmpDir } from "./helpers";

const dir = tmpDir("cuts");
const video = path.join(dir, "shots.mp4");
// Three shots: testsrc 0–2 s, solid red 2–3.5 s, mandelbrot 3.5–5.5 s.
execFileSync("ffmpeg", [
  "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=2", "-f", "lavfi", "-i", "color=c=red:s=320x180:r=25:d=1.5",
  "-f", "lavfi", "-i", "mandelbrot=s=320x180:r=25", "-filter_complex", "[2]trim=duration=2,setpts=PTS-STARTPTS[m];[0][1][m]concat=n=3:v=1",
  "-pix_fmt", "yuv420p", video,
]);
afterAll(() => cleanup(dir));

const near = (xs: number[], t: number, tol = 60) => xs.some((x) => Math.abs(x - t) <= tol);

describe("snapToCuts", () => {
  const match = { startMs: 2300, endMs: 4800 };
  it("moves edges onto cuts within ±500 ms, never into the matched words", () => {
    expect(snapToCuts({ startMs: 2000 - 300, endMs: 5100 }, match, [2000, 5400])).toEqual({ startMs: 2000, endMs: 5400 });
    expect(snapToCuts({ startMs: 2000, endMs: 5100 }, match, [2400, 4700])).toEqual({ startMs: 2000, endMs: 5100 }); // inside the words
    expect(snapToCuts({ startMs: 2000, endMs: 5100 }, match, [1200, 6000])).toEqual({ startMs: 2000, endMs: 5100 }); // too far
    expect(snapToCuts({ startMs: 2000, endMs: 5100 }, match, [1700, 1900, 5000, 5300])).toEqual({ startMs: 1900, endMs: 5000 }); // nearest
    expect(snapToCuts({ startMs: 2000, endMs: 5100 }, match, [])).toEqual({ startMs: 2000, endMs: 5100 });
  });
  it("parses scdet logs onto the source clock", () => {
    const log = "[scdet @ 0x1] lavfi.scd.score: 21.654, lavfi.scd.time: 1.5\n[scdet @ 0x1] lavfi.scd.score: 40.1, lavfi.scd.time: 3\n";
    expect(parseScdet(log, 500)).toEqual([2000, 3500]);
  });
});

describe("detectCuts", () => {
  it("scdet fallback finds both cuts inside the window (no Python venv)", async () => {
    const config = makeConfig();
    const cuts = await detectCuts(video, 1000, 5000, { config, signal: new AbortController().signal });
    expect(near(cuts, 2000)).toBe(true);
    expect(near(cuts, 3500)).toBe(true);
    expect(cuts.every((t) => t > 1000 && t <= 5000)).toBe(true);
    cleanup(config.paths.home);
  });
  it("the cuts sidecar (cmd_cuts.py) gives the same boundaries", async () => {
    const config = makeConfig();
    mkdirSync(path.join(config.paths.pyVenv, "bin"), { recursive: true });
    symlinkSync(execFileSync("sh", ["-c", "command -v python3"]).toString().trim(), path.join(config.paths.pyVenv, "bin", "python"));
    const cuts = await detectCuts(video, 1000, 3000, { config, signal: new AbortController().signal });
    expect(near(cuts, 2000, 40)).toBe(true);
    expect(near(cuts, 3500)).toBe(false); // outside the window
    cleanup(config.paths.home);
  }, 60_000);
});
