// Timeline + ConformMap → NLE-agnostic ExportTimeline (§13.1). Reads ONLY the Timeline and the conform map.
import path from "node:path";
import {
  DocmakerError, ExportTimeline, computeGainTables, dbToGain, gainToDb, itemEnvelope,
  type ExportAudioClip, type ExportAudioTrack, type ExportClip, type ExportMarker, type ExportMedia, type ExportTransition,
  type ExportVideoTrack, type FxCue, type GainTables, type Keyframe, type MarkerColor, type OverlayItem, type Timeline,
  type TimelineAsset, type VisualClip,
} from "@docmaker/core";
import { NON_PORTABLE_FX, clipMotion, gainKeys } from "./keyframes";
import { safeStem, writtenPathFor } from "./paths";
import {
  type ConformMap, type ConformedMedia, STEM_NAMES, clipWavKey, mirroredSfxKey, overlayKey, pictureKey, stemKey,
} from "./types";

export interface ToExportCtx { exportDir: string; exportRoot: string | null; conformed: ConformMap }

const NOTE_COLOR: MarkerColor = "cyan";
const PIP_SCALE = 0.76;

class MediaTable {
  readonly list: ExportMedia[] = [];
  private byPath = new Map<string, string>();
  constructor(private ctx: ToExportCtx) {}
  /** Registers conformed media (deduplicated by local path) and returns its id. */
  add(cm: ConformedMedia): string {
    const hit = this.byPath.get(cm.localPath);
    if (hit) return hit;
    const id = `m${String(this.list.length + 1).padStart(3, "0")}`;
    this.list.push({
      id, assetId: cm.assetId, localPath: cm.localPath, writtenPath: writtenPathFor(cm.localPath, this.ctx.exportDir, this.ctx.exportRoot),
      name: cm.name, kind: cm.kind, width: cm.width, height: cm.height, durationFrames: cm.kind === "image" ? null : cm.durationFrames,
      hasVideo: cm.hasVideo, hasAudio: cm.hasAudio, audioChannels: cm.audioChannels, alpha: cm.alpha,
    });
    this.byPath.set(cm.localPath, id);
    return id;
  }
  get(id: string): ExportMedia {
    return this.list.find((m) => m.id === id)!;
  }
}

/** Placeholder for media the conform step could not produce: the NLE shows it offline with a marker to relink. */
function offlineMedia(exportDir: string, key: string, kind: ConformedMedia["kind"], asset: TimelineAsset | null): ConformedMedia {
  const ext = kind === "image" ? (asset?.ext === "png" ? "png" : "jpg") : kind === "video" ? "mp4" : "wav";
  return {
    assetId: asset?.id ?? null, localPath: path.join(exportDir, "media", `missing_${safeStem(key)}.${ext}`), name: `missing_${safeStem(key)}.${ext}`,
    kind, width: kind === "audio" ? null : 1920, height: kind === "audio" ? null : 1080,
    durationFrames: kind === "image" ? null : asset?.durationFrames ?? null, hasVideo: kind !== "audio", hasAudio: kind === "audio",
    audioChannels: kind === "audio" ? 2 : null, alpha: false,
  };
}

const marker = (frame: number, name: string, note = "", duration = 0, color: MarkerColor = NOTE_COLOR): ExportMarker => ({
  frame: Math.max(0, Math.round(frame)), duration: Math.max(0, Math.round(duration)), name, note, color,
});

function propsSummary(item: OverlayItem): string {
  const parts: string[] = [];
  const visit = (v: unknown, depth: number) => {
    if (parts.join(" · ").length > 160 || depth > 2) return;
    if (typeof v === "string") {
      const s = v.trim();
      if (s && !/^#[0-9a-f]{3,8}$/i.test(s) && !/^(left|right|top|bottom|center|none|auto)$/i.test(s)) parts.push(s);
    } else if (typeof v === "number" && depth === 1) {
      parts.push(String(v));
    } else if (Array.isArray(v)) {
      for (const x of v.slice(0, 4)) visit(x, depth + 1);
    } else if (v && typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) visit(x, depth + 1);
    }
  };
  for (const [k, v] of Object.entries(item.props as Record<string, unknown>)) {
    if (/color|colour|seed|style|variant|zone|align/i.test(k)) continue;
    visit(v, 1);
  }
  const s = parts.join(" · ");
  return s.length > 200 ? `${s.slice(0, 197)}…` : s;
}

