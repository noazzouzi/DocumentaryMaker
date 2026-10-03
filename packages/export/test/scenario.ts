// The brief's 12 s scenario (§13.6, brief §8.6) as an ExportTimeline: 1920×1080, 30 fps, 48 kHz, 360 frames.
//   V1: photo 0–6 s zooming 100→120 %, 1 s centred dissolve, b-roll 6–12 s from source 10 s
//   V2: alpha lower third 7–10 s (opacity fade-in)
//   A1: narration; A2: music at −6 dB, then −18 dB from 1 s to 11 s, then a fade; markers.
import { ExportTimeline } from "@docmaker/core";

export const SCENARIO_ROOT = "/Users/me/DocumentaryMaker/projects/demo";

export function scenario(root = SCENARIO_ROOT): ExportTimeline {
  const m = (id: string, rel: string, o: Partial<ExportTimeline["media"][number]>): ExportTimeline["media"][number] => ({
    id, assetId: null, localPath: `${root}/${rel}`, writtenPath: `${root}/${rel}`, name: rel.split("/").pop()!, kind: "video",
    width: null, height: null, durationFrames: null, hasVideo: false, hasAudio: false, audioChannels: null, alpha: false, ...o,
  });
  return ExportTimeline.parse({
    name: "Demo", lang: "en", fps: { num: 30, den: 1 }, ntsc: false, width: 1920, height: 1080, durationFrames: 360, sampleRate: 48000, tcStartFrames: 0,
    media: [
      m("m001", "media/photo.jpg", { kind: "image", width: 1920, height: 1080, hasVideo: true }),
      m("m002", "media/broll.mp4", { kind: "video", width: 1920, height: 1080, durationFrames: 900, hasVideo: true }),
      m("m003", "render/lowerthird.mov", { kind: "video", width: 1920, height: 1080, durationFrames: 90, hasVideo: true, alpha: true }),
      m("m004", "audio/narration.wav", { kind: "audio", durationFrames: 360, hasAudio: true, audioChannels: 1 }),
      m("m005", "audio/music.wav", { kind: "audio", durationFrames: 3600, hasAudio: true, audioChannels: 2 }),
    ],
    video: [
      {
        name: "V1", enabled: true,
        clips: [
          {
            id: "v:photo", name: "photo", mediaId: "m001", start: 0, duration: 180, sourceIn: 0, enabled: true,
            scale: [{ frame: 0, value: 1, interp: "linear" }, { frame: 195, value: 1.2, interp: "linear" }], position: [], rotation: [], opacity: [], blend: "normal", markers: [],
          },
          {
            id: "v:broll", name: "broll", mediaId: "m002", start: 180, duration: 180, sourceIn: 300, enabled: true,
            scale: [], position: [], rotation: [], opacity: [], blend: "normal",
            markers: [{ frame: 0, duration: 0, name: "B-roll: court footage", note: "source in 00:00:10:00", color: "green" }],
          },
        ],
        transitions: [{ cutFrame: 180, duration: 30, kind: "dissolve" }],
      },
      {
        name: "V2 Graphics", enabled: true,
        clips: [{
          id: "ov:lowerthird", name: "lowerthird", mediaId: "m003", start: 210, duration: 90, sourceIn: 0, enabled: true,
          scale: [], position: [], rotation: [], opacity: [{ frame: 0, value: 0, interp: "linear" }, { frame: 6, value: 1, interp: "linear" }], blend: "normal", markers: [],
        }],
        transitions: [],
      },
    ],
    audio: [
      { name: "A1 VO", role: "dialogue", channels: 1, enabled: true, clips: [{ id: "vo:narration", name: "narration", mediaId: "m004", start: 0, duration: 360, sourceIn: 0, gainDb: [{ frame: 0, value: 0, interp: "linear" }], enabled: true }] },
      {
        name: "A2 Music", role: "music", channels: 2, enabled: true,
        clips: [{
          id: "mus:demo", name: "music", mediaId: "m005", start: 0, duration: 360, sourceIn: 0, enabled: true,
          gainDb: [{ frame: 0, value: -6, interp: "linear" }, { frame: 30, value: -18, interp: "linear" }, { frame: 330, value: -18, interp: "linear" }, { frame: 359, value: -96, interp: "linear" }],
        }],
      },
    ],
    markers: [
      { frame: 0, duration: 0, name: "Hook", note: "Cold open", color: "red" },
      { frame: 210, duration: 90, name: "Lower third", note: "name + title, 3 s", color: "blue" },
    ],
  });
}
