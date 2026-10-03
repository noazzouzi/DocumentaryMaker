// toExportTimeline (§13.1): V1 spine, transitions, camera/fx keyframes, non-portable markers, audio tracks, markers.
import { describe, expect, it } from "vitest";
import { ExportTimeline, computeGainTables, type FxCue, type Timeline, type VisualClip } from "@docmaker/core";
import { makeTimeline } from "@docmaker/core/testing";
import { loopPieces, mirroredSfxKey, overlayKey, packLanes, pictureKey, toExportTimeline, writeFcpxml, writeXmeml } from "../src/index";
import { fakeConform } from "./helpers";

const DIR = "/tmp/proj/export/en";
const clone = <T>(x: T): T => structuredClone(x);
const exportOf = (t: Timeline, o?: { stems?: boolean; exportRoot?: string | null; drop?: (k: string) => boolean }) =>
  toExportTimeline(t, { exportDir: DIR, exportRoot: o?.exportRoot ?? null, conformed: fakeConform(t, DIR, { stems: o?.stems, drop: o?.drop }) });

describe("toExportTimeline on a director-like timeline", () => {
  const t = makeTimeline({ seconds: 90 });
  const et = exportOf(t, { stems: true });

  it("is schema-valid and keeps the program length and frame rate", () => {
    expect(ExportTimeline.safeParse(et).success).toBe(true);
    expect(et.durationFrames).toBe(t.durationInFrames);
    expect(et.fps).toEqual({ num: t.fps, den: 1 });
    expect(et.tcStartFrames).toBe(0);
  });

  it("V1 is one clip per VisualClip, contiguous over [0, duration)", () => {
    const v1 = et.video[0]!;
    expect(v1.name).toBe("V1");
    expect(v1.clips.map((c) => c.id)).toEqual(t.video.map((c) => c.id));
    let at = 0;
    for (const c of v1.clips) {
      expect(c.start).toBe(at);
      at += c.duration;
    }
    expect(at).toBe(t.durationInFrames);
    const vid = t.video.find((c) => c.source.kind === "video")!;
    expect(v1.clips.find((c) => c.id === vid.id)!.sourceIn).toBe((vid.source as { sourceInFrames: number }).sourceInFrames);
  });

  it("overlap dissolves become centred, even transitions on V1; flash covers become markers", () => {
    const overlaps = t.video.filter((c) => c.transitionIn.kind === "overlap");
    expect(overlaps.length).toBeGreaterThan(0);
    expect(et.video[0]!.transitions.map((x) => x.cutFrame)).toEqual(overlaps.map((c) => c.from));
    for (const x of et.video[0]!.transitions) expect(x.duration % 2).toBe(0);
    const covers = t.video.filter((c) => c.transitionIn.kind === "cover");
    expect(covers.length).toBeGreaterThan(0);
    for (const c of covers) {
      const ec = et.video[0]!.clips.find((x) => x.id === c.id)!;
      expect(ec.markers.some((m) => m.frame === 0 && /flash cover not portable/.test(m.name))).toBe(true);
    }
  });

  it("Ken Burns (kb ease, 2 keys) → 2 scale keyframes; card layouts get a marker", () => {
    const c = t.video.find((x) => x.layout === "cover" && x.transitionIn.kind === "cut" && x.transitionIn.accent.type === "none" && !t.fx.some((f) => f.from >= x.from && f.from < x.from + x.dur))!;
    const ec = et.video[0]!.clips.find((x) => x.id === c.id)!;
    expect(ec.scale).toHaveLength(2);
    expect(ec.scale[0]!.value).toBeCloseTo(c.camera.keys[0]!.scale, 4);
    expect(ec.scale[1]!.frame).toBe(c.dur - 1 + (et.video[0]!.transitions.some((x) => x.cutFrame === c.from + c.dur) ? 5 : 0));
    const card = t.video.find((x) => x.layout === "card")!;
    expect(et.video[0]!.clips.find((x) => x.id === card.id)!.markers.map((m) => m.name)).toContain("card layout not portable");
  });

  it("punches are multiplied into the scale keys (dense inside the window)", () => {
    const punch = t.fx.find((f) => f.fx === "punch")!;
    const clip = t.video.find((c) => punch.from >= c.from && punch.from < c.from + c.dur)!;
    const ec = et.video[0]!.clips.find((x) => x.id === clip.id)!;
    const local = punch.from - clip.from;
    const at = ec.scale.find((k) => k.frame === local);
    expect(at).toBeDefined();
    // the punch peak is ≈ (1 + amt) × the camera scale
    const base = clip.camera.keys[0]!.scale;
    expect(at!.value).toBeGreaterThan(base * (1 + punch.amt) * 0.97);
    expect(ec.scale.filter((k) => k.frame >= local - punch.pre - 1 && k.frame <= local + punch.dur).length).toBeGreaterThanOrEqual(punch.dur);
  });

  it("audio: A1 VO per segment at the baked gain, A2 music with ducking/silence keys, stems disabled", () => {
    const a1 = et.audio.find((a) => a.name === "A1 VO")!;
    expect(a1.channels).toBe(1);
    expect(a1.clips.map((c) => c.id)).toEqual(t.audio.vo.map((v) => v.id));
    expect(a1.clips[0]!.gainDb).toEqual([{ frame: 0, value: Number(t.audio.vo[0]!.gainDb.toFixed(2)), interp: "linear" }]);
    const a2 = et.audio.find((a) => a.name === "A2 Music")!;
    expect(a2.role).toBe("music");
    // chapter silences (music) → −96 dB keys at the start of later chapters
    const sil = t.audio.silences.find((s) => s.affects.includes("music"))!;
    const clip = a2.clips.find((c) => sil.from >= c.start && sil.from < c.start + c.duration)!;
    expect(clip.gainDb.some((k) => k.value === -96 && Math.abs(clip.start + k.frame - sil.from) <= 1)).toBe(true);
    // ducking under VO: the music sits ≈ −12 dB below its section gain while the narrator speaks
    const tables = computeGainTables(t);
    const span = t.audio.voSpans.find(([a, b]) => b - a > 30 && !t.audio.silences.some((s) => s.from < b && s.from + s.dur > a))!;
    const mid = Math.floor((span[0] + span[1]) / 2);
    const mc = a2.clips.find((c) => mid >= c.start && mid < c.start + c.duration)!;
    const v = mc.gainDb.reduce((acc, k) => (mc.start + k.frame <= mid ? k.value : acc), mc.gainDb[0]!.value);
    expect(v).toBeCloseTo(20 * Math.log10(tables.music[mid]!), 0);
    const stems = et.audio.filter((a) => a.role === "stem");
    expect(stems.map((s) => s.name)).toEqual(["A5 VO stem", "A6 Music stem", "A7 SFX stem", "A8 Clip audio stem"]);
    for (const s of stems) {
      expect(s.enabled).toBe(false);
      expect(s.clips[0]!.enabled).toBe(false);
      expect(s.clips[0]!.duration).toBe(t.durationInFrames);
    }
  });

  it("markers: chapters (blue) + one marker per overlay (component name, key props)", () => {
    for (const ch of t.chapters) expect(et.markers.some((m) => m.frame === ch.from && m.name === ch.title && m.color === "blue")).toBe(true);
    for (const ov of t.overlays) expect(et.markers.some((m) => m.frame === ov.from && m.name === ov.component && m.duration === ov.dur)).toBe(true);
    const sorted = [...et.markers].sort((a, b) => a.frame - b.frame || a.name.localeCompare(b.name));
    expect(et.markers).toEqual(sorted);
  });

  it("media are registered once per file with exportRoot-remapped written paths", () => {
    const er = exportOf(t, { exportRoot: "/Volumes/Edit/Tulips" });
    const paths = er.media.map((m) => m.localPath);
    expect(new Set(paths).size).toBe(paths.length);
    for (const m of er.media) expect(m.writtenPath.startsWith("/Volumes/Edit/Tulips/media/")).toBe(true);
    expect(er.media.map((m) => m.id)).toEqual(er.media.map((_, i) => `m${String(i + 1).padStart(3, "0")}`));
  });

  it("is deterministic", () => {
    expect(exportOf(clone(t), { stems: true })).toEqual(et);
  });
});

