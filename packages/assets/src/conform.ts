// Conform recipes (§7.5): image-v1, video-cfr-v1, clip-v1, audio-norm-v1 (+ proc-* through the same paths) and analysis.
import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { DocmakerError, sha16 } from "@docmaker/core";
import type { FrozenAsset, RuntimeConfig } from "@docmaker/core";
import { ffmpeg, ffprobeJson, sha256File, twoPassLoudnorm } from "@docmaker/core/node";
import type { AssetsCtx } from "./types";
import { clamp } from "./util";

export interface ConformResult {
  file: string; ext: "jpg" | "png" | "mp4" | "wav"; width: number | null; height: number | null; durationMs: number | null; fps: number | null;
  hasAudio: boolean; lufs: number | null; recipe: string; sourceInMs: number | null; sourceOutMs: number | null;
  handleHeadMs: number; handleTailMs: number; analysis: FrozenAsset["analysis"];
}

export const IMAGE_MAX_EDGE = 2880;
export const CLIP_TARGET_LUFS = -18;
export const DEFAULT_HANDLE_MS = 1000;

type CCtx = Pick<AssetsCtx, "config" | "signal" | "logger">;

// ------------------------------------------------------------------------------------------------ analysis
/** grayscale (mean per-pixel channel spread < 6/255), meanLuma (0..1, Rec.709) from a 64×64 thumbnail. */
export async function analyzePixels(file: string): Promise<{ grayscale: boolean; meanLuma: number }> {
  const { data, info } = await sharp(file).resize(64, 64, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  const n = info.width * info.height;
  let spread = 0;
  let luma = 0;
  for (let i = 0; i < n; i++) {
    const r = data[i * ch]!;
    const g = ch >= 3 ? data[i * ch + 1]! : r;
    const b = ch >= 3 ? data[i * ch + 2]! : r;
    spread += Math.max(r, g, b) - Math.min(r, g, b);
    luma += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return { grayscale: ch < 3 || spread / n < 6, meanLuma: Math.round((luma / n / 255) * 1000) / 1000 };
}

/** Earliest plausible year found in an EXIF block (DateTimeOriginal / DateTime strings "YYYY:MM:DD hh:mm:ss"). */
export function exifYear(exif: Buffer | undefined): number | null {
  if (!exif) return null;
  const s = exif.toString("latin1");
  let best: number | null = null;
  for (const m of s.matchAll(/((?:1[89]|20)\d{2}):[01]\d:[0-3]\d [0-2]\d:[0-5]\d/g)) {
    const y = Number(m[1]);
    if (y >= 1826 && y <= 2100 && (best === null || y < best)) best = y;
  }
  return best;
}

async function outName(src: string, recipe: string, params: unknown, ext: string, outDir: string): Promise<string> {
  const srcSha = await sha256File(src);
  return path.join(outDir, `${sha16(`${srcSha}|${recipe}|${JSON.stringify(params)}`)}.${recipe}.${ext}`);
}

// ------------------------------------------------------------------------------------------------ image-v1
export async function conformImageWith(src: string, outDir: string, ctx: CCtx, o: { recipe: string }): Promise<ConformResult> {
  let input = src;
  let tmp: string | null = null;
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input).metadata();
  } catch {
    // Formats sharp cannot decode (rare): let ffmpeg extract a PNG first.
    tmp = path.join(outDir, `${path.basename(src)}.decode.png`);
    await ffmpeg(["-i", src, "-frames:v", "1", tmp], { config: ctx.config, signal: ctx.signal });
    input = tmp;
    meta = await sharp(input).metadata();
  }
  try {
    const alpha = meta.hasAlpha === true;
    const ext = alpha ? "png" : "jpg";
    const out = await outName(src, o.recipe, { max: IMAGE_MAX_EDGE, alpha }, ext, outDir);
    let pipe = sharp(input, { failOn: "none" }).rotate().resize({ width: IMAGE_MAX_EDGE, height: IMAGE_MAX_EDGE, fit: "inside", withoutEnlargement: true });
    pipe = alpha ? pipe.png({ compressionLevel: 9 }) : pipe.flatten({ background: "#000000" }).jpeg({ quality: 90, chromaSubsampling: "4:4:4" });
    // sharp drops EXIF/XMP by default (no GPS or camera owner data leaves the cache).
    const info = await pipe.toFile(out);
    const px = await analyzePixels(out);
    return {
      file: out, ext, width: info.width, height: info.height, durationMs: null, fps: null, hasAudio: false, lufs: null, recipe: o.recipe,
      sourceInMs: null, sourceOutMs: null, handleHeadMs: 0, handleTailMs: 0,
      analysis: { grayscale: px.grayscale, meanLuma: px.meanLuma, year: exifYear(meta.exif), lowRes: info.width < 1280 },
    };
  } finally {
    if (tmp) await rm(tmp, { force: true });
  }
}

