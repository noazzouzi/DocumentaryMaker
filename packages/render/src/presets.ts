// Render presets (§12.2) and the options every Remotion call carries.
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import type { RenderPresetId, RuntimeConfig } from "@docmaker/core";
import { parseEnvFile } from "@docmaker/core/node";

export type GlMode = "swangle" | "angle" | "angle-egl";
export type PresetId = RenderPresetId | "overlay";

export interface PresetSpec {
  id: PresetId;
  scale: number;
  codec: "h264-ts" | "prores";
  x264Preset: "veryfast" | "medium" | null;
  crf: number | null;
  imageFormat: "jpeg" | "png";
  jpegQuality: number | null;
  /** ffmpeg master post (lut3d + grain) applies to this preset. */
  post: boolean;
  proResProfile: "4444" | null;
  pixelFormat: "yuv420p" | "yuva444p10le";
}

export const PRESETS: Record<PresetId, PresetSpec> = {
  draft: { id: "draft", scale: 0.5, codec: "h264-ts", x264Preset: "veryfast", crf: 23, imageFormat: "jpeg", jpegQuality: 80, post: false, proResProfile: null, pixelFormat: "yuv420p" },
  master: { id: "master", scale: 1, codec: "h264-ts", x264Preset: "medium", crf: 18, imageFormat: "jpeg", jpegQuality: 92, post: true, proResProfile: null, pixelFormat: "yuv420p" },
  overlay: { id: "overlay", scale: 1, codec: "prores", x264Preset: null, crf: null, imageFormat: "png", jpegQuality: null, post: false, proResProfile: "4444", pixelFormat: "yuva444p10le" },
};

/** The renderMedia options a preset maps to (GPU hosts: hardware acceleration if possible + 10M bitrate for master). */
export interface PresetRenderOptions {
  codec: "h264-ts" | "prores"; scale: number; imageFormat: "jpeg" | "png"; pixelFormat: "yuv420p" | "yuva444p10le"; muted: true;
  jpegQuality?: number; x264Preset?: "veryfast" | "medium"; proResProfile?: "4444"; crf?: number;
  hardwareAcceleration?: "if-possible"; videoBitrate?: string;
}
export function presetRenderOptions(preset: PresetId, o: { gpu: boolean }): PresetRenderOptions {
  const p = PRESETS[preset];
  const out: PresetRenderOptions = { codec: p.codec, scale: p.scale, imageFormat: p.imageFormat, pixelFormat: p.pixelFormat, muted: true };
  if (p.jpegQuality !== null) out.jpegQuality = p.jpegQuality;
  if (p.x264Preset) out.x264Preset = p.x264Preset;
  if (p.proResProfile) out.proResProfile = p.proResProfile;
  if (preset === "master" && o.gpu) {
    out.hardwareAcceleration = "if-possible";
    out.videoBitrate = "10M"; // Remotion refuses crf together with a bitrate
  } else if (p.crf !== null) {
    out.crf = p.crf;
  }
  return out;
}

/** Final output size of a preset (even dimensions, as x264 requires). */
export function presetSize(preset: PresetId, width = 1920, height = 1080): { width: number; height: number } {
  const s = PRESETS[preset].scale;
  const even = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2);
  return { width: even(width), height: even(height) };
}

export const MAX_CONCURRENCY = 4;
export function resolveConcurrency(requested: number | null | undefined): number {
  const cores = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  const auto = Math.max(1, Math.min(cores, MAX_CONCURRENCY));
  if (requested === null || requested === undefined || !Number.isFinite(requested) || requested < 1) return auto;
  return Math.max(1, Math.min(Math.floor(requested), Math.max(cores, 1)));
}

/** REMOTION_LICENSE_KEY from the environment or <home>/.env (never logged). */
export function remotionLicenseKey(config: RuntimeConfig): string | null {
  const env = process.env.REMOTION_LICENSE_KEY;
  if (env) return env;
  try {
    if (existsSync(config.paths.envFile)) return parseEnvFile(readFileSync(config.paths.envFile, "utf8")).REMOTION_LICENSE_KEY || null;
  } catch {
    /* unreadable .env: no key */
  }
  return null;
}

export const TIMEOUT_MS = 120_000;

/** Options shared by every selectComposition/renderMedia/renderStill call. */
export function commonRemotionOptions(browserExecutable: string, gl: GlMode, config: RuntimeConfig, timeoutInMilliseconds = TIMEOUT_MS) {
  const licenseKey = remotionLicenseKey(config);
  return {
    browserExecutable,
    chromiumOptions: { gl },
    timeoutInMilliseconds,
    logLevel: "warn" as const,
    ...(licenseKey ? { licenseKey } : {}),
  };
}
