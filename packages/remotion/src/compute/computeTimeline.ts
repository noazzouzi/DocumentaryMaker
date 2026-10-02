// computeTimeline (§10.3): the pure interpretation of a Timeline shared by calculateMetadata, the Player, chunk
// planning and tests. It never throws on a structurally valid Timeline: anything the renderer cannot honour exactly
// (gaps, overlaps, odd overlap durations, missing handles) degrades to the nearest safe form and is listed in `warnings`.
import type { Anchor, CaptionGroup, FxCue, OverlayItem, Timeline, VisualClip } from "@docmaker/core";
import { coverWindow, derivedCoverFx } from "./covers";
import { derivedOverlayFx } from "./overlayFx";
import type { ComputedChapter, ComputedTimeline, CoverWindow, SeriesSeq, SeriesTrans, VelocityEdge } from "./types";
import { velocityPair } from "./velocity";

const programAnchor = (offset: number): Anchor => ({ ref: "program", edge: "start", offset });

/** A solid filler clip for frames no VisualClip covers (renders the ink colour). */
export function fillerClip(from: number, dur: number, chapterId: string, color: string): VisualClip {
  return {
    id: `gap:${from}`, start: programAnchor(from), end: programAnchor(from + dur), from, dur, chapterId, beatId: null,
    source: { kind: "solid", color }, layout: "cover", layoutParams: null,
    camera: { kind: "static", keys: [{ f: 0, scale: 1, x: 0, y: 0, rot: 0 }], ease: "linear", origin: { x: 0.5, y: 0.5 }, blurFromPx: 0, handheld: null, direction: "none" },
    treatment: "none", transitionIn: { kind: "cut", accent: { type: "none" } }, sourceLabel: null, name: "gap",
  };
}

/** Part of `c` restricted to [a, b) (camera keys and media offset shifted so the picture is unchanged). */
function slicePart(c: VisualClip, a: number, b: number): VisualClip {
  const from = Math.max(c.from, a);
  const end = Math.min(c.from + c.dur, b);
  const delta = from - c.from;
  if (delta === 0 && end === c.from + c.dur) return c;
  const source = c.source.kind === "video" ? { ...c.source, sourceInFrames: c.source.sourceInFrames + delta } : c.source;
  return {
    ...c,
    id: delta === 0 ? c.id : `${c.id}~${from}`,
    from, dur: end - from, source,
    camera: { ...c.camera, keys: c.camera.keys.map((k) => ({ ...k, f: k.f - delta })) },
    transitionIn: delta === 0 ? c.transitionIn : { kind: "cut", accent: { type: "none" } },
  };
}

interface ChapterRange { id: string; from: number; dur: number }

/** Chapters as contiguous ranges covering [0, N): sorted, overlaps trimmed, gaps filled with synthetic chapters. */
function chapterRanges(t: Timeline, warnings: string[]): ChapterRange[] {
  const N = t.durationInFrames;
  const src = [...t.chapters].filter((c) => c.dur > 0 && c.from < N).sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));
  const out: ChapterRange[] = [];
  let cursor = 0;
  for (const c of src) {
    let from = c.from;
    const end = Math.min(N, c.from + c.dur);
    if (from < cursor) {
      warnings.push(`chapter ${c.id} overlaps the previous chapter; trimmed to start at ${cursor}`);
      from = cursor;
    }
    if (end <= from) continue;
    if (from > cursor) {
      warnings.push(`frames [${cursor}, ${from}) belong to no chapter`);
      out.push({ id: `_gap@${cursor}`, from: cursor, dur: from - cursor });
    }
    out.push({ id: c.id, from, dur: end - from });
    cursor = end;
  }
  if (cursor < N) {
    if (src.length) warnings.push(`frames [${cursor}, ${N}) belong to no chapter`);
    out.push({ id: src.length ? `_gap@${cursor}` : "_all", from: cursor, dur: N - cursor });
  }
  return out;
}

