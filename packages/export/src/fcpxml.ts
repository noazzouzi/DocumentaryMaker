// FCPXML 1.10 / 1.11 / 1.13 writer (§13.3). Port of the validated prototype ($SP/npmtest/gen.mjs, $SP/tl/examples/demo.fcpxml).
// V1 = spine (video for stills, asset-clip for movies) with centred Cross Dissolves; every other track is a connected
// clip anchored in the spine item that contains its start (lane ≥ 1 video, ≤ −1 audio), offsets in the parent's local
// time (parent.start + (frame − parent.offset)); markers live inside spine items at local time.
import { create } from "xmlbuilder2";
import type { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import type { ExportAudioTrack, ExportClip, ExportMarker, ExportMedia, ExportTimeline, Keyframe, Keyframe2 } from "@docmaker/core";
import { fileUrl } from "./paths";
import { cleanText, fmt, rationalTime, stem } from "./util";

export const CROSS_DISSOLVE_UID = "FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265";
const BLEND_MODE: Record<ExportClip["blend"], number | null> = { normal: null, screen: 10, add: 8, multiply: 4, overlay: 14 };
const ROLE: Record<ExportAudioTrack["role"], string> = { dialogue: "dialogue", music: "music", effects: "effects", clip: "dialogue", stem: "effects" };
const STEM_ROLE: Record<string, string> = { vo: "dialogue", music: "music", sfx: "effects", clip: "dialogue" };

export function fcpFormatName(et: ExportTimeline): string {
  const r = et.fps.num / et.fps.den;
  const label = Number.isInteger(r) ? String(r) : (Math.round(r * 100) / 100).toFixed(2).replace(".", "").replace(/0$/, "");
  return `FFVideoFormat${et.height}p${label}`;
}

interface SpineItem { clip: ExportClip; media: ExportMedia; still: boolean; srcStart: number; el: XMLBuilder | null }

export function writeFcpxml(et: ExportTimeline, o: { version: "1.10" | "1.11" | "1.13" }): string {
  const T = (f: number) => rationalTime(f, et.fps);
  const mediaById = new Map(et.media.map((m) => [m.id, m]));
  const v1 = et.video[0] ?? { name: "V1", enabled: true, clips: [], transitions: [] };
  const transitionAt = new Map(v1.transitions.map((t) => [t.cutFrame, t]));
  const STILL_START = Math.round((3600 * et.fps.num) / et.fps.den); // frames in 3600 s (head handles for stills)

  const doc = create({ version: "1.0", encoding: "UTF-8" }).dtd({ name: "fcpxml" }).ele("fcpxml", { version: o.version });
  const res = doc.ele("resources");
  res.ele("format", {
    id: "r1", name: fcpFormatName(et), frameDuration: T(1), width: et.width, height: et.height, colorSpace: "1-1-1 (Rec. 709)",
  });
  let nextId = 2;
  const hasStill = et.media.some((m) => m.kind === "image");
  const stillFormat = hasStill ? `r${nextId++}` : null;
  if (stillFormat) res.ele("format", { id: stillFormat, name: "FFVideoFormatRateUndefined", width: et.width, height: et.height, colorSpace: "1-13-1" });
  const assetRef = new Map<string, string>();
  for (const m of et.media) {
    const id = `r${nextId++}`;
    assetRef.set(m.id, id);
    const a: Record<string, string | number> = { id, name: stem(m.name), start: "0s" };
    if (m.kind === "image") {
      Object.assign(a, { duration: "0s", hasVideo: 1, format: stillFormat!, videoSources: 1 });
    } else {
      if (m.durationFrames !== null) a.duration = T(m.durationFrames);
      if (m.hasVideo && m.kind === "video") Object.assign(a, { hasVideo: 1, format: "r1", videoSources: 1 });
      if (m.hasAudio) Object.assign(a, { hasAudio: 1, audioSources: 1, audioChannels: m.audioChannels ?? 2, audioRate: 48000 });
    }
    res.ele("asset", a).ele("media-rep", { kind: "original-media", src: fileUrl(m.writtenPath) });
  }
  const dissolveRef = v1.transitions.length ? `r${nextId++}` : null;
  if (dissolveRef) res.ele("effect", { id: dissolveRef, name: "Cross Dissolve", uid: CROSS_DISSOLVE_UID });

  const seq = doc.ele("library").ele("event", { name: "DocumentaryMaker" }).ele("project", { name: cleanText(et.name) })
    .ele("sequence", { format: "r1", duration: T(et.durationFrames), tcStart: "0s", tcFormat: "NDF", audioLayout: "stereo", audioRate: "48k" });
  const spine = seq.ele("spine");

  // ---- spine items (children are appended in DTD order after all anchors/markers are known)
  const items: SpineItem[] = v1.clips.map((clip) => {
    const media = mediaById.get(clip.mediaId)!;
    const still = media.kind === "image";
    const srcStart = still ? (transitionAt.has(clip.start) ? STILL_START : 0) : clip.sourceIn;
    return { clip, media, still, srcStart, el: null };
  });
  const parentAt = (frame: number): SpineItem | null => {
    if (!items.length) return null;
    for (const it of items) if (frame >= it.clip.start && frame < it.clip.start + it.clip.duration) return it;
    return frame < items[0]!.clip.start ? items[0]! : items[items.length - 1]!;
  };
  const local = (p: SpineItem, frame: number) => p.srcStart + (frame - p.clip.start);

  const anchors = new Map<SpineItem, ((el: XMLBuilder) => void)[]>();
  const markers = new Map<SpineItem, { start: number; m: ExportMarker }[]>();
  const pushAnchor = (p: SpineItem, fn: (el: XMLBuilder) => void) => anchors.set(p, [...(anchors.get(p) ?? []), fn]);
  const pushMarker = (p: SpineItem, start: number, m: ExportMarker) => markers.set(p, [...(markers.get(p) ?? []), { start, m }]);

  // connected video (lanes 1..n)
  et.video.slice(1).forEach((track, ti) => {
    for (const c of track.clips) {
      const p = parentAt(c.start);
      if (!p) continue;
      const m = mediaById.get(c.mediaId)!;
      pushAnchor(p, (el) => {
        const still = m.kind === "image";
        const a: Record<string, string | number> = { ref: assetRef.get(m.id)!, lane: ti + 1, name: cleanText(c.name), offset: T(local(p, c.start)), start: T(still ? 0 : c.sourceIn), duration: T(c.duration) };
        if (!c.enabled || !track.enabled) a.enabled = 0;
        if (!still && m.hasAudio) a.srcEnable = "video";
        const x = el.ele(still ? "video" : "asset-clip", a);
        writeVideoAdjust(x, c, still ? 0 : c.sourceIn, T, et);
        for (const mk of c.markers) writeMarker(x, (still ? 0 : c.sourceIn) + mk.frame, mk, T);
      });
    }
  });
  // connected audio (lanes −1..−n)
  et.audio.forEach((track, ti) => {
    for (const c of track.clips) {
      const p = parentAt(c.start);
      if (!p) continue;
      const m = mediaById.get(c.mediaId)!;
      pushAnchor(p, (el) => {
        const a: Record<string, string | number> = { ref: assetRef.get(m.id)!, lane: -(ti + 1), name: cleanText(c.name), offset: T(local(p, c.start)), start: T(c.sourceIn), duration: T(c.duration) };
        if (!c.enabled || !track.enabled) a.enabled = 0;
        a.audioRole = track.role === "stem" ? STEM_ROLE[c.id.replace(/^stem:/, "")] ?? "effects" : ROLE[track.role];
        const x = el.ele("asset-clip", a);
        writeVolume(x, c.gainDb, c.sourceIn, T);
      });
    }
  });
  // timeline markers → the spine item that contains them
  for (const mk of et.markers) {
    const p = parentAt(mk.frame);
    if (p) pushMarker(p, local(p, mk.frame), mk);
  }

  // ---- emit the spine
  items.forEach((it, i) => {
    const out = i > 0 ? transitionAt.get(it.clip.start) : undefined;
    if (out && dissolveRef) {
      spine.ele("transition", { name: "Cross Dissolve", offset: T(out.cutFrame - out.duration / 2), duration: T(out.duration) })
        .ele("filter-video", { ref: dissolveRef, name: "Cross Dissolve" });
    }
    const a: Record<string, string | number> = {
      ref: assetRef.get(it.media.id)!, name: cleanText(it.clip.name), offset: T(it.clip.start), start: T(it.srcStart), duration: T(it.clip.duration),
    };
    if (!it.clip.enabled || !v1.enabled) a.enabled = 0;
    if (!it.still) {
      a.tcFormat = "NDF";
      if (it.media.hasAudio) a.srcEnable = "video"; // V1 is muted (clip sound lives on its own audio lane)
    }
    const el = spine.ele(it.still ? "video" : "asset-clip", a);
    writeVideoAdjust(el, it.clip, it.srcStart, T, et);
    for (const fn of anchors.get(it) ?? []) fn(el);
    const ms = [
      ...(markers.get(it) ?? []),
      ...it.clip.markers.map((m) => ({ start: it.srcStart + m.frame, m })),
    ].sort((x, y) => x.start - y.start || x.m.name.localeCompare(y.m.name));
    for (const { start, m } of ms) writeMarker(el, start, m, T);
  });
  if (!items.length) spine.ele("gap", { name: "Gap", offset: "0s", start: "0s", duration: T(et.durationFrames) });
  return doc.end({ prettyPrint: true, indent: "  " }) + "\n";
}

function writeMarker(el: XMLBuilder, start: number, m: ExportMarker, T: (f: number) => string): void {
  const a: Record<string, string> = { start: T(start), duration: T(Math.max(1, m.duration)), value: cleanText(m.name) || "Marker" };
  if (m.note) a.note = cleanText(m.note);
  el.ele("marker", a);
}

/** adjust-transform (scale "s s", position "dx/H·100 −dy/H·100", rotation −deg) + adjust-blend. Key time = clip start + local. */
function writeVideoAdjust(el: XMLBuilder, c: ExportClip, srcStart: number, T: (f: number) => string, et: ExportTimeline): void {
  const H = et.height;
  const sv = (k: Keyframe) => `${fmt(k.value, 5)} ${fmt(k.value, 5)}`;
  const pv = (k: Keyframe2) => `${fmt((k.x / H) * 100)} ${fmt((-k.y / H) * 100)}`;
  const rv = (k: Keyframe) => fmt(-k.value, 3);
  if (c.scale.length || c.position.length || c.rotation.length) {
    const attrs: Record<string, string> = {};
    if (c.position.length === 1) attrs.position = pv(c.position[0]!);
    if (c.scale.length === 1) attrs.scale = sv(c.scale[0]!);
    if (c.rotation.length === 1) attrs.rotation = rv(c.rotation[0]!);
    const at = el.ele("adjust-transform", attrs);
    const anim = <K extends { frame: number; interp: "linear" | "hold" }>(name: string, keys: K[], val: (k: K) => string) => {
      if (keys.length < 2) return;
      const ka = at.ele("param", { name }).ele("keyframeAnimation");
      for (const k of keys) ka.ele("keyframe", { time: T(srcStart + k.frame), value: val(k) });
    };
    anim("position", c.position, pv);
    anim("scale", c.scale, sv);
    anim("rotation", c.rotation, rv);
  }
  const mode = BLEND_MODE[c.blend];
  if (c.opacity.length || mode !== null) {
    const attrs: Record<string, string | number> = {};
    if (c.opacity.length === 1) attrs.amount = fmt(c.opacity[0]!.value);
    if (mode !== null) attrs.mode = mode;
    const ab = el.ele("adjust-blend", attrs);
    if (c.opacity.length >= 2) {
      const ka = ab.ele("param", { name: "amount" }).ele("keyframeAnimation");
      for (const k of c.opacity) ka.ele("keyframe", { time: T(srcStart + k.frame), value: fmt(k.value) });
    }
  }
}

/** adjust-volume amount="xdB" (+ param amount keyframes at clip start + local). */
function writeVolume(el: XMLBuilder, keys: Keyframe[], srcStart: number, T: (f: number) => string): void {
  if (!keys.length) return;
  const db = (v: number) => `${fmt(v, 2)}dB`;
  if (keys.length === 1) {
    if (Math.abs(keys[0]!.value) < 0.005) return;
    el.ele("adjust-volume", { amount: db(keys[0]!.value) });
    return;
  }
  const ka = el.ele("adjust-volume", { amount: db(keys[0]!.value) }).ele("param", { name: "amount" }).ele("keyframeAnimation");
  for (const k of keys) ka.ele("keyframe", { time: T(srcStart + k.frame), value: db(k.value) });
}
