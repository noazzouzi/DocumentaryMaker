// FCP7 XML (xmeml v4) writer, Premiere and Resolve flavours (§13.3). Port of the validated prototype
// ($SP/tl/examples/demo_premiere.xml): integer frames everywhere, <file> defined once then referenced, centred
// transitionitems (outgoing end=-1 / out+d/2, incoming start=-1 / in−d/2), keyframe `when` in source frames.
import { create } from "xmlbuilder2";
import type { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import type { ExportAudioClip, ExportClip, ExportMarker, ExportMedia, ExportTimeline, ExportTransition, Keyframe } from "@docmaker/core";
import { xmemlPathUrl } from "./paths";
import { XMEML_MAX_LEVEL, cleanText, dbToLevel, fmt, tcNdf, timebase } from "./util";

export type XmemlFlavour = "premiere" | "resolve";
/** Frame count written as a still's duration in the Premiere flavour (otherwise Premiere assumes ≈ 12 h). */
const STILL_FRAMES_MIN = 18000;

interface Ctx {
  et: ExportTimeline;
  flavour: XmemlFlavour;
  tb: number;
  ntsc: string;
  media: Map<string, ExportMedia>;
  filesWritten: Set<string>;
  fileId: Map<string, string>;
  clipNo: number;
  /** Premiere tags its parameters (authoringApp); the plain Apple DTD (Resolve flavour) has no such attribute. */
  paramAttrs: Record<string, string>;
}

const txt = (el: XMLBuilder, name: string, v: string | number) => el.ele(name).txt(String(v)).up();
function rate(el: XMLBuilder, c: Ctx): void {
  const r = el.ele("rate");
  txt(r, "timebase", c.tb);
  txt(r, "ntsc", c.ntsc);
}
function videoChars(el: XMLBuilder, c: Ctx, w: number, h: number): void {
  const sc = el.ele("samplecharacteristics");
  rate(sc, c);
  txt(sc, "width", w);
  txt(sc, "height", h);
  txt(sc, "anamorphic", "FALSE");
  txt(sc, "pixelaspectratio", "square");
  txt(sc, "fielddominance", "none");
}
function audioChars(el: XMLBuilder): void {
  const sc = el.ele("samplecharacteristics");
  txt(sc, "depth", 16);
  txt(sc, "samplerate", 48000);
}

function stillFileFrames(c: Ctx, needOut: number): number {
  return Math.max(STILL_FRAMES_MIN, needOut + c.tb * 10);
}

/** <file id> fully defined on first use, then referenced. */
function fileEl(el: XMLBuilder, c: Ctx, m: ExportMedia, needOut: number): void {
  let id = c.fileId.get(m.id);
  if (!id) {
    id = `file-${c.fileId.size + 1}`;
    c.fileId.set(m.id, id);
  }
  if (c.filesWritten.has(m.id)) {
    el.ele("file", { id });
    return;
  }
  c.filesWritten.add(m.id);
  const f = el.ele("file", { id });
  txt(f, "name", m.name);
  txt(f, "pathurl", xmemlPathUrl(m.writtenPath));
  rate(f, c);
  if (m.kind === "image") {
    if (c.flavour === "premiere") txt(f, "duration", stillFileFrames(c, needOut));
    else f.ele("duration");
  } else if (m.durationFrames !== null) {
    txt(f, "duration", m.durationFrames);
  }
  if (m.kind === "video") {
    const tc = f.ele("timecode");
    rate(tc, c);
    txt(tc, "string", "00:00:00:00");
    txt(tc, "frame", 0);
    txt(tc, "displayformat", "NDF");
  }
  const md = f.ele("media");
  if (m.kind !== "audio" && m.hasVideo !== false) videoChars(md.ele("video"), c, m.width ?? c.et.width, m.height ?? c.et.height);
  if (m.hasAudio) {
    const a = md.ele("audio");
    audioChars(a);
    txt(a, "channelcount", m.audioChannels ?? 2);
  }
}

function param(eff: XMLBuilder, c: Ctx, id: string, name: string, min: number, max: number, value: string | ((p: XMLBuilder) => void), keys: { when: number; value: string | ((p: XMLBuilder) => void) }[]): void {
  const p = eff.ele("parameter", c.paramAttrs);
  txt(p, "parameterid", id);
  txt(p, "name", name);
  if (min !== max) {
    txt(p, "valuemin", min);
    txt(p, "valuemax", max);
  }
  const setValue = (parent: XMLBuilder, v: string | ((p: XMLBuilder) => void)) => {
    if (typeof v === "string") txt(parent, "value", v);
    else v(parent.ele("value"));
  };
  setValue(p, value);
  for (const k of keys) {
    const kf = p.ele("keyframe");
    txt(kf, "when", k.when);
    setValue(kf, k.value);
  }
}

function effectHead(f: XMLBuilder, name: string, id: string, cat: string, type: string, mediatype: string): XMLBuilder {
  const e = f.ele("effect");
  txt(e, "name", name);
  txt(e, "effectid", id);
  txt(e, "effectcategory", cat);
  txt(e, "effecttype", type);
  txt(e, "mediatype", mediatype);
  return e;
}

/** Basic Motion (scale = 100·s, center = dx/W, dy/H, rotation deg) and Opacity (0..100); `when` = srcIn + local. */
function videoFilters(el: XMLBuilder, c: Ctx, clip: ExportClip, srcIn: number): void {
  const W = c.et.width;
  const H = c.et.height;
  if (clip.scale.length || clip.position.length || clip.rotation.length) {
    const e = effectHead(el.ele("filter"), "Basic Motion", "basic", "motion", "motion", "video");
    const sk = clip.scale;
    param(e, c, "scale", "Scale", 0, 1000, fmt(100 * (sk[0]?.value ?? 1), 3), sk.length > 1 ? sk.map((k) => ({ when: srcIn + k.frame, value: fmt(100 * k.value, 3) })) : []);
    const pk = clip.position;
    const center = (x: number, y: number) => (p: XMLBuilder) => {
      txt(p, "horiz", fmt(x / W, 5));
      txt(p, "vert", fmt(y / H, 5));
    };
    param(e, c, "center", "Center", 0, 0, center(pk[0]?.x ?? 0, pk[0]?.y ?? 0), pk.length > 1 ? pk.map((k) => ({ when: srcIn + k.frame, value: center(k.x, k.y) })) : []);
    if (clip.rotation.length) {
      const rk = clip.rotation;
      param(e, c, "rotation", "Rotation", -8640, 8640, fmt(rk[0]!.value, 3), rk.length > 1 ? rk.map((k) => ({ when: srcIn + k.frame, value: fmt(k.value, 3) })) : []);
    }
  }
  if (clip.opacity.length) {
    const e = effectHead(el.ele("filter"), "Opacity", "opacity", "motion", "motion", "video");
    const ok = clip.opacity;
    param(e, c, "opacity", "opacity", 0, 100, fmt(100 * ok[0]!.value, 3), ok.length > 1 ? ok.map((k) => ({ when: srcIn + k.frame, value: fmt(100 * k.value, 3) })) : []);
  }
}

function clipMarkers(el: XMLBuilder, markers: ExportMarker[], srcIn: number): void {
  for (const m of markers) {
    const mk = el.ele("marker");
    txt(mk, "name", cleanText(m.name));
    const note = cleanText(m.note);
    if (note) txt(mk, "comment", note);
    else mk.ele("comment");
    txt(mk, "in", srcIn + m.frame);
    txt(mk, "out", m.duration > 0 ? srcIn + m.frame + m.duration : -1);
  }
}

function transitionItem(track: XMLBuilder, c: Ctx, t: ExportTransition): void {
  const ti = track.ele("transitionitem");
  rate(ti, c);
  txt(ti, "start", t.cutFrame - t.duration / 2);
  txt(ti, "end", t.cutFrame + t.duration / 2);
  txt(ti, "alignment", "center");
  const dip = t.kind === "dipToBlack";
  const e = effectHead(ti, dip ? "Dip to Color Dissolve" : "Cross Dissolve", dip ? "Dip to Color Dissolve" : "Cross Dissolve", "Dissolve", "transition", "video");
  txt(e, "startratio", 0);
  txt(e, "endratio", 1);
  txt(e, "reverse", "FALSE");
}

function videoTrack(video: XMLBuilder, c: Ctx, clips: ExportClip[], transitions: ExportTransition[], enabled: boolean, isV1: boolean): void {
  const track = video.ele("track");
  const byCut = new Map(transitions.map((t) => [t.cutFrame, t]));
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  for (const clip of sorted) {
    const m = c.media.get(clip.mediaId)!;
    const still = m.kind === "image";
    const tin = isV1 ? byCut.get(clip.start) : undefined;
    const tout = isV1 ? byCut.get(clip.start + clip.duration) : undefined;
    // stills have no source handles: shift their source start so a pulled-back `in` stays ≥ 0
    const srcIn = still ? (tin ? tin.duration / 2 : 0) : clip.sourceIn;
    let start = clip.start;
    let end = clip.start + clip.duration;
    let inF = srcIn;
    let outF = srcIn + clip.duration;
    if (tout) {
      end = -1;
      outF += tout.duration / 2;
    }
    if (tin) {
      start = -1;
      inF -= tin.duration / 2;
    }
    const ci = track.ele("clipitem", { id: `clipitem-${++c.clipNo}` });
    txt(ci, "name", m.name);
    txt(ci, "enabled", clip.enabled && enabled ? "TRUE" : "FALSE");
    if (still) {
      if (c.flavour === "premiere") txt(ci, "duration", stillFileFrames(c, outF));
      else ci.ele("duration");
    } else if (m.durationFrames !== null) txt(ci, "duration", m.durationFrames);
    rate(ci, c);
    txt(ci, "start", start);
    txt(ci, "end", end);
    txt(ci, "in", inF);
    txt(ci, "out", outF);
    if (still || m.alpha) txt(ci, "alphatype", m.alpha ? "straight" : "none");
    if (still) {
      txt(ci, "pixelaspectratio", "square");
      txt(ci, "anamorphic", "FALSE");
    }
    fileEl(ci, c, m, outF);
    txt(ci, "compositemode", clip.blend);
    videoFilters(ci, c, clip, srcIn);
    clipMarkers(ci, clip.markers, srcIn);
    if (tout) transitionItem(track, c, tout);
  }
  txt(track, "enabled", enabled ? "TRUE" : "FALSE");
  txt(track, "locked", "FALSE");
}

function audioLevels(ci: XMLBuilder, c: Ctx, keys: Keyframe[], srcIn: number): void {
  if (!keys.length || (keys.length === 1 && Math.abs(keys[0]!.value) < 0.005)) return;
  const e = effectHead(ci.ele("filter"), "Audio Levels", "audiolevels", "audiolevels", "audiolevels", "audio");
  const lv = (db: number) => fmt(dbToLevel(db), 6);
  param(e, c, "level", "Level", 0, XMEML_MAX_LEVEL, lv(keys[0]!.value), keys.length > 1 ? keys.map((k) => ({ when: srcIn + k.frame, value: lv(k.value) })) : []);
}

interface AudioItem { id: string; clip: ExportAudioClip; xmlTrack: number; clipIndex: number }

function audioClipitem(trackEl: XMLBuilder, c: Ctx, it: AudioItem, opts: { channelType: string | null; sourceTrack: number; links: AudioItem[]; enabled: boolean }): void {
  const clip = it.clip;
  const m = c.media.get(clip.mediaId)!;
  const ci = trackEl.ele("clipitem", opts.channelType ? { id: it.id, premiereChannelType: opts.channelType } : { id: it.id });
  txt(ci, "name", m.name);
  txt(ci, "enabled", clip.enabled && opts.enabled ? "TRUE" : "FALSE");
  if (m.durationFrames !== null) txt(ci, "duration", m.durationFrames);
  rate(ci, c);
  txt(ci, "start", clip.start);
  txt(ci, "end", clip.start + clip.duration);
  txt(ci, "in", clip.sourceIn);
  txt(ci, "out", clip.sourceIn + clip.duration);
  fileEl(ci, c, m, clip.sourceIn + clip.duration);
  const st = ci.ele("sourcetrack");
  txt(st, "mediatype", "audio");
  txt(st, "trackindex", opts.sourceTrack);
  for (const l of opts.links) {
    const lk = ci.ele("link");
    txt(lk, "linkclipref", l.id);
    txt(lk, "mediatype", "audio");
    txt(lk, "trackindex", l.xmlTrack);
    txt(lk, "clipindex", l.clipIndex);
    txt(lk, "groupindex", 1);
  }
  audioLevels(ci, c, clip.gainDb, clip.sourceIn);
}

function audioTracks(audio: XMLBuilder, c: Ctx): void {
  let xmlTrack = 0;
  for (const t of c.et.audio) {
    const clips = [...t.clips].sort((a, b) => a.start - b.start);
    const enabled = t.enabled;
    const stereo = t.channels === 2;
    if (c.flavour === "premiere" && stereo) {
      const lTrack = ++xmlTrack;
      const rTrack = ++xmlTrack;
      const L: AudioItem[] = clips.map((clip, i) => ({ id: `clipitem-${++c.clipNo}`, clip, xmlTrack: lTrack, clipIndex: i + 1 }));
      const R: AudioItem[] = clips.map((clip, i) => ({ id: `clipitem-${++c.clipNo}`, clip, xmlTrack: rTrack, clipIndex: i + 1 }));
      for (const [side, items] of [[0, L], [1, R]] as const) {
        const tr = audio.ele("track", { currentExplodedTrackIndex: side, totalExplodedTrackCount: 2, premiereTrackType: "Stereo" });
        items.forEach((it, i) => audioClipitem(tr, c, it, { channelType: "stereo", sourceTrack: side + 1, links: [L[i]!, R[i]!], enabled }));
        txt(tr, "enabled", enabled ? "TRUE" : "FALSE");
        txt(tr, "locked", "FALSE");
        txt(tr, "outputchannelindex", side + 1);
      }
      continue;
    }
    const n = ++xmlTrack;
    const tr = c.flavour === "premiere"
      ? audio.ele("track", { currentExplodedTrackIndex: 0, totalExplodedTrackCount: 1, premiereTrackType: "Mono" })
      : audio.ele("track");
    clips.forEach((clip, i) => {
      const it: AudioItem = { id: `clipitem-${++c.clipNo}`, clip, xmlTrack: n, clipIndex: i + 1 };
      audioClipitem(tr, c, it, { channelType: c.flavour === "premiere" ? "mono" : null, sourceTrack: 1, links: [], enabled });
    });
    txt(tr, "enabled", enabled ? "TRUE" : "FALSE");
    txt(tr, "locked", "FALSE");
  }
}

export function writeXmeml(et: ExportTimeline, o: { flavour: XmemlFlavour }): string {
  const c: Ctx = {
    et, flavour: o.flavour, tb: timebase(et.fps), ntsc: et.ntsc ? "TRUE" : "FALSE", media: new Map(et.media.map((m) => [m.id, m])),
    filesWritten: new Set(), fileId: new Map(), clipNo: 0, paramAttrs: o.flavour === "premiere" ? { authoringApp: "PremierePro" } : {},
  };
  const doc = create({ version: "1.0", encoding: "UTF-8" }).dtd({ name: "xmeml" }).ele("xmeml", { version: "4" });
  const seq = doc.ele("sequence", o.flavour === "premiere" ? { id: "sequence-1", explodedTracks: "true" } : { id: "sequence-1" });
  txt(seq, "name", cleanText(et.name) || "DocumentaryMaker");
  txt(seq, "duration", et.durationFrames);
  rate(seq, c);
  const tc = seq.ele("timecode");
  rate(tc, c);
  txt(tc, "string", tcNdf(et.tcStartFrames, c.tb));
  txt(tc, "frame", et.tcStartFrames);
  txt(tc, "displayformat", "NDF");
  const media = seq.ele("media");
  const video = media.ele("video");
  videoChars(video.ele("format"), c, et.width, et.height);
  et.video.forEach((t, i) => videoTrack(video, c, t.clips, i === 0 ? t.transitions : [], t.enabled, i === 0));
  const audio = media.ele("audio");
  if (o.flavour === "premiere") txt(audio, "numOutputChannels", 2);
  audioChars(audio.ele("format"));
  audioTracks(audio, c);
  for (const m of et.markers) {
    const mk = seq.ele("marker");
    txt(mk, "name", cleanText(m.name));
    const note = cleanText(m.note);
    if (note) txt(mk, "comment", note);
    else mk.ele("comment");
    txt(mk, "in", m.frame);
    txt(mk, "out", m.duration > 0 ? m.frame + m.duration : -1);
  }
  return doc.end({ prettyPrint: true, indent: "  " }) + "\n";
}