/** Picture clips sorted, clipped to [0, N), overlaps trimmed and holes filled, so they tile [0, N) exactly. */
function tilePicture(t: Timeline, warnings: string[]): VisualClip[] {
  const N = t.durationInFrames;
  const ink = t.render.tokens.palette.ink;
  const sorted = [...t.video].filter((c) => c.dur > 0 && c.from < N).sort((a, b) => a.from - b.from || a.id.localeCompare(b.id));
  const out: VisualClip[] = [];
  let cursor = 0;
  for (const c0 of sorted) {
    let c = c0;
    if (c.from + c.dur > N) c = slicePart(c, 0, N);
    if (c.from < cursor) {
      const prev = out[out.length - 1];
      if (prev && prev.from < c.from) {
        warnings.push(`clip ${c.id} overlaps ${prev.id}; ${prev.id} trimmed`);
        out[out.length - 1] = slicePart(prev, prev.from, c.from);
        cursor = c.from;
      } else {
        warnings.push(`clip ${c.id} is hidden by an earlier clip; trimmed`);
        if (c.from + c.dur <= cursor) continue;
        c = slicePart(c, cursor, N);
      }
    }
    if (c.from > cursor) {
      warnings.push(`no picture on frames [${cursor}, ${c.from}); filled with ink`);
      out.push(fillerClip(cursor, c.from - cursor, c.chapterId, ink));
    }
    out.push(c);
    cursor = c.from + c.dur;
  }
  if (cursor < N) {
    if (sorted.length) warnings.push(`no picture on frames [${cursor}, ${N}); filled with ink`);
    out.push(fillerClip(cursor, N - cursor, t.chapters[t.chapters.length - 1]?.id ?? "_all", ink));
  }
  return out;
}

const cutNone = { kind: "cut", accent: { type: "none" } } as const;

/** Validates overlap transitions inside one chapter; downgrades the impossible ones to cuts. */
function validateOverlaps(clips: VisualClip[], warnings: string[]): VisualClip[] {
  return clips.map((c, i) => {
    const tr = c.transitionIn;
    if (tr.kind !== "overlap") return c;
    if (i === 0) {
      warnings.push(`clip ${c.id}: overlap on a chapter's first clip → cut`);
      return { ...c, transitionIn: cutNone };
    }
    const prev = clips[i - 1]!;
    let d = Math.floor(tr.durationFrames / 2) * 2;
    // lint T_OVERLAP: d ≤ min(prev.dur, cur.dur) − 2, so both handles of any clip fit inside it
    const maxD = Math.min(prev.dur, c.dur) - 2;
    if (d > maxD) d = Math.floor(maxD / 2) * 2;
    if (d !== tr.durationFrames) warnings.push(`clip ${c.id}: overlap ${tr.durationFrames} f adjusted to ${Math.max(0, d)} f`);
    if (d < 2) return { ...c, transitionIn: cutNone };
    return d === tr.durationFrames ? c : { ...c, transitionIn: { ...tr, durationFrames: d } };
  });
}

function buildSeries(t: Timeline, clips: VisualClip[], warnings: string[]): (SeriesSeq | SeriesTrans)[] {
  const series: (SeriesSeq | SeriesTrans)[] = [];
  const dOf = (c: VisualClip | undefined) => (c && c.transitionIn.kind === "overlap" ? c.transitionIn.durationFrames : 0);
  clips.forEach((c, i) => {
    const head = i > 0 ? dOf(c) / 2 : 0;
    const tail = i < clips.length - 1 ? dOf(clips[i + 1]) / 2 : 0;
    let trimBefore = 0;
    if (c.source.kind === "video") {
      trimBefore = c.source.sourceInFrames - head;
      if (trimBefore < 0) {
        warnings.push(`clip ${c.id}: head handle needs ${head} f before source frame ${c.source.sourceInFrames}; clamped`);
        trimBefore = 0;
      }
      const media = t.assets[c.source.assetId]?.durationFrames ?? null;
      if (media != null && c.source.sourceInFrames + c.dur + tail > media) {
        warnings.push(`clip ${c.id}: needs source frames up to ${c.source.sourceInFrames + c.dur + tail}, media has ${media}`);
      }
    }
    if (head > 0 && c.transitionIn.kind === "overlap") {
      const tr = c.transitionIn;
      series.push({ type: "trans", clipId: c.id, presentation: tr.presentation, durationInFrames: tr.durationFrames, direction: tr.direction });
    }
    series.push({ type: "seq", clip: c, durationInFrames: c.dur + head + tail, headHandle: head, tailHandle: tail, trimBefore });
  });
  return series;
}

