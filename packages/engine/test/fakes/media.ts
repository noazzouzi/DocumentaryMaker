// Small ffmpeg/WAV helpers shared by the walking-skeleton fakes (§16.5). Deterministic outputs.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { RuntimeConfig } from "@docmaker/core";
import { run, sha256File, writeWav } from "@docmaker/core/node";

const NEVER = new AbortController().signal;

export async function ffmpegOk(config: RuntimeConfig, args: string[], signal: AbortSignal = NEVER): Promise<void> {
  const r = await run(config.ffmpeg, ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", ...args], { signal });
  if (r.code !== 0) throw new Error(`ffmpeg failed (${r.code}): ${r.stderr.slice(-600)}`);
}

/** A deterministic 1920×1080 gradient still. */
export async function gradientStill(config: RuntimeConfig, out: string, seed: number, colors: [string, string], signal?: AbortSignal): Promise<void> {
  await mkdir(path.dirname(out), { recursive: true });
  const c = colors.map((x) => "0x" + x.replace(/^#/, ""));
  await ffmpegOk(config, ["-f", "lavfi", "-i", `gradients=s=1920x1080:c0=${c[0]}:c1=${c[1]}:x0=0:y0=0:x1=1919:y1=1079:speed=0.00001:seed=${seed}:duration=1:rate=1`, "-frames:v", "1", "-q:v", "4", out], signal);
}

/** Mono/stereo 48 kHz s16 WAV from a sample generator. */
export async function synthWav(out: string, seconds: number, channels: 1 | 2, gen: (t: number, i: number) => number): Promise<void> {
  await mkdir(path.dirname(out), { recursive: true });
  const n = Math.max(1, Math.round(seconds * 48000));
  const ch = new Float32Array(n);
  for (let i = 0; i < n; i++) ch[i] = Math.max(-1, Math.min(1, gen(i / 48000, i)));
  await writeWav(out, { sampleRate: 48000, channels, data: channels === 1 ? [ch] : [ch, ch.slice()] }, "s16");
}

export { sha256File };
