// Timelines for render-integration tests: the 60 s factory timeline + one transition of each M1 class and an M2 item.
import type { OverlayItem, Timeline } from "@docmaker/core";
import { makeTimeline } from "@docmaker/core/testing";
import { sampleItem } from "../../src/specimen/samples";

/** Timeline under test: the 60 s factory timeline + one transition of each M1 class and an M2 item (FallbackCard). */
export function buildTimeline(): Timeline {
  const base = makeTimeline({ seconds: 60 });
  const u = structuredClone(base);
  const firsts = new Set(u.chapters.map((c) => c.from));
  const inner = u.video.map((c, i) => ({ c, i })).filter(({ c, i }) => i > 0 && !firsts.has(c.from) && c.transitionIn.kind === "cut" && c.transitionIn.accent.type === "none" && c.dur >= 30 && u.video[i - 1]!.dur >= 30);
  const set = (k: number, tr: Timeline["video"][number]["transitionIn"]) => {
    const it = inner[k];
    if (it) u.video[it.i] = { ...it.c, transitionIn: tr };
  };
  set(0, { kind: "cut", accent: { type: "velocity", preset: "whip", direction: "left", exitFrames: 8, entryFrames: 8, flash: 0 } });
  set(1, { kind: "cut", accent: { type: "velocity", preset: "zoomThrough", direction: "left", exitFrames: 6, entryFrames: 15, flash: 0 } });
  set(2, { kind: "cover", presentation: "dipToBlack", durationFrames: 30, direction: "left", color: "#000000", peak: 1 });
  set(3, { kind: "cover", presentation: "glitch", durationFrames: 6, direction: "left", color: "#FFFFFF", peak: 0.8 });
  set(4, { kind: "cut", accent: { type: "velocity", preset: "pushCut", direction: "left", exitFrames: 5, entryFrames: 6, flash: 0.2 } });
  // an M2 component (QuoteCard) and an id unknown to this build (→ FallbackCard) late in CH2
  const q = sampleItem("QuoteCard", u.render, u.fps, "en", 75);
  u.overlays.push({ ...q, id: "ov:CH2:QuoteCard:9", from: 1640, dur: 60 } as OverlayItem);
  u.overlays.push({ ...q, id: "ov:CH2:FutureThing:9", component: "FutureThing", props: { text: "A component from a newer build" }, from: 1700, dur: 60 } as unknown as OverlayItem);
  return u;
}


type Clip = Timeline["video"][number];
type Tr = Clip["transitionIn"];
export interface FeatureCut { clipId: string; key: string; cut: number; d: number }
export interface FeatureClip { clipId: string; key: string; from: number; dur: number }
export interface FeatureCaption { groupId: string; variant: string; from: number; dur: number }
export interface FeatureTimeline { t: Timeline; covers: FeatureCut[]; overlaps: FeatureCut[]; layouts: FeatureClip[]; captions: FeatureCaption[] }

/** A portrait image asset (contain-blur needs a frame that does not match 16:9). */
export const PORTRAIT_ASSET_ID = "c0ffee".padEnd(64, "0");

/**
 * The 240 s factory timeline with every M3 cover and overlap, the M2 picture layouts (pip, contain-blur on a portrait,
 * split-left/right), the three treatments and the M2 caption variants, at known places. Camera fx are removed so the
 * layout geometry is exact (fx are covered by the main timeline).
 */
