import { z } from "zod";
import { AssetId, Frame, Lang, PosFrames } from "./common";
import { MarkerColor } from "./timeline";

export const Keyframe = z.object({ frame: Frame, value: z.number(), interp: z.enum(["linear", "hold"]) }); // frame is CLIP-LOCAL
export const Keyframe2 = z.object({ frame: Frame, x: z.number(), y: z.number(), interp: z.enum(["linear", "hold"]) });
export const ExportMarker = z.object({ frame: Frame, duration: Frame, name: z.string(), note: z.string(), color: MarkerColor });
export const ExportMedia = z.object({
  id: z.string(), // "m001"
  assetId: AssetId.nullable(),
  localPath: z.string(), // absolute path on the machine that ran the export (conformed copy in export/<lang>/media/)
  writtenPath: z.string(), // path written into XML/OTIO after exportRoot remap
  name: z.string(), // unique ASCII-safe file name "012_tulip-auction_ab12cd34.jpg"
  kind: z.enum(["video", "image", "audio"]),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationFrames: Frame.nullable(), // null for stills
  hasVideo: z.boolean(),
  hasAudio: z.boolean(),
  audioChannels: z.number().int().nullable(),
  alpha: z.boolean(), // ProRes 4444 overlays
});
export const ExportClip = z.object({
  id: z.string(),
  name: z.string(),
  mediaId: z.string(),
  start: Frame, // timeline frame (cut frame, no handles)
  duration: PosFrames,
  sourceIn: Frame, // media frame
  enabled: z.boolean(),
  scale: z.array(Keyframe), // [] = 1.0 (multiplier of conformed 1920×1080 media)
  position: z.array(Keyframe2), // px offset of centre, +y down; [] = (0,0)
  rotation: z.array(Keyframe), // deg, CSS clockwise
  opacity: z.array(Keyframe), // 0..1
  blend: z.enum(["normal", "screen", "add", "multiply", "overlay"]),
  markers: z.array(ExportMarker),
});
/** duration is EVEN (Timeline overlap durations are even), so cutFrame ± duration/2 are integer frames in every writer. */
export const ExportTransition = z.object({ cutFrame: Frame, duration: PosFrames.multipleOf(2), kind: z.enum(["dissolve", "dipToBlack"]) });
export const ExportVideoTrack = z.object({ name: z.string(), enabled: z.boolean(), clips: z.array(ExportClip), transitions: z.array(ExportTransition) });
export const ExportAudioClip = z.object({
  id: z.string(), name: z.string(), mediaId: z.string(), start: Frame, duration: PosFrames, sourceIn: Frame,
  gainDb: z.array(Keyframe), // dB; a single keyframe = constant level
  enabled: z.boolean(),
});
export const ExportAudioTrack = z.object({
  name: z.string(),
  role: z.enum(["dialogue", "music", "effects", "clip", "stem"]),
  channels: z.union([z.literal(1), z.literal(2)]),
  enabled: z.boolean(),
  clips: z.array(ExportAudioClip),
});
export const ExportTimeline = z.object({
  name: z.string(),
  lang: Lang,
  fps: z.object({ num: z.number().int().positive(), den: z.number().int().positive() }), // 30/1; 29.97 = 30000/1001
  ntsc: z.boolean(),
  width: z.number().int(),
  height: z.number().int(),
  durationFrames: PosFrames,
  sampleRate: z.literal(48000),
  tcStartFrames: z.literal(0), // 00:00:00:00 NDF everywhere (XML, OTIO, marker EDL)
  media: z.array(ExportMedia),
  video: z.array(ExportVideoTrack), // [0] = V1 spine (contiguous), [1..] = overlays (alpha)
  audio: z.array(ExportAudioTrack), // A1 VO, A2 music, A3 SFX, A4 clip audio, A5–A8 baked stems (disabled)
  markers: z.array(ExportMarker),
});
export type ExportTimeline = z.infer<typeof ExportTimeline>;

// ---- inferred types (one per schema constant)
export type Keyframe = z.infer<typeof Keyframe>;
export type Keyframe2 = z.infer<typeof Keyframe2>;
export type ExportMarker = z.infer<typeof ExportMarker>;
export type ExportMedia = z.infer<typeof ExportMedia>;
export type ExportClip = z.infer<typeof ExportClip>;
export type ExportTransition = z.infer<typeof ExportTransition>;
export type ExportVideoTrack = z.infer<typeof ExportVideoTrack>;
export type ExportAudioClip = z.infer<typeof ExportAudioClip>;
export type ExportAudioTrack = z.infer<typeof ExportAudioTrack>;