export function conformImage(src: string, outDir: string, ctx: AssetsCtx): Promise<ConformResult> {
  return conformImageWith(src, outDir, ctx, { recipe: "image-v1" });
}

// ------------------------------------------------------------------------------------------------ video-cfr-v1 / clip-v1
const sec = (ms: number) => (ms / 1000).toFixed(3);

/** Source range to keep: wanted [inMs, outMs] plus handles, clamped to the source duration. */
export function trimWindow(durationMs: number, inMs: number | null, outMs: number | null, handleMs: number): { startMs: number; endMs: number; headMs: number; tailMs: number } {
  const d = Math.max(0, Math.round(durationMs));
  if (inMs === null && outMs === null) return { startMs: 0, endMs: d, headMs: 0, tailMs: 0 };
  const wIn = clamp(Math.round(inMs ?? 0), 0, d);
  const wOut = clamp(Math.round(outMs ?? d), wIn, d);
  const startMs = Math.max(0, wIn - handleMs);
  const endMs = Math.min(d, wOut + handleMs);
  return { startMs, endMs, headMs: wIn - startMs, tailMs: endMs - wOut };
}

function videoArgs(fps: number): string[] {
  return [
    "-vf", `fps=${fps},scale='min(1920,trunc(iw/2)*2)':-2:flags=lanczos,format=yuv420p`,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", String(fps), "-keyint_min", String(fps), "-sc_threshold", "0",
  ];
}

async function probeOut(file: string, config: RuntimeConfig, signal: AbortSignal) {
  const p = await ffprobeJson(file, { config, signal });
  const v = p.streams.find((s) => s.codecType === "video");
  const a = p.streams.find((s) => s.codecType === "audio");
  return { p, v, a, durationMs: Math.round((v?.durationSec ?? p.durationSec) * 1000) };
}

async function videoAnalysis(file: string, durationMs: number, width: number | null, ctx: CCtx): Promise<FrozenAsset["analysis"]> {
  const frame = `${file}.analysis.png`;
  try {
    await ffmpeg(["-ss", sec(Math.max(0, durationMs / 2)), "-i", file, "-frames:v", "1", "-vf", "scale=128:-2", frame], { config: ctx.config, signal: ctx.signal });
    const px = await analyzePixels(frame);
    return { grayscale: px.grayscale, meanLuma: px.meanLuma, year: null, lowRes: (width ?? 0) < 1280 };
  } catch (e) {
    ctx.logger.debug("video analysis failed", { error: (e as Error).message });
    return { grayscale: null, meanLuma: null, year: null, lowRes: (width ?? 0) < 1280 };
  } finally {
    await rm(frame, { force: true });
  }
}

export async function conformVideoWith(src: string, outDir: string, o: { fps: number; inMs: number | null; outMs: number | null; handleMs: number; recipe: string }, ctx: CCtx): Promise<ConformResult> {
  const probe = await ffprobeJson(src, { config: ctx.config, signal: ctx.signal });
  if (!probe.streams.some((s) => s.codecType === "video")) throw new DocmakerError("VALIDATION", `${path.basename(src)} has no video stream`);
  const w = trimWindow(probe.durationSec * 1000, o.inMs, o.outMs, o.handleMs);
  if (w.endMs - w.startMs < 100) throw new DocmakerError("VALIDATION", `${path.basename(src)}: empty trim window`);
  const out = await outName(src, o.recipe, { fps: o.fps, ...w }, "mp4", outDir);
  await ffmpeg(["-ss", sec(w.startMs), "-to", sec(w.endMs), "-i", src, ...videoArgs(o.fps), "-movflags", "+faststart", "-an", out], { config: ctx.config, signal: ctx.signal });
  const { v, durationMs } = await probeOut(out, ctx.config, ctx.signal);
  return {
    file: out, ext: "mp4", width: v?.width ?? null, height: v?.height ?? null, durationMs, fps: o.fps, hasAudio: false, lufs: null,
    recipe: o.recipe, sourceInMs: w.startMs, sourceOutMs: w.endMs, handleHeadMs: w.headMs, handleTailMs: w.tailMs,
    analysis: await videoAnalysis(out, durationMs, v?.width ?? null, ctx),
  };
}

export function conformVideo(src: string, outDir: string, o: { fps: number; inMs: number | null; outMs: number | null; handleMs: number }, ctx: AssetsCtx): Promise<ConformResult> {
  return conformVideoWith(src, outDir, { ...o, recipe: "video-cfr-v1" }, ctx);
}

