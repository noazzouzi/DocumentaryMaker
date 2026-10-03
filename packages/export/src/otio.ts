// OTIO JSON writer (§13.3): Timeline.1 > Stack.1 > Track.1 > Clip.2 | Gap.1 | Transition.1, Marker.2. With Premiere
// metadata (PremierePro_OTIO) for Motion/Opacity effects; never a no-op LinearTimeWarp (Premiere then drops them).
// Floats are written with a decimal point like the Python reference implementation (rate 30.0, value 0.0).
import type { ExportAudioClip, ExportClip, ExportMarker, ExportMedia, ExportTimeline, Keyframe } from "@docmaker/core";
import { fileUrl } from "./paths";
import { OTIO_COLOR, cleanText, fpsValue } from "./util";

/** A number serialised as a JSON float ("30.0"). */
class F {
  constructor(readonly v: number) {}
}
const f = (v: number) => new F(v);

function serialize(v: unknown, indent: string, step: string): string {
  if (v instanceof F) {
    const n = Number.isFinite(v.v) ? v.v : 0;
    const r = Number(n.toFixed(6));
    return Number.isInteger(r) ? `${r}.0` : String(r);
  }
  if (v === null || typeof v === "boolean" || typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number") return JSON.stringify(Number.isFinite(v) ? v : 0);
  const inner = indent + step;
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return `[\n${v.map((x) => inner + serialize(x, inner, step)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  if (!entries.length) return "{}";
  return `{\n${entries.map(([k, x]) => `${inner}${JSON.stringify(k)}: ${serialize(x, inner, step)}`).join(",\n")}\n${indent}}`;
}

const SENTINEL = -10800000;

export function writeOtio(et: ExportTimeline, o: { premiereMetadata: boolean }): string {
  const rate = fpsValue(et.fps);
  const RT = (value: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: f(rate), value: f(value) });
  const TR = (start: number, dur: number) => ({ OTIO_SCHEMA: "TimeRange.1", duration: RT(dur), start_time: RT(start) });
  const media = new Map(et.media.map((m) => [m.id, m]));
  const W = et.width;
  const H = et.height;

  const marker = (m: ExportMarker, start: number) => ({
    OTIO_SCHEMA: "Marker.2", metadata: {}, name: cleanText(m.name), color: OTIO_COLOR[m.color],
    marked_range: TR(start, m.duration), comment: cleanText(m.note),
  });
  const ref = (m: ExportMedia, need: { start: number; end: number }) => {
    // a still's available_range must cover the clip's source range (else Premiere rescales its keyframes)
    const avail = m.kind === "image" ? Math.max(need.end, 1) : m.durationFrames ?? need.end;
    return {
      OTIO_SCHEMA: "ExternalReference.1", metadata: {}, name: "", available_range: TR(0, Math.max(avail, need.end)),
      available_image_bounds: null, target_url: fileUrl(m.writtenPath),
    };
  };
  const startValue = (value: unknown) => ({ Position: RT(SENTINEL), Value: value });
  const kfParam = (name: string, id: number, keys: Keyframe[], srcStart: number, map: (v: number) => number, dflt: number) =>
    keys.length > 1
      ? { DisplayName: name, ID: id, Keyframes: keys.map((k) => ({ Position: RT(srcStart + k.frame), Value: f(map(k.value)) })) }
      : { DisplayName: name, ID: id, StartValue: startValue(f(keys.length ? map(keys[0]!.value) : dflt)) };
  const premiereEffects = (c: ExportClip, srcStart: number) => {
    if (!o.premiereMetadata) return [];
    if (!c.scale.length && !c.position.length && !c.rotation.length && !c.opacity.length && c.blend === "normal") return [];
    const pos = c.position;
    const posParam = pos.length > 1
      ? { DisplayName: "Position", ID: 1, Keyframes: pos.map((k) => ({ Position: RT(srcStart + k.frame), Value: { X: f(0.5 + k.x / W), Y: f(0.5 + k.y / H) } })) }
      : { DisplayName: "Position", ID: 1, StartValue: startValue({ X: f(0.5 + (pos[0]?.x ?? 0) / W), Y: f(0.5 + (pos[0]?.y ?? 0) / H) }) };
    const zero = (name: string, id: number) => ({ DisplayName: name, ID: id, StartValue: startValue(f(0)) });
    const blendCode: Record<ExportClip["blend"], number> = { normal: 18, screen: 10, add: 7, multiply: 5, overlay: 15 };
    return [
      {
        OTIO_SCHEMA: "Effect.1",
        metadata: { PremierePro_OTIO: { IsIntrinsic: true, MatchName: "AE.ADBE Opacity", Parameters: [
          kfParam("Opacity", 1, c.opacity, srcStart, (v) => 100 * v, 100),
          { DisplayName: "Blend Mode", ID: 2, StartValue: startValue(blendCode[c.blend]) },
          { DisplayName: "Blend Mode", ID: 3, StartValue: startValue(0) },
        ] } },
        name: "", effect_name: "Opacity", enabled: true,
      },
      {
        OTIO_SCHEMA: "Effect.1",
        metadata: { PremierePro_OTIO: { IsIntrinsic: true, MatchName: "AE.ADBE Motion", Parameters: [
          posParam,
          kfParam("Scale", 2, c.scale, srcStart, (v) => 100 * v, 100),
          { DisplayName: "Scale Width", ID: 3, StartValue: startValue(f(100)) },
          { DisplayName: " ", ID: 4, StartValue: startValue(true) },
          kfParam("Rotation", 5, c.rotation, srcStart, (v) => v, 0),
          { DisplayName: "Anchor Point", ID: 6, StartValue: startValue({ X: f(0.5), Y: f(0.5) }) },
          zero("Anti-flicker Filter", 7), zero("Crop Left", 8), zero("Crop Top", 9), zero("Crop Right", 10), zero("Crop Bottom", 11),
        ] } },
        name: "", effect_name: "Motion", enabled: true,
      },
    ];
  };
  const gap = (dur: number) => ({ OTIO_SCHEMA: "Gap.1", metadata: {}, name: "", source_range: TR(0, dur), effects: [], markers: [], enabled: true, color: null });
  const clipObj = (c: ExportClip | ExportAudioClip, srcStart: number, m: ExportMedia, effects: unknown[], markers: ExportMarker[], tail: number) => ({
    OTIO_SCHEMA: "Clip.2", metadata: {}, name: m.name, source_range: TR(srcStart, c.duration), effects,
    markers: markers.map((mk) => marker(mk, srcStart + mk.frame)), enabled: c.enabled, color: null,
    media_references: { DEFAULT_MEDIA: ref(m, { start: srcStart, end: srcStart + c.duration + tail }) }, active_media_reference_key: "DEFAULT_MEDIA",
  });
  const transition = (d: number, kind: "dissolve" | "dipToBlack") => ({
    OTIO_SCHEMA: "Transition.1", metadata: {}, name: kind === "dipToBlack" ? "Dip to Black" : "Cross Dissolve",
    in_offset: RT(d / 2), out_offset: RT(d / 2), transition_type: "SMPTE_Dissolve",
  });

  const tracks: unknown[] = [];
  et.video.forEach((t, ti) => {
    const children: unknown[] = [];
    const byCut = ti === 0 ? new Map(t.transitions.map((x) => [x.cutFrame, x])) : new Map();
    let at = 0;
    for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
      if (c.start > at) children.push(gap(c.start - at));
      const m = media.get(c.mediaId)!;
      const tin = byCut.get(c.start);
      const tout = byCut.get(c.start + c.duration);
      if (tin && at === c.start) children.push(transition(tin.duration, tin.kind));
      const srcStart = m.kind === "image" ? (tin ? tin.duration / 2 : 0) : c.sourceIn;
      children.push(clipObj(c, srcStart, m, premiereEffects(c, srcStart), c.markers, tout ? tout.duration / 2 : 0));
      at = Math.max(at, c.start + c.duration);
    }
    tracks.push({ OTIO_SCHEMA: "Track.1", metadata: {}, name: t.name, source_range: null, effects: [], markers: [], enabled: t.enabled, color: null, children, kind: "Video" });
  });
  for (const t of et.audio) {
    const children: unknown[] = [];
    let at = 0;
    for (const c of [...t.clips].sort((a, b) => a.start - b.start)) {
      if (c.start < at) continue; // overlapping clips cannot share an OTIO track (never produced by toExportTimeline)
      if (c.start > at) children.push(gap(c.start - at));
      children.push(clipObj(c, c.sourceIn, media.get(c.mediaId)!, [], [], 0));
      at = c.start + c.duration;
    }
    tracks.push({ OTIO_SCHEMA: "Track.1", metadata: {}, name: t.name, source_range: null, effects: [], markers: [], enabled: t.enabled, color: null, children, kind: "Audio" });
  }
  const doc = {
    OTIO_SCHEMA: "Timeline.1",
    metadata: o.premiereMetadata ? { PremierePro_OTIO: { MetadataVersion: "1.0" } } : {},
    name: cleanText(et.name),
    global_start_time: RT(et.tcStartFrames),
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      metadata: o.premiereMetadata
        ? { PremierePro_OTIO: { AudioFrameRate: f(et.sampleRate), PixelAspectRatio: { denominator: f(1), numerator: f(1) }, VideoFrameRate: f(rate), VideoResolution: { height: et.height, width: et.width } } }
        : {},
      name: "tracks", source_range: null, effects: [], markers: et.markers.map((m) => marker(m, m.frame)), enabled: true, color: null, children: tracks,
    },
  };
  return serialize(doc, "", "    ") + "\n";
}
