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