/** clip-v1: CFR H.264 + AAC 192k 48 kHz stereo, two-pass loudnorm to −18 LUFS, trimmed to the passage plus handles. */
export async function conformClip(src: string, outDir: string, o: { fps: number; passageInMs: number; passageOutMs: number; handleMs: number }, ctx: AssetsCtx | CCtx): Promise<ConformResult & { passageInMs: number; passageOutMs: number }> {
  const probe = await ffprobeJson(src, { config: ctx.config, signal: ctx.signal });
  if (!probe.streams.some((s) => s.codecType === "video")) throw new DocmakerError("VALIDATION", `${path.basename(src)} has no video stream`);
  const hasAudioIn = probe.streams.some((s) => s.codecType === "audio");
  const w = trimWindow(probe.durationSec * 1000, o.passageInMs, o.passageOutMs, o.handleMs);
  // The clamped passage itself (not the window with its handles) must be non-trivial: a passage beyond the end is refused.
  const passageMs = (w.endMs - w.tailMs) - (w.startMs + w.headMs);
  if (passageMs < 100 || w.endMs - w.startMs < 100) {
    throw new DocmakerError("VALIDATION", `${path.basename(src)}: passage ${o.passageInMs}–${o.passageOutMs} ms lies outside the media (${Math.round(probe.durationSec * 1000)} ms)`);
  }
  const out = await outName(src, "clip-v1", { fps: o.fps, ...w }, "mp4", outDir);
  const stage1 = `${out}.stage1.mp4`;
  const normWav = `${out}.norm.wav`;
  let lufs: number | null = null;
  try {
    await ffmpeg([
      "-ss", sec(w.startMs), "-to", sec(w.endMs), "-i", src, ...videoArgs(o.fps),
      ...(hasAudioIn ? ["-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2"] : ["-an"]), "-f", "mov", stage1,
    ], { config: ctx.config, signal: ctx.signal });
    if (hasAudioIn) {
      const r = await twoPassLoudnorm(stage1, normWav, { I: CLIP_TARGET_LUFS, TP: -1.5, LRA: 11, sampleRate: 48000, channels: 2, codec: "pcm_s16le", config: ctx.config, signal: ctx.signal });
      lufs = Math.round(r.measured.integratedLufs * 10) / 10;
      await ffmpeg(["-i", stage1, "-i", normWav, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", out], { config: ctx.config, signal: ctx.signal });
    } else {
      await ffmpeg(["-i", stage1, "-map", "0:v:0", "-c:v", "copy", "-movflags", "+faststart", out], { config: ctx.config, signal: ctx.signal });
    }
  } finally {
    await rm(stage1, { force: true });
    await rm(normWav, { force: true });
  }
  const { v, a, durationMs } = await probeOut(out, ctx.config, ctx.signal);
  const passageInMs = w.headMs;
  const passageOutMs = Math.min(durationMs, w.headMs + passageMs);
  return {
    file: out, ext: "mp4", width: v?.width ?? null, height: v?.height ?? null, durationMs, fps: o.fps, hasAudio: a !== undefined, lufs,
    recipe: "clip-v1", sourceInMs: w.startMs, sourceOutMs: w.endMs, handleHeadMs: w.headMs, handleTailMs: w.tailMs,
    analysis: await videoAnalysis(out, durationMs, v?.width ?? null, ctx), passageInMs, passageOutMs,
  };
}

// ------------------------------------------------------------------------------------------------ audio-norm-v1
export async function conformAudio(src: string, outDir: string, o: { targetLufs: number }, ctx: AssetsCtx | CCtx): Promise<ConformResult> {
  const out = await outName(src, "audio-norm-v1", { I: o.targetLufs }, "wav", outDir);
  const r = await twoPassLoudnorm(src, out, { I: o.targetLufs, TP: -1.5, LRA: 11, sampleRate: 48000, channels: 2, codec: "pcm_s16le", config: ctx.config, signal: ctx.signal });
  const { durationMs } = await probeOut(out, ctx.config, ctx.signal);
  return {
    file: out, ext: "wav", width: null, height: null, durationMs, fps: null, hasAudio: true, lufs: Math.round(r.measured.integratedLufs * 10) / 10,
    recipe: "audio-norm-v1", sourceInMs: null, sourceOutMs: null, handleHeadMs: 0, handleTailMs: 0,
    analysis: { grayscale: null, meanLuma: null, year: null, lowRes: false },
  };
}

/** Byte size helper (freeze). */
export async function fileBytes(file: string): Promise<number> {
  return (await stat(file)).size;
}

/** Reads the first bytes (sniffing). */
export async function head(file: string, n = 16): Promise<Buffer> {
  return (await readFile(file)).subarray(0, n);
}