describe("edge cases", () => {
  const base = makeTimeline({ seconds: 30 });

  it("missing conformed media → offline placeholder + relink markers (never throws)", () => {
    const victim = base.video[0]!;
    const et = exportOf(base, { drop: (k) => k === pictureKey(victim) || k === victim.source.kind });
    const c = et.video[0]!.clips[0]!;
    expect(et.media.find((m) => m.id === c.mediaId)!.name.startsWith("missing_")).toBe(true);
    expect(c.markers[0]!.name).toBe("media missing — relink");
    expect(et.markers.some((m) => /missing — relink/.test(m.name))).toBe(true);
  });

  it("a dissolve without enough video handles is exported as a hard cut + marker", () => {
    const t = clone(base);
    const i = t.video.findIndex((c, k) => k > 0 && c.source.kind === "image" && t.video[k - 1]!.source.kind === "image");
    const prev = t.video[i - 1]!;
    t.video[i]!.transitionIn = { kind: "overlap", presentation: "dissolve", durationFrames: 10, direction: "left" };
    const asset = Object.keys(t.assets).find((k) => t.assets[k]!.kind === "video")!;
    prev.source = { kind: "video", assetId: asset, sourceInFrames: 0, crop: null, focal: { x: 0.5, y: 0.5 } };
    t.assets[asset]!.durationFrames = prev.dur + 2; // tail handle 2 < d/2 = 5
    const et = exportOf(t);
    expect(et.video[0]!.transitions.some((x) => x.cutFrame === t.video[i]!.from)).toBe(false);
    expect(et.video[0]!.clips[i]!.markers.some((m) => /dissolve not portable/.test(m.name))).toBe(true);
  });

  it("dipToBlack covers keep an even NLE transition; odd durations are rounded up", () => {
    const t = clone(base);
    t.video[2]!.transitionIn = { kind: "cover", presentation: "dipToBlack", durationFrames: 9, direction: "left", color: "#000000", peak: 1 };
    const et = exportOf(t);
    expect(et.video[0]!.transitions).toContainEqual({ cutFrame: t.video[2]!.from, duration: 10, kind: "dipToBlack" });
  });

  it("non-portable fx, treatments, velocity accents and pip layouts become clip markers; pip scales 0.76", () => {
    const t = clone(base);
    const c = t.video[1]!;
    c.treatment = "bw";
    c.layout = "pip";
    c.camera = { ...c.camera, kind: "static", keys: [{ f: 0, scale: 1, x: 0, y: 0, rot: 0 }] };
    c.transitionIn = { kind: "cut", accent: { type: "velocity", preset: "whip", direction: "left", exitFrames: 6, entryFrames: 8, flash: 0 } };
    const shake: FxCue = { ...t.fx[0]!, id: "fx:test:shake", fx: "shake", from: c.from + 3, dur: 6, amt: 8, x: null, y: null };
    t.fx = [shake];
    const ec = exportOf(t).video[0]!.clips[1]!;
    const names = ec.markers.map((m) => m.name);
    expect(names).toEqual(expect.arrayContaining(["pip layout not portable", "bw treatment not portable", "velocity whip not portable (hard cut)", "shake not portable"]));
    expect(ec.markers.find((m) => m.name === "shake not portable")!.frame).toBe(3);
    expect(ec.scale).toEqual([{ frame: 0, value: 0.76, interp: "linear" }]);
  });

  it("bleep silences add a marker (VO mute is baked in the stem)", () => {
    const t = clone(base);
    t.audio.silences.push({ id: "sil:bleep:w1", start: { ref: "program", edge: "start", offset: 100 }, end: { ref: "program", edge: "start", offset: 110 }, from: 100, dur: 10, reason: "bleep", affects: ["vo"] });
    expect(exportOf(t).markers.some((m) => m.frame === 100 && /bleep/.test(m.name))).toBe(true);
  });

  it("looping SFX are expanded into repeated clips; RL sweeps use the mirrored file", () => {
    const t = clone(base);
    const s = t.audio.sfx[0]!;
    t.assets[s.assetId]!.durationFrames = 20;
    t.audio.sfx = [{ ...s, from: 30, dur: 50, loop: true, panSweep: "RL" }];
    const conformed = fakeConform(t, DIR);
    conformed[mirroredSfxKey(s.assetId)]!.durationFrames = 20;
    const et = toExportTimeline(t, { exportDir: DIR, exportRoot: null, conformed });
    const a3 = et.audio.find((a) => a.name === "A3 SFX")!;
    expect(a3.clips.map((c) => [c.start, c.duration, c.sourceIn])).toEqual([[30, 20, 0], [50, 20, 0], [70, 10, 0]]);
    expect(et.media.find((m) => m.id === a3.clips[0]!.mediaId)!.localPath).toBe(conformed[mirroredSfxKey(s.assetId)]!.localPath);
  });

  it("overlapping SFX are packed into extra lanes (one NLE track cannot overlap clips)", () => {
    const t = clone(base);
    const s = t.audio.sfx[0]!;
    t.audio.sfx = [{ ...s, id: "sfx:a", from: 10, dur: 30 }, { ...s, id: "sfx:b", from: 20, dur: 30 }, { ...s, id: "sfx:c", from: 45, dur: 5 }];
    const tracks = exportOf(t).audio.filter((a) => a.name.startsWith("A3 SFX"));
    expect(tracks.map((x) => [x.name, x.clips.map((c) => c.id)])).toEqual([["A3 SFX", ["sfx:a", "sfx:c"]], ["A3 SFX 2", ["sfx:b"]]]);
  });

  it("clip audio uses the extracted WAV and its J/L-cut source in", () => {
    const t = clone(base);
    const asset = Object.keys(t.assets).find((k) => t.assets[k]!.kind === "video")!;
    t.audio.clip = [{ id: "ca:CH1-S01", start: { ref: "program", edge: "start", offset: 60 }, end: { ref: "program", edge: "start", offset: 120 }, from: 60, dur: 60, segmentId: "CH1-S01", assetId: asset, sourceInFrames: 75, gainDb: -3, duckUnderVo: false }];
    const a4 = exportOf(t).audio.find((a) => a.name === "A4 Clip audio")!;
    expect(a4.clips[0]).toMatchObject({ start: 60, duration: 60, sourceIn: 75 });
    expect(a4.clips[0]!.gainDb).toEqual([{ frame: 0, value: -3, interp: "linear" }]);
  });

  it("rendered overlays (M3) go to V2 graphics / V3 HUD alpha tracks instead of markers", () => {
    const t = clone(base);
    const conformed = fakeConform(t, DIR);
    const items = t.overlays.slice(0, 2);
    for (const it of items) {
      conformed[overlayKey(it.id)] = { assetId: null, localPath: `${DIR}/media/ovl-${it.id.replace(/[^a-z0-9]/gi, "")}.mov`, name: `ovl-${it.id.replace(/[^a-z0-9]/gi, "")}.mov`, kind: "video", width: 1920, height: 1080, durationFrames: it.dur, hasVideo: true, hasAudio: false, audioChannels: null, alpha: true };
    }
    const et = toExportTimeline(t, { exportDir: DIR, exportRoot: null, conformed });
    const v2 = et.video.slice(1).flatMap((v) => v.clips);
    expect(v2.map((c) => c.id).sort()).toEqual(items.map((i) => i.id).sort());
    for (const it of items) expect(et.markers.some((m) => m.name === it.component && m.frame === it.from && m.duration === it.dur)).toBe(false);
    expect(writeXmeml(et, { flavour: "premiere" })).toContain("<alphatype>straight</alphatype>");
  });

  it("video with sound is placed muted on V1 in FCPXML (srcEnable=video); audio never reads past its media", () => {
    const t = clone(base);
    const et = exportOf(t);
    if (t.video.some((c) => c.source.kind === "video")) expect(writeFcpxml(et, { version: "1.10" })).toMatch(/<asset-clip [^>]*srcEnable="video"/);
    const conformed = fakeConform(t, DIR);
    const v = t.audio.vo[0]!;
    conformed[v.assetId]!.durationFrames = v.sourceInFrames + v.dur - 7;
    const et2 = toExportTimeline(t, { exportDir: DIR, exportRoot: null, conformed });
    expect(et2.audio[0]!.clips[0]!.duration).toBe(v.dur - 7);
  });

  it("generated sources use the gen:<clipId> still", () => {
    const g = base.video.find((c: VisualClip) => c.source.kind === "generated")!;
    const conformed = fakeConform(base, DIR);
    const et = toExportTimeline(base, { exportDir: DIR, exportRoot: null, conformed });
    const ec = et.video[0]!.clips.find((c) => c.id === g.id)!;
    expect(et.media.find((m) => m.id === ec.mediaId)!.localPath).toBe(conformed[`gen:${g.id}`]!.localPath);
  });
});

describe("helpers", () => {
  it("loopPieces", () => {
    expect(loopPieces(0, 100, 10, 40, true)).toEqual([{ start: 0, duration: 30, sourceIn: 10 }, { start: 30, duration: 40, sourceIn: 0 }, { start: 70, duration: 30, sourceIn: 0 }]);
    expect(loopPieces(5, 100, 10, 40, false)).toEqual([{ start: 5, duration: 30, sourceIn: 10 }]);
    expect(loopPieces(5, 10, 0, null, true)).toEqual([{ start: 5, duration: 10, sourceIn: 0 }]);
    expect(loopPieces(0, 0, 0, 10, true)).toEqual([]);
  });
  it("packLanes is first-fit and stable", () => {
    const lanes = packLanes([{ start: 0, duration: 10 }, { start: 5, duration: 10 }, { start: 10, duration: 5 }, { start: 12, duration: 1 }]);
    expect(lanes.map((l) => l.map((c) => c.start))).toEqual([[0, 10], [5], [12]]);
  });
});
