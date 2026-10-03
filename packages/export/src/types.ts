// Public types of @docmaker/export (§4.19) and the conform-map key grammar.
import type { Logger, RuntimeConfig, VisualClip } from "@docmaker/core";

export interface ConformedMedia { assetId: string | null; localPath: string; name: string; kind: "video" | "image" | "audio"; width: number | null; height: number | null; durationFrames: number | null; hasVideo: boolean; hasAudio: boolean; audioChannels: number | null; alpha: boolean }
export type ConformMap = Record<string, ConformedMedia>; // key: assetId | "gen:<clipId>" | "ovl:<itemId>" | "stem:<name>" | "vo:<segmentId>"
export interface ExportCtx { config: RuntimeConfig; logger: Logger; signal: AbortSignal }

/*
 * Conform-map keys (additive to the §4.19 comment):
 *   <assetId>                     audio assets (VO segments, VO program, music, SFX); also an alias of the first framing of a picture asset
 *   pic:<assetId>:<framing>       a picture asset (still or video) framed for 1920×1080 (cover from crop/focal, or blur-pad)
 *   gen:<clipId>                  generated/solid source still
 *   wav:<assetId>                 48 kHz stereo WAV extracted from a clip MP4 (A4)
 *   sfxrl:<assetId>               channel-mirrored SFX for RL pan sweeps
 *   ovl:<itemId>                  ProRes 4444 overlay render (M3)
 *   stem:<vo|music|sfx|clip>      baked stems
 */
const r4 = (n: number) => Number(n.toFixed(4)).toString();

export type PictureFit = "cover" | "blurpad";
export const fitOf = (clip: Pick<VisualClip, "layout">): PictureFit => (clip.layout === "contain-blur" ? "blurpad" : "cover");

export function framingOf(src: { crop: { x: number; y: number; w: number; h: number } | null; focal: { x: number; y: number } }, fit: PictureFit): string {
  const f = src.crop ? `c${r4(src.crop.x)}_${r4(src.crop.y)}_${r4(src.crop.w)}_${r4(src.crop.h)}` : `f${r4(src.focal.x)}_${r4(src.focal.y)}`;
  return fit === "blurpad" ? `${f}_blur` : f;
}

/** Conform-map key of a V1 clip's picture. */
export function pictureKey(clip: Pick<VisualClip, "id" | "source" | "layout">): string {
  const s = clip.source;
  if (s.kind === "image" || s.kind === "video") return `pic:${s.assetId}:${framingOf(s, fitOf(clip))}`;
  return `gen:${clip.id}`;
}
export const clipWavKey = (assetId: string) => `wav:${assetId}`;
export const mirroredSfxKey = (assetId: string) => `sfxrl:${assetId}`;
export const overlayKey = (itemId: string) => `ovl:${itemId}`;
export const stemKey = (name: string) => `stem:${name}`;
export const STEM_NAMES = ["vo", "music", "sfx", "clip"] as const;
