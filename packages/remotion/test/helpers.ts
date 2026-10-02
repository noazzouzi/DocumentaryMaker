// Test helpers: timeline surgery on factory timelines (transitions, shifts, insertions).
import type { Timeline, Transition, VisualClip } from "@docmaker/core";
import { makeTimeline } from "@docmaker/core/testing";

export const clone = <T>(v: T): T => structuredClone(v);

const cache = new Map<string, Timeline>();
/** makeTimeline memoised per option set (factories are deterministic); always returns a fresh clone. */
export function timeline(o: Parameters<typeof makeTimeline>[0] = {}): Timeline {
  const key = JSON.stringify(o);
  let t = cache.get(key);
  if (!t) {
    t = makeTimeline(o);
    cache.set(key, t);
  }
  return clone(t);
}

export const cut: Transition = { kind: "cut", accent: { type: "none" } };

/** Sets clip i's transitionIn (index into t.video). */
export function withTransition(t: Timeline, i: number, tr: Transition): Timeline {
  const u = clone(t);
  u.video[i] = { ...u.video[i]!, transitionIn: tr };
  return u;
}

/** Index of the first clip (not the first of its chapter) whose previous clip and itself are at least `minDur` long. */
export function innerClipIndex(t: Timeline, minDur = 40, kind?: VisualClip["source"]["kind"]): number {
  const firsts = new Set(t.chapters.map((c) => c.from));
  for (let i = 1; i < t.video.length; i++) {
    const c = t.video[i]!;
    const p = t.video[i - 1]!;
    if (firsts.has(c.from) || c.chapterId !== p.chapterId) continue;
    if (c.dur >= minDur && p.dur >= minDur && (!kind || c.source.kind === kind)) return i;
  }
  throw new Error("no inner clip");
}

/** Pure shift: a k-frame lead-in chapter (one solid clip) is prepended; every original item moves by exactly k. */
export function shiftAll(t: Timeline, k: number): Timeline {
  const u = clone(t);
  u.durationInFrames += k;
  const lead: VisualClip = {
    ...u.video[0]!, id: "v:LEAD:0", from: 0, dur: k, chapterId: "CH0", beatId: null, source: { kind: "solid", color: "#000000" },
    layout: "cover", layoutParams: null, transitionIn: cut, name: "lead-in",
  };
  u.chapters = [{ id: "CH0", title: "Lead-in", act: u.chapters[0]!.act, from: 0, dur: k }, ...u.chapters.map((c) => ({ ...c, from: c.from + k }))];
  u.video = [lead, ...u.video.map((c) => ({ ...c, from: c.from + k }))];
  u.overlays = u.overlays.map((o) => ({ ...o, from: o.from + k }));
  u.captions = u.captions.map((g) => ({ ...g, from: g.from + k, words: g.words.map((w) => ({ ...w, from: w.from + k })) }));
  u.fx = u.fx.map((f) => ({ ...f, from: f.from + k }));
  return u;
}

/** Lengthens chapter 1 by k frames (its last clip grows), shifting everything after it. */
export function lengthenFirstChapter(t: Timeline, k: number): Timeline {
  const u = clone(t);
  const ch1 = u.chapters[0]!;
  const end = ch1.from + ch1.dur;
  u.durationInFrames += k;
  u.chapters = u.chapters.map((c, i) => (i === 0 ? { ...c, dur: c.dur + k } : { ...c, from: c.from + k }));
  u.video = u.video.map((c) => (c.from + c.dur === end ? { ...c, dur: c.dur + k } : c.from >= end ? { ...c, from: c.from + k } : c));
  u.overlays = u.overlays.map((o) => (o.from >= end ? { ...o, from: o.from + k } : o));
  u.captions = u.captions.map((g) => (g.from >= end ? { ...g, from: g.from + k, words: g.words.map((w) => ({ ...w, from: w.from + k })) } : g));
  u.fx = u.fx.map((f) => (f.from >= end ? { ...f, from: f.from + k } : f));
  return u;
}
