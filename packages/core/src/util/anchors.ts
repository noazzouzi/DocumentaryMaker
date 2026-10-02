// packages/core/src/util/anchors.ts — word/segment/beat/chapter anchors → integer frames (audio is the clock). Isomorphic.
import type { ProgramLayout } from "../schema/layout";
import type { Anchor, Timeline } from "../schema/timeline";
import { DocmakerError } from "./errors";

export interface AnchorIndex {
  words: Map<string, { from: number; end: number; norm: string }>; // end = from + dur
  segments: Map<string, { from: number; end: number }>;
  beats: Map<string, { from: number; end: number }>;
  chapters: Map<string, { from: number; end: number }>;
  programEnd: number;
  layoutHash: string;
}

export function buildAnchorIndex(layout: ProgramLayout, layoutHash: string): AnchorIndex {
  const words = new Map<string, { from: number; end: number; norm: string }>();
  for (const w of layout.words) words.set(w.id, { from: w.from, end: w.from + w.dur, norm: w.norm });
  const segments = new Map<string, { from: number; end: number }>();
  for (const s of layout.segments) segments.set(s.segmentId, { from: s.from, end: s.from + s.dur });
  const beats = new Map<string, { from: number; end: number }>();
  for (const b of layout.beats) beats.set(b.beatId, { from: b.from, end: b.from + b.dur });
  const chapters = new Map<string, { from: number; end: number }>();
  for (const c of layout.chapters) chapters.set(c.chapterId, { from: c.from, end: c.from + c.dur });
  return { words, segments, beats, chapters, programEnd: layout.durationInFrames, layoutHash };
}

function target(a: Anchor, ix: AnchorIndex): { from: number; end: number } {
  let t: { from: number; end: number } | undefined;
  let id: string;
  switch (a.ref) {
    case "word": id = a.wordId; t = ix.words.get(a.wordId); break;
    case "segment": id = a.segmentId; t = ix.segments.get(a.segmentId); break;
    case "beat": id = a.beatId; t = ix.beats.get(a.beatId); break;
    case "chapter": id = a.chapterId; t = ix.chapters.get(a.chapterId); break;
    case "program": return { from: 0, end: ix.programEnd };
  }
  if (!t) throw new DocmakerError("ANCHOR_MISSING", `anchor target ${a.ref}:${id} not found in the layout`, { details: a });
  return t;
}

/** start edge → from, end edge → end; + offset; clamped to [0, programEnd]. Unknown id → DocmakerError("ANCHOR_MISSING"). */
export function resolveAnchor(a: Anchor, ix: AnchorIndex): number {
  const t = target(a, ix);
  const f = (a.edge === "start" ? t.from : t.end) + a.offset;
  return Math.min(ix.programEnd, Math.max(0, f));
}

type Timed = { id: string; start: Anchor; end: Anchor; from: number; dur: number };

function resolveList<T extends Timed>(items: readonly T[], ix: AnchorIndex, dropped: string[]): T[] {
  const out: T[] = [];
  for (const it of items) {
    let from: number, end: number;
    try {
      from = resolveAnchor(it.start, ix);
      end = resolveAnchor(it.end, ix);
    } catch (e) {
      if (e instanceof DocmakerError && e.code === "ANCHOR_MISSING") { dropped.push(it.id); continue; }
      throw e;
    }
    const dur = end - from;
    if (dur < 1) { dropped.push(it.id); continue; }
    out.push(it.from === from && it.dur === dur ? it : { ...it, from, dur });
  }
  return out;
}

/**
 * Re-resolves every timed item's from/dur from its anchors and keeps video contiguous. VALID ONLY when
 * ix.layoutHash === t.layoutHash (else throws VALIDATION "re-direct required"). Pure.
 * Video: cut points come from each clip's start anchor (the first clip starts at 0, the last ends at durationInFrames);
 * a clip whose resolved span collapses is dropped and its predecessor absorbs the gap.
 */
export function resolveTimeline(t: Timeline, ix: AnchorIndex): { timeline: Timeline; dropped: string[] } {
  if (ix.layoutHash !== t.layoutHash) {
    throw new DocmakerError("VALIDATION", "re-direct required: the timeline was built against another layout", {
      details: { timelineLayoutHash: t.layoutHash, indexLayoutHash: ix.layoutHash },
    });
  }
  const dropped: string[] = [];
  const N = t.durationInFrames;

  // video: contiguous over [0, N)
  const starts: { clip: Timeline["video"][number]; s: number }[] = [];
  for (const c of t.video) {
    try {
      starts.push({ clip: c, s: resolveAnchor(c.start, ix) });
    } catch (e) {
      if (e instanceof DocmakerError && e.code === "ANCHOR_MISSING") { dropped.push(c.id); continue; }
      throw e;
    }
  }
  starts.sort((a, b) => a.s - b.s);
  if (starts.length > 0) starts[0]!.s = 0;
  const video: Timeline["video"] = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]!.s;
    const e = i + 1 < starts.length ? starts[i + 1]!.s : N;
    const c = starts[i]!.clip;
    if (e - s < 1) {
      dropped.push(c.id);
      if (i + 1 < starts.length) starts[i + 1]!.s = s; // successor starts here instead
      continue;
    }
    video.push(c.from === s && c.dur === e - s ? c : { ...c, from: s, dur: e - s });
  }
  // last kept clip must reach N
  if (video.length > 0) {
    const last = video[video.length - 1]!;
    if (last.from + last.dur !== N) video[video.length - 1] = { ...last, dur: N - last.from };
  }

  const a = t.audio;
  const timeline: Timeline = {
    ...t,
    video,
    overlays: resolveList(t.overlays, ix, dropped),
    captions: resolveList(t.captions, ix, dropped),
    fx: resolveList(t.fx, ix, dropped),
    audio: {
      ...a,
      vo: resolveList(a.vo, ix, dropped),
      music: resolveList(a.music, ix, dropped),
      sfx: resolveList(a.sfx, ix, dropped),
      clip: resolveList(a.clip, ix, dropped),
      silences: resolveList(a.silences, ix, dropped),
    },
  };
  return { timeline, dropped };
}