export function buildFeatureTimeline(): FeatureTimeline {
  const u = structuredClone(makeTimeline({ seconds: 240 }));
  u.fx = [];
  const firsts = new Set(u.chapters.map((c) => c.from));
  const used = new Set<number>();
  /** A clip for a transition: plain cut, not a chapter start, no transition on either neighbour. */
  const free = (pred: (c: Clip, i: number) => boolean): number => {
    const i = u.video.findIndex((c, k) => k > 0 && !used.has(k) && !used.has(k - 1) && !used.has(k + 1) && !firsts.has(c.from) && c.transitionIn.kind === "cut" && c.transitionIn.accent.type === "none" && pred(c, k));
    if (i < 0) throw new Error("feature timeline: no free clip left");
    used.add(i);
    return i;
  };
  /** A clip for a layout/treatment probe (stills are taken mid-clip, away from its cuts). */
  const any = (pred: (c: Clip) => boolean): number => {
    const i = u.video.findIndex((c, k) => !used.has(k) && pred(c));
    if (i < 0) throw new Error("feature timeline: no clip left for a layout probe");
    used.add(i);
    return i;
  };
  const covers: FeatureCut[] = [];
  const overlaps: FeatureCut[] = [];
  const coverOf = (presentation: string, d: number, color: string): Tr => ({ kind: "cover", presentation, durationFrames: d, direction: "left", color, peak: 1 }) as Tr;
  for (const [p, d, color] of [["filmBurn", 20, "#FFFFFF"], ["whipStreaks", 8, "#FFFFFF"], ["paperRip", 12, "#FFFFFF"], ["dotWipe", 13, "#000000"], ["iris", 12, "#000000"]] as const) {
    const i = free((c, k) => c.dur >= 24 && u.video[k - 1]!.dur >= 24);
    u.video[i] = { ...u.video[i]!, transitionIn: coverOf(p, d, color) };
    covers.push({ clipId: u.video[i]!.id, key: p, cut: u.video[i]!.from, d });
  }
  for (const [p, d] of [["push", 16], ["wipe", 16], ["blurDissolve", 18]] as const) {
    const i = free((c, k) => c.dur >= 40 && u.video[k - 1]!.dur >= 40);
    u.video[i] = { ...u.video[i]!, transitionIn: { kind: "overlap", presentation: p, durationFrames: d, direction: "left" } as Tr };
    overlaps.push({ clipId: u.video[i]!.id, key: p, cut: u.video[i]!.from, d });
  }
  const portrait = Object.values(u.assets).find((a) => a.kind === "image")!;
  u.assets[PORTRAIT_ASSET_ID] = { ...portrait, id: PORTRAIT_ASSET_ID, width: 1080, height: 1350, projectRel: `media/${PORTRAIT_ASSET_ID}.jpg` };
  const layouts: FeatureClip[] = [];
  const layout = (key: string, pred: (c: Clip) => boolean, patch: (c: Clip) => Partial<Clip>) => {
    const i = any((c) => c.dur >= 60 && pred(c));
    u.video[i] = { ...u.video[i]!, ...patch(u.video[i]!) };
    layouts.push({ clipId: u.video[i]!.id, key, from: u.video[i]!.from, dur: u.video[i]!.dur });
  };
  layout("pip", (c) => c.source.kind === "video", () => ({
    layout: "pip", sourceLabel: "Source: Haarlem TV, 1637",
    layoutParams: { backdrop: "gradientGrid", heightFrac: 0.76, borderPx: 0, tiltDeg: 0, shadow: true, stroke: "#FFFFFF", entry: "scale", backdropSeed: 7 },
  }));
  layout("contain-blur", (c) => c.source.kind === "image" && c.layout === "cover", (c) => ({ layout: "contain-blur", source: { kind: "image", assetId: PORTRAIT_ASSET_ID, crop: null, focal: { x: 0.5, y: 0.5 } }, camera: { ...c.camera, kind: "static", keys: [{ f: 0, scale: 1, x: 0, y: 0, rot: 0 }] } }));
  layout("split-left", (c) => c.source.kind === "image" && c.layout === "cover", () => ({ layout: "split-left" }));
  layout("split-right", (c) => c.source.kind === "image" && c.layout === "cover", () => ({ layout: "split-right" }));
  layout("bw", (c) => c.source.kind === "image" && c.layout === "cover", () => ({ treatment: "bw" }));
  layout("none", (c) => c.source.kind === "image" && c.layout === "cover", () => ({ treatment: "none" }));
  layout("archival", (c) => c.source.kind === "image" && c.layout === "cover", () => ({ treatment: "archival" }));
  layout("duotone", (c) => c.source.kind === "image" && c.layout === "cover", () => ({ treatment: "duotone" }));
  // caption variants: subtitle-sized groups (the factory's srt groups) spread over the program, burned with a variant;
  // burned keyword groups overlapping them are dropped so each probe sees one group
  const candidates = u.captions.map((g, i) => ({ g, i })).filter(({ g }) => g.variant === "srt" && g.dur >= 20 && g.words.length >= 3);
  const captions: FeatureCaption[] = [];
  (["karaoke", "rail", "clip", "translation"] as const).forEach((variant, k) => {
    const it = candidates[Math.floor(((k + 0.5) * candidates.length) / 4)]!;
    u.captions[it.i] = { ...it.g, variant, burn: true };
    captions.push({ groupId: it.g.id, variant, from: it.g.from, dur: it.g.dur });
  });
  u.captions = u.captions.filter((g) => captions.some((c) => c.groupId === g.id) || !(g.burn && captions.some((c) => g.from < c.from + c.dur && c.from < g.from + g.dur)));
  return { t: u, covers, overlaps, layouts, captions };
}