interface TransitionPlan { out: ExportTransition | null; notes: ExportMarker[] }

/** Head/tail handle check for a centred transition of `d` frames at the cut between prev and cur. */
function handlesOk(prev: VisualClip, cur: VisualClip, d: number, mediaDur: (c: VisualClip) => number | null): boolean {
  const h = d / 2;
  if (h > prev.dur || h > cur.dur) return false;
  if (prev.source.kind === "video") {
    const md = mediaDur(prev);
    if (md !== null && prev.source.sourceInFrames + prev.dur + h > md) return false;
  }
  if (cur.source.kind === "video" && cur.source.sourceInFrames < h) return false;
  return true;
}

function planTransition(prev: VisualClip | undefined, cur: VisualClip, mediaDur: (c: VisualClip) => number | null): TransitionPlan {
  const tr = cur.transitionIn;
  const notes: ExportMarker[] = [];
  if (!prev) return { out: null, notes };
  if (tr.kind === "overlap") {
    if (tr.presentation === "dissolve" || tr.presentation === "blurDissolve") {
      const d = tr.durationFrames;
      if (handlesOk(prev, cur, d, mediaDur)) {
        if (tr.presentation === "blurDissolve") notes.push(marker(0, "blurDissolve exported as Cross Dissolve", "the blur is not portable"));
        return { out: { cutFrame: cur.from, duration: d, kind: "dissolve" }, notes };
      }
      notes.push(marker(0, `${tr.presentation} not portable (hard cut)`, "not enough media handles for a centred transition"));
      return { out: null, notes };
    }
    notes.push(marker(0, `${tr.presentation} transition not portable (hard cut)`));
    return { out: null, notes };
  }
  if (tr.kind === "cover") {
    if (tr.presentation === "dipToBlack") {
      const d = Math.max(2, tr.durationFrames + (tr.durationFrames % 2));
      if (handlesOk(prev, cur, d, mediaDur)) return { out: { cutFrame: cur.from, duration: d, kind: "dipToBlack" }, notes };
      notes.push(marker(0, "dipToBlack not portable (hard cut)", "not enough media handles for a centred transition"));
      return { out: null, notes };
    }
    notes.push(marker(0, `${tr.presentation} cover not portable (hard cut)`, `${tr.durationFrames} frames centred on the cut`));
    return { out: null, notes };
  }
  const a = tr.accent;
  if (a.type === "velocity") notes.push(marker(0, `velocity ${a.preset} not portable (hard cut)`, `direction ${a.direction}`));
  else if (a.type === "flash") notes.push(marker(0, "flash accent not portable", `${a.frames} frames, peak ${a.peak}`));
  return { out: null, notes };
}

