// packages/core/src/node/loudness.ts — the ONE loudness implementation (EBU R128 via ffmpeg; two-pass loudnorm).
import type { RuntimeConfig } from "../interfaces";
import { DocmakerError } from "../util/errors";
import { run } from "./proc";

export interface Ebur128 { integratedLufs: number; truePeakDbtp: number; lra: number; samplePeakDbfs: number }

const FLOOR = -144;
function parseNum(s: string | undefined): number {
  if (s === undefined) return NaN;
  if (/^-?inf/i.test(s.trim())) return s.trim().startsWith("-") ? FLOOR : -FLOOR;
  return Number(s);
}

/** Parses the ebur128 filter summary printed on stderr. */
export function parseEbur128Summary(stderr: string): Ebur128 {
  const i = stderr.lastIndexOf("Summary:");
  const s = i >= 0 ? stderr.slice(i) : stderr;
  const I = /Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+|-?inf)\s*LUFS/i.exec(s)?.[1];
  const LRA = /Loudness range:\s*\n\s*LRA:\s*(-?[\d.]+|-?inf)\s*LU/i.exec(s)?.[1];
  const SP = /Sample peak:\s*\n\s*Peak:\s*(-?[\d.]+|-?inf)\s*dBFS/i.exec(s)?.[1];
  const TP = /True peak:\s*\n\s*Peak:\s*(-?[\d.]+|-?inf)\s*dBFS/i.exec(s)?.[1];
  const r = { integratedLufs: parseNum(I), lra: parseNum(LRA), samplePeakDbfs: parseNum(SP), truePeakDbtp: parseNum(TP) };
  if (!Number.isFinite(r.integratedLufs) || !Number.isFinite(r.truePeakDbtp)) {
    throw new DocmakerError("INTERNAL", "could not parse the ebur128 summary", { details: { tail: s.slice(-800) } });
  }
  if (!Number.isFinite(r.lra)) r.lra = 0;
  if (!Number.isFinite(r.samplePeakDbfs)) r.samplePeakDbfs = r.truePeakDbtp;
  return r;
}

/** ffmpeg ebur128=peak=sample+true:framelog=quiet on the first audio stream. */
export async function measureEbur128(path: string, opts: { config: RuntimeConfig; signal: AbortSignal; stream?: "a:0" }): Promise<Ebur128> {
  const r = await run(opts.config.ffmpeg, [
    "-hide_banner", "-nostats", "-nostdin", "-i", path, "-map", `0:${opts.stream ?? "a:0"}`,
    "-af", "ebur128=peak=sample+true:framelog=quiet", "-f", "null", "-",
  ], { signal: opts.signal });
  if (r.code !== 0) throw new DocmakerError("INTERNAL", `ebur128 measurement failed (code ${r.code})`, { details: { tail: r.stderr.slice(-800) } });
  return parseEbur128Summary(r.stderr);
}

function lastJsonBlock(stderr: string): Record<string, string> {
  const end = stderr.lastIndexOf("}");
  const start = stderr.lastIndexOf("{", end);
  if (start < 0 || end < 0) throw new DocmakerError("INTERNAL", "loudnorm printed no JSON", { details: { tail: stderr.slice(-800) } });
  return JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
}

/** Two-pass loudnorm (pass 2 linear=true; asserts normalization_type == "linear", else retries with dynamic and reports it). */
export async function twoPassLoudnorm(input: string, output: string, opts: {
  I: number; TP: number; LRA: number; sampleRate: 48000; channels: 1 | 2; codec: "pcm_s16le" | "pcm_s24le" | "aac";
  config: RuntimeConfig; signal: AbortSignal; extraInputArgs?: string[];
}): Promise<{ measured: Ebur128; normalizationType: "linear" | "dynamic" }> {
  const target = `I=${opts.I}:TP=${opts.TP}:LRA=${opts.LRA}`;
  const pre = ["-hide_banner", "-nostats", "-nostdin", ...(opts.extraInputArgs ?? []), "-i", input];
  const p1 = await run(opts.config.ffmpeg, [...pre, "-map", "0:a:0", "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { signal: opts.signal });
  if (p1.code !== 0) throw new DocmakerError("INTERNAL", `loudnorm pass 1 failed (code ${p1.code})`, { details: { tail: p1.stderr.slice(-800) } });
  const m = lastJsonBlock(p1.stderr);
  const measuredArgs = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}`;
  const pass2 = async (linear: boolean) => {
    const r = await run(opts.config.ffmpeg, [
      ...pre, "-map", "0:a:0", "-af", `loudnorm=${target}:${measuredArgs}:linear=${linear}:print_format=json`,
      "-ar", String(opts.sampleRate), "-ac", String(opts.channels), "-c:a", opts.codec,
      ...(opts.codec === "aac" ? ["-b:a", "256k"] : []), "-y", output,
    ], { signal: opts.signal });
    if (r.code !== 0) throw new DocmakerError("INTERNAL", `loudnorm pass 2 failed (code ${r.code})`, { details: { tail: r.stderr.slice(-800) } });
    return String(lastJsonBlock(r.stderr).normalization_type ?? "").toLowerCase();
  };
  let type = await pass2(true);
  let normalizationType: "linear" | "dynamic" = "linear";
  if (type !== "linear") {
    type = await pass2(false);
    normalizationType = "dynamic";
  }
  const measured = await measureEbur128(output, { config: opts.config, signal: opts.signal });
  return { measured, normalizationType };
}
