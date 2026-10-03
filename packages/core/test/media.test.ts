import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { isDocmakerError, type RuntimeConfig } from "../src/index";
import { createWavWriter, ffmpeg, ffprobeJson, killTree, loadRuntime, measureEbur128, parseEbur128Summary, readWav, readWavHeader, run, runSidecar, sha256File, twoPassLoudnorm, writeWav } from "../src/node/index";
import { sha256Hex } from "../src/index";

let dir: string;
let config: RuntimeConfig;
const signal = new AbortController().signal;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "docmaker-media-"));
  config = loadRuntime({ cwd: process.cwd(), env: { ...process.env, DOCMAKER_HOME: path.join(dir, "home") } }).config;
});

const sine = (sr: number, sec: number, hz: number, amp: number) => Float32Array.from({ length: Math.round(sr * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));

describe("wav", () => {
  it("round-trips s16 / s24 / f32 within quantisation error", async () => {
    const data = [sine(48000, 0.25, 440, 0.8), sine(48000, 0.25, 220, -0.5)];
    for (const [fmt, tol] of [["s16", 0.5 / 32768], ["s24", 0.5 / 8388608], ["f32", 1e-7]] as const) {
      const f = path.join(dir, `rt-${fmt}.wav`);
      await writeWav(f, { sampleRate: 48000, channels: 2, data }, fmt);
      const h = await readWavHeader(f);
      expect(h).toMatchObject({ sampleRate: 48000, channels: 2, frames: 12000, durationMs: 250, format: fmt === "f32" ? "float" : "pcm", bitsPerSample: fmt === "s16" ? 16 : fmt === "s24" ? 24 : 32 });
      const back = await readWav(f);
      expect(back.channels).toBe(2);
      let maxErr = 0;
      for (let c = 0; c < 2; c++) for (let i = 0; i < 12000; i++) maxErr = Math.max(maxErr, Math.abs(back.data[c]![i]! - data[c]![i]!));
      expect(maxErr).toBeLessThanOrEqual(tol * 1.01);
      const p = await ffprobeJson(f, { config, signal });
      expect(p.streams[0]).toMatchObject({ codecType: "audio", sampleRate: 48000, channels: 2 });
    }
  });
  it("streaming writer patches the header on close and ffmpeg reads it", async () => {
    const f = path.join(dir, "stream.wav");
    const w = await createWavWriter(f, { sampleRate: 48000, channels: 1, format: "s24" });
    for (let k = 0; k < 4; k++) await w.write([sine(48000, 0.5, 330, 0.3)]);
    await w.close();
    expect((await readWavHeader(f)).frames).toBe(96000);
    const p = await ffprobeJson(f, { config, signal });
    expect(p.durationSec).toBeCloseTo(2, 3);
    expect(sha256Hex(new Uint8Array(await readFile(f)))).toBe(await sha256File(f));
  });
  it("reads ffmpeg-written WAVs (extensible headers, LIST chunks)", async () => {
    const f = path.join(dir, "ff.wav");
    await ffmpeg(["-f", "lavfi", "-i", "sine=frequency=1000:duration=0.5:sample_rate=44100", "-ac", "2", "-c:a", "pcm_s24le", f], { config, signal });
    const w = await readWav(f);
    expect(w.sampleRate).toBe(44100);
    expect(w.channels).toBe(2);
    expect(w.data[0]!.length).toBe(22050);
  });
});

describe("loudness", () => {
  it("twoPassLoudnorm brings a synthetic tone to −18 ± 0.5 LUFS (linear)", async () => {
    // loudnorm only allows linear mode when the measured LRA is non-zero: use a tone whose level steps every second
    const src = path.join(dir, "tone.wav");
    const tone = sine(48000, 8, 440, 1).map((x, i) => x * [0.05, 0.1, 0.07, 0.12][Math.floor(i / 48000) % 4]!);
    await writeWav(src, { sampleRate: 48000, channels: 1, data: [tone] }, "s16");
    const out = path.join(dir, "tone-norm.wav");
    const r = await twoPassLoudnorm(src, out, { I: -18, TP: -1.5, LRA: 11, sampleRate: 48000, channels: 1, codec: "pcm_s16le", config, signal });
    expect(Math.abs(r.measured.integratedLufs - -18)).toBeLessThanOrEqual(0.5);
    expect(r.normalizationType).toBe("linear");
    expect(r.measured.truePeakDbtp).toBeLessThan(-1);
    const m = await measureEbur128(out, { config, signal });
    expect(m.integratedLufs).toBeCloseTo(r.measured.integratedLufs, 1);
    expect((await readWavHeader(out)).sampleRate).toBe(48000);
  }, 60_000);
  it("parses an ebur128 summary", () => {
    const s = `[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -14.2 LUFS\n    Threshold: -24.3 LUFS\n\n  Loudness range:\n    LRA:         5.1 LU\n    Threshold: -34.3 LUFS\n\n  Sample peak:\n    Peak:       -2.0 dBFS\n\n  True peak:\n    Peak:       -1.4 dBFS\n`;
    expect(parseEbur128Summary(s)).toEqual({ integratedLufs: -14.2, lra: 5.1, samplePeakDbfs: -2, truePeakDbtp: -1.4 });
  });
});

describe("proc", () => {
  it("run returns code and output, streams lines and feeds stdin", async () => {
    const lines: string[] = [];
    const r = await run("sh", ["-c", "cat; echo err >&2; exit 3"], { signal, input: "a\nb\n", onStdoutLine: (l) => lines.push(l) });
    expect(r).toEqual({ code: 3, stdout: "a\nb\n", stderr: "err\n" });
    expect(lines).toEqual(["a", "b"]);
  });
  it("missing tools → TOOL_MISSING; abort kills the whole process group", async () => {
    await expect(run("definitely-not-a-tool-xyz", [], { signal })).rejects.toMatchObject({ code: "TOOL_MISSING" });
    const ac = new AbortController();
    const pidFile = path.join(dir, "child.pid");
    const p = run("sh", ["-c", `sleep 30 & echo $! > ${pidFile}; wait`], { signal: ac.signal });
    await new Promise((r) => setTimeout(r, 300));
    const grandchild = Number((await readFile(pidFile, "utf8")).trim());
    ac.abort();
    await expect(p).rejects.toMatchObject({ code: "CANCELED" });
    await new Promise((r) => setTimeout(r, 300));
    // the container's PID 1 may not reap orphans: a zombie (state Z) counts as dead
    let state = "gone";
    try { state = (await readFile(`/proc/${grandchild}/stat`, "utf8")).split(") ")[1]!.slice(0, 1); } catch { /* gone */ }
    expect(["gone", "Z", "X"]).toContain(state);
  });
  it("timeouts reject; killTree tolerates dead pids", async () => {
    await expect(run("sleep", ["5"], { signal, timeoutMs: 200 })).rejects.toSatisfy((e: unknown) => isDocmakerError(e) && /timed out/.test(e.message));
    await killTree(2 ** 22 + 4321);
  });
  it("ffmpeg reports progress and failures; ffprobe counts frames", async () => {
    const f = path.join(dir, "v.mp4");
    const seen: number[] = [];
    await ffmpeg(["-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", f], { config, signal, onProgress: (ms) => seen.push(ms) });
    expect(seen.length).toBeGreaterThan(0);
    const p = await ffprobeJson(f, { config, signal, countFrames: true });
    expect(p.streams[0]).toMatchObject({ codecType: "video", codecName: "h264", width: 320, height: 180, fps: 30, pixFmt: "yuv420p", nbFrames: 60 });
    await expect(ffmpeg(["-i", path.join(dir, "missing.wav"), path.join(dir, "o.wav")], { config, signal })).rejects.toMatchObject({ code: "INTERNAL" });
  }, 60_000);
  it("runSidecar without a venv → TOOL_MISSING", async () => {
    await expect(runSidecar("beats", {}, { config, signal })).rejects.toMatchObject({ code: "TOOL_MISSING" });
  });
  it("runSidecar keeps the dispatcher's error code from out.json (§8.8)", async () => {
    const venv = path.join(dir, "venv");
    const cfg = { ...config, paths: { ...config.paths, pyVenv: venv } } as RuntimeConfig;
    await mkdir(path.join(venv, "bin"), { recursive: true });
    const py = path.join(venv, "bin", "python");
    // fake interpreter: argv = -m docmaker_sidecar <cmd> --in <in> --out <out>
    await writeFile(py, `#!/bin/sh\nprintf '{"error":"MODEL_MISSING","message":"no model"}' > "$7"\necho "ERROR MODEL_MISSING: no model" >&2\nexit 3\n`);
    await chmod(py, 0o755);
    await expect(runSidecar("asr", {}, { config: cfg, signal })).rejects.toMatchObject({ code: "MODEL_MISSING", message: "no model" });
    await writeFile(py, "#!/bin/sh\necho boom >&2\nexit 1\n");
    await expect(runSidecar("asr", {}, { config: cfg, signal })).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