function clipNotes(clip: VisualClip, fx: readonly FxCue[]): ExportMarker[] {
  const out: ExportMarker[] = [];
  if (clip.layout === "card") out.push(marker(0, "card layout not portable", "plain cover still exported"));
  else if (clip.layout === "pip") out.push(marker(0, "pip layout not portable", "source exported at scale 0.76"));
  else if (clip.layout === "contain-blur") out.push(marker(0, "contain-blur layout not portable", "blur-padded still exported"));
  else if (clip.layout === "split-left" || clip.layout === "split-right") out.push(marker(0, `${clip.layout} layout not portable`, "full-frame source exported"));
  if (clip.treatment !== "none") out.push(marker(0, `${clip.treatment} treatment not portable`));
  if (clip.camera.handheld && clip.camera.handheld.ampPx > 0) out.push(marker(0, "handheld camera noise not portable"));
  if (clip.camera.blurFromPx > 0) out.push(marker(0, "camera entry blur not portable"));
  const seen = new Set<string>();
  for (const c of fx) {
    if (!NON_PORTABLE_FX.has(c.fx)) continue;
    if (c.from < clip.from || c.from >= clip.from + clip.dur) continue;
    const local = c.from - clip.from;
    const key = `${c.fx}@${local}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(marker(local, `${c.fx} not portable`, c.id, c.dur));
  }
  return out.sort((a, b) => a.frame - b.frame || a.name.localeCompare(b.name));
}

/** Splits [from, from+dur) into repeated media pieces when `loop` (else clamps to the available media). */
export function loopPieces(from: number, dur: number, sourceIn: number, mediaDur: number | null, loop: boolean): { start: number; duration: number; sourceIn: number }[] {
  if (dur <= 0) return [];
  if (mediaDur === null || mediaDur <= 0) return [{ start: from, duration: dur, sourceIn }];
  if (!loop) {
    const avail = mediaDur - sourceIn;
    return [{ start: from, duration: Math.max(1, Math.min(dur, avail > 0 ? avail : dur)), sourceIn: avail > 0 ? sourceIn : 0 }];
  }
  const out: { start: number; duration: number; sourceIn: number }[] = [];
  let at = from;
  let left = dur;
  let src = sourceIn < mediaDur ? sourceIn : 0;
  while (left > 0 && out.length < 10000) {
    const len = Math.min(left, mediaDur - src);
    out.push({ start: at, duration: len, sourceIn: src });
    at += len;
    left -= len;
    src = 0;
  }
  return out;
}

/** First-fit packing of possibly overlapping clips into lanes (one NLE track per lane). */
export function packLanes<C extends { start: number; duration: number }>(clips: readonly C[]): C[][] {
  const lanes: { end: number; clips: C[] }[] = [];
  for (const c of [...clips].sort((a, b) => a.start - b.start)) {
    const lane = lanes.find((l) => l.end <= c.start);
    if (lane) {
      lane.clips.push(c);
      lane.end = c.start + c.duration;
    } else lanes.push({ end: c.start + c.duration, clips: [c] });
  }
  return lanes.map((l) => l.clips);
}

const constGain = (db: number): Keyframe[] => [{ frame: 0, value: Number(db.toFixed(2)), interp: "linear" }];

export function toExportTimeline(t: Timeline, ctx: ToExportCtx): ExportTimeline {
  const fps = t.fps;
  const W = t.width;
  const H = t.height;
  const media = new MediaTable(ctx);
  const assetOf = (id: string): TimelineAsset | null => t.assets[id] ?? null;

  /** Conformed media for a key, or an offline placeholder (+ a note in `missing`). */
  const missing: string[] = [];
  const resolve = (key: string, kind: ConformedMedia["kind"], asset: TimelineAsset | null): { id: string; offline: boolean } => {
    const cm = ctx.conformed[key] ?? (asset ? ctx.conformed[asset.id] : undefined);
    if (cm && (kind !== "image" || cm.kind === "image" || cm.kind === "video")) return { id: media.add(cm), offline: false };
    missing.push(key);
    return { id: media.add(offlineMedia(ctx.exportDir, key, kind, asset)), offline: true };
  };

  // ---------------------------------------------------------------- V1 (spine)
  const mediaDurOf = (c: VisualClip): number | null => (c.source.kind === "video" ? assetOf(c.source.assetId)?.durationFrames ?? null : null);
  const plans = t.video.map((c, i) => planTransition(t.video[i - 1], c, mediaDurOf));
  const v1Clips: ExportClip[] = [];
  const v1Transitions: ExportTransition[] = [];
  for (const [i, clip] of t.video.entries()) {
    const plan = plans[i]!;
    if (plan.out) v1Transitions.push(plan.out);
    const nextOut = plans[i + 1]?.out ?? null;
    const src = clip.source;
    const asset = src.kind === "image" || src.kind === "video" ? assetOf(src.assetId) : null;
    const kind: ConformedMedia["kind"] = src.kind === "video" ? "video" : "image";
    const r = resolve(pictureKey(clip), kind, asset);
    const m = media.get(r.id);
    const motion = clipMotion({
      clip, fx: t.fx, fps, width: W, height: H, kbEase: t.render.motion.kbEase, tailFrames: nextOut ? nextOut.duration / 2 : 0,
      baseScale: clip.layout === "pip" ? PIP_SCALE : 1,
    });
    const markers = [...plan.notes, ...clipNotes(clip, t.fx)];
    if (r.offline) markers.unshift(marker(0, "media missing — relink", pictureKey(clip)));
    v1Clips.push({
      id: clip.id, name: clip.name || m.name, mediaId: r.id, start: clip.from, duration: clip.dur,
      sourceIn: src.kind === "video" && m.kind === "video" ? src.sourceInFrames : 0, enabled: true,
      scale: motion.scale, position: motion.position, rotation: motion.rotation, opacity: [], blend: "normal", markers,
    });
  }
  const video: ExportVideoTrack[] = [{ name: "V1", enabled: true, clips: v1Clips, transitions: v1Transitions }];

  // ---------------------------------------------------------------- overlays: V2 graphics / V3 hud (M3) or markers
  const overlayMarkers: ExportMarker[] = [];
  const graphics: ExportClip[] = [];
  const hud: ExportClip[] = [];
  for (const it of t.overlays) {
    const cm = ctx.conformed[overlayKey(it.id)];
    if (!cm) {
      overlayMarkers.push(marker(it.from, it.component, propsSummary(it), it.dur));
      continue;
    }
    const clip: ExportClip = {
      id: it.id, name: it.component, mediaId: media.add(cm), start: it.from, duration: it.dur, sourceIn: 0, enabled: true,
      scale: [], position: [], rotation: [], opacity: [], blend: "normal", markers: [],
    };
    (it.band === "hud" ? hud : graphics).push(clip);
  }
  for (const [label, clips] of [["Graphics", graphics], ["HUD", hud]] as const) {
    packLanes(clips).forEach((lane, n) => video.push({ name: `V${video.length + 1} ${label}${n ? ` ${n + 1}` : ""}`, enabled: true, clips: lane, transitions: [] }));
  }

  // ---------------------------------------------------------------- audio
  const tables: GainTables = computeGainTables(t);
  const N = t.durationInFrames;
  const audio: ExportAudioTrack[] = [];

  // A1 VO (per-segment clips; program file as a fallback)
  const a1: ExportAudioClip[] = [];
  if (t.audio.vo.length) {
    for (const v of t.audio.vo) {
      const r = resolve(v.assetId, "audio", assetOf(v.assetId));
      a1.push({ id: v.id, name: media.get(r.id).name, mediaId: r.id, start: v.from, duration: v.dur, sourceIn: v.sourceInFrames, gainDb: constGain(v.gainDb), enabled: true });
    }
  } else {
    const r = resolve(t.audio.voProgram.assetId, "audio", assetOf(t.audio.voProgram.assetId));
    a1.push({ id: "vo:program", name: media.get(r.id).name, mediaId: r.id, start: 0, duration: N, sourceIn: 0, gainDb: constGain(0), enabled: true });
  }
  const pushAudio = (name: string, role: ExportAudioTrack["role"], channels: 1 | 2, clips: ExportAudioClip[]) => {
    packLanes(clips).forEach((lane, n) => {
      // channel layout follows the media (a mono music file stays mono; stereo VO is not exploded as mono)
      const chans = lane.map((c) => media.get(c.mediaId).audioChannels);
      const ch: 1 | 2 = chans.every((x) => x === 1) ? 1 : chans.some((x) => x !== null && x >= 2) ? 2 : channels;
      audio.push({ name: n ? `${name} ${n + 1}` : name, role, channels: ch, enabled: true, clips: lane });
    });
  };
  pushAudio("A1 VO", "dialogue", 1, a1);

  // A2 music (gain keys = ducking table × section gain × fades)
  const a2: ExportAudioClip[] = [];
  for (const s of t.audio.music) {
    const r = resolve(s.assetId, "audio", assetOf(s.assetId));
    const md = media.get(r.id).durationFrames ?? assetOf(s.assetId)?.durationFrames ?? null;
    const pieces = loopPieces(s.from, s.dur, s.sourceInFrames, md, s.loop);
    pieces.forEach((p, n) => {
      const db = (local: number) => {
        const pf = p.start + local;
        const env = itemEnvelope(s, pf - s.from);
        return gainToDb(tables.music[Math.min(N - 1, pf)]! * dbToGain(s.gainDb) * env);
      };
      a2.push({ id: pieces.length > 1 ? `${s.id}#${n + 1}` : s.id, name: media.get(r.id).name, mediaId: r.id, start: p.start, duration: p.duration, sourceIn: p.sourceIn, gainDb: gainKeys(db, p.duration), enabled: true });
    });
  }
  pushAudio("A2 Music", "music", 2, a2);

  // A3 SFX (constant gain; loops expanded; RL sweeps → mirrored file)
  const a3: ExportAudioClip[] = [];
  for (const c of [...t.audio.sfx].sort((a, b) => a.from - b.from || a.id.localeCompare(b.id))) {
    let silenced = true;
    for (let f = c.from; f < Math.min(N, c.from + c.dur); f++) if (tables.sfx[f]! > 0) { silenced = false; break; }
    if (silenced) continue;
    const key = c.panSweep === "RL" ? mirroredSfxKey(c.assetId) : c.assetId;
    const r = resolve(key, "audio", assetOf(c.assetId));
    const md = media.get(r.id).durationFrames ?? assetOf(c.assetId)?.durationFrames ?? null;
    const pieces = loopPieces(c.from, Math.min(c.dur, N - c.from), 0, md, c.loop);
    pieces.forEach((p, n) => {
      a3.push({ id: pieces.length > 1 ? `${c.id}#${n + 1}` : c.id, name: media.get(r.id).name, mediaId: r.id, start: p.start, duration: p.duration, sourceIn: p.sourceIn, gainDb: constGain(c.gainDb), enabled: true });
    });
  }
  pushAudio("A3 SFX", "effects", 2, a3);

  // A4 clip audio (WAV extracted from the clip MP4; J/L-cut source in from ClipAudio)
  const a4: ExportAudioClip[] = [];
  const clipSilence = t.audio.silences.filter((s) => s.affects.includes("clip"));
  for (const c of t.audio.clip) {
    const r = resolve(clipWavKey(c.assetId), "audio", assetOf(c.assetId));
    const db = (local: number) => {
      const pf = c.from + local;
      const g = c.duckUnderVo ? tables.clip[Math.min(N - 1, pf)]! : clipSilence.some((s) => pf >= s.from && pf < s.from + s.dur) ? 0 : 1;
      return gainToDb(g * dbToGain(c.gainDb));
    };
    a4.push({ id: c.id, name: media.get(r.id).name, mediaId: r.id, start: c.from, duration: c.dur, sourceIn: c.sourceInFrames, gainDb: gainKeys(db, c.dur), enabled: true });
  }
  pushAudio("A4 Clip audio", "clip", 2, a4);

  // A5–A8 baked stems (disabled)
  const stemLabel: Record<string, string> = { vo: "VO", music: "Music", sfx: "SFX", clip: "Clip audio" };
  let an = 5; // stems keep their A5–A8 names whatever the number of lanes above
  for (const s of STEM_NAMES) {
    const cm = ctx.conformed[stemKey(s)];
    if (!cm) continue;
    const id = media.add(cm);
    const dur = Math.max(1, Math.min(N, cm.durationFrames ?? N));
    audio.push({
      name: `A${an++} ${stemLabel[s]} stem`, role: "stem", channels: cm.audioChannels === 1 ? 1 : 2, enabled: false,
      clips: [{ id: `stem:${s}`, name: cm.name, mediaId: id, start: 0, duration: dur, sourceIn: 0, gainDb: constGain(0), enabled: false }],
    });
  }

  // ---------------------------------------------------------------- markers
  const markers: ExportMarker[] = t.markers.map((m) => marker(m.frame, m.name, m.note, m.dur, m.color));
  for (const s of t.audio.silences) {
    if (s.affects.includes("vo")) markers.push(marker(s.from, "bleep not portable on A1", "the baked VO stem carries the mute", s.dur));
  }
  markers.push(...overlayMarkers);
  if (missing.length) markers.push(marker(0, `${missing.length} media file(s) missing — relink`, missing.slice(0, 8).join(", ")));
  markers.sort((a, b) => a.frame - b.frame || a.name.localeCompare(b.name));

  const et = {
    name: t.title || t.projectSlug, lang: t.lang, fps: { num: fps, den: 1 }, ntsc: false, width: W, height: H, durationFrames: N,
    sampleRate: 48000 as const, tcStartFrames: 0 as const, media: media.list, video, audio, markers,
  };
  const parsed = ExportTimeline.safeParse(et);
  if (!parsed.success) {
    throw new DocmakerError("EXPORT_FAILED", `invalid export timeline: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, { details: parsed.error.issues });
  }
  return parsed.data;
}