const byZFromId = (a: OverlayItem, b: OverlayItem) => a.z - b.z || a.from - b.from || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function computeTimeline(t: Timeline): ComputedTimeline {
  const warnings: string[] = [];
  const N = Math.max(1, t.durationInFrames);
  const picture = tilePicture(t, warnings);
  const ranges = chapterRanges(t, warnings);

  // ---- chapters: clips cut at chapter boundaries (the director aligns them; this only guards malformed input)
  const chapters: ComputedChapter[] = [];
  const parts: VisualClip[] = [];
  let p = 0;
  for (const ch of ranges) {
    const a = ch.from;
    const b = ch.from + ch.dur;
    const clips: VisualClip[] = [];
    while (p < picture.length && picture[p]!.from + picture[p]!.dur <= a) p++;
    for (let i = p; i < picture.length && picture[i]!.from < b; i++) {
      const c = picture[i]!;
      if (c.from + c.dur <= a) continue;
      const part = slicePart(c, a, b);
      if (part !== c && (c.from < a || c.from + c.dur > b) && !c.id.startsWith("gap:")) {
        warnings.push(`clip ${c.id} straddles the boundary of chapter ${ch.id}; split`);
      }
      clips.push(part);
    }
    const valid = validateOverlaps(clips, warnings);
    parts.push(...valid);
    chapters.push({ id: ch.id, from: ch.from, dur: ch.dur, series: buildSeries(t, valid, warnings) });
  }

  // ---- cut accents, velocity edges and covers (program order; velocity A→B may cross a chapter boundary)
  const covers: CoverWindow[] = [];
  const exits: Record<string, VelocityEdge> = {};
  const entries: Record<string, VelocityEdge> = {};
  const cutFlashes: ComputedTimeline["cutFlashes"] = [];
  const pulses: ComputedTimeline["pulses"] = [];
  parts.forEach((c, i) => {
    const prev = i > 0 ? parts[i - 1]! : null;
    const tr = c.transitionIn;
    if (tr.kind === "cover") {
      const w = coverWindow(c, N);
      if (w) {
        if (w.presentation !== tr.presentation) warnings.push(`clip ${c.id}: cover ${tr.presentation} rendered as ${w.presentation}`);
        covers.push(w);
      }
    } else if (tr.kind === "cut") {
      const acc = tr.accent;
      if (acc.type === "pulse" && acc.amt > 0) pulses.push({ from: c.from, dur: Math.max(1, acc.frames), amt: acc.amt });
      else if (acc.type === "flash" && acc.peak > 0) {
        const d = Math.max(1, acc.frames);
        cutFlashes.push({ from: Math.max(0, c.from - Math.floor(d / 2)), dur: d, peak: Math.min(0.9, acc.peak), color: acc.color });
      } else if (acc.type === "velocity") {
        const vp = velocityPair(prev, c);
        if (vp?.exit && prev) exits[prev.id] = vp.exit;
        if (vp?.entry) entries[c.id] = vp.entry;
        if (vp?.flash) cutFlashes.push({ ...vp.flash, from: Math.max(0, vp.flash.from) });
      }
    }
  });

  // ---- overlays by band
  const overlays: ComputedTimeline["overlays"] = { picture: [], graphics: [], hud: [] };
  for (const it of t.overlays) {
    if (it.dur <= 0 || it.from >= N) continue;
    const item = it.from + it.dur > N ? ({ ...it, dur: N - it.from } as OverlayItem) : it;
    overlays[item.band].push(item);
  }
  overlays.picture.sort(byZFromId);
  overlays.graphics.sort(byZFromId);
  overlays.hud.sort(byZFromId);

  // ---- burned captions
  const captions: CaptionGroup[] = t.captions
    .filter((g) => g.burn && g.variant !== "srt" && g.dur > 0 && g.from < N && g.words.length > 0)
    .sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1));

  // ---- fx (+ derived from covers and from overlays that treat the picture behind them)
  const derivedOverlays = [...overlays.graphics, ...overlays.picture].flatMap(derivedOverlayFx);
  const fx: FxCue[] = [...t.fx.filter((c) => c.dur > 0 && c.from < N), ...covers.flatMap(derivedCoverFx), ...derivedOverlays].sort(
    (a, b) => a.from - b.from || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  cutFlashes.sort((a, b) => a.from - b.from);
  pulses.sort((a, b) => a.from - b.from);
  covers.sort((a, b) => a.from - b.from);

  return { fps: t.fps, width: t.width, height: t.height, durationInFrames: N, chapters, covers, exits, entries, cutFlashes, pulses, overlays, captions, fx, warnings };
}

/** All picture parts in program order (the clips VisualClipView renders), e.g. for origin lookups. */
export function pictureParts(ct: ComputedTimeline): VisualClip[] {
  const out: VisualClip[] = [];
  for (const ch of ct.chapters) for (const s of ch.series) if (s.type === "seq") out.push(s.clip);
  return out;
}

/** Index of the part containing frame f (binary search over program-ordered, tiled parts); -1 if none. */
export function partIndexAt(parts: readonly VisualClip[], f: number): number {
  let lo = 0;
  let hi = parts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = parts[mid]!;
    if (f < c.from) hi = mid - 1;
    else if (f >= c.from + c.dur) lo = mid + 1;
    else return mid;
  }
  return -1;
}
