// AI-illustration disclosure on the final picture track (§7.4, §9.3 step 7f): "every AI image on screen gets
// SourceLabel{kind:"illustration"}". Step 7 derives the labels from the director's own picks; overrides (step 13) can
// swap sources afterwards, so the labels are re-derived from the final timeline.video: a run of consecutive clips
// showing the same AI asset gets exactly one label spanning the run, and labels that no longer match such a run
// (stale after a replaceSource, or a false disclosure over a real photo) are removed.
import { COMPONENT_META, framesAt, ids, type OverlayItem, type Timeline } from "@docmaker/core";
import { LABEL_TEXT } from "./resources";

export type AiRun = { from: number; end: number; assetId: string; first: number; last: number };

const isIllustration = (o: OverlayItem): boolean =>
  o.component === "SourceLabel" && (o.props as { kind?: unknown }).kind === "illustration";

/** Runs of consecutive picture clips that show the same AI asset. */
export function aiRuns(t: Timeline, isAi: (assetId: string) => boolean): AiRun[] {
  const out: AiRun[] = [];
  for (let i = 0; i < t.video.length; i++) {
    const s = t.video[i]!.source;
    if ((s.kind !== "image" && s.kind !== "video") || !isAi(s.assetId)) continue;
    let j = i;
    while (j + 1 < t.video.length) {
      const n = t.video[j + 1]!.source;
      if ((n.kind === "image" || n.kind === "video") && n.assetId === s.assetId) j++;
      else break;
    }
    out.push({ from: t.video[i]!.from, end: t.video[j]!.from + t.video[j]!.dur, assetId: s.assetId, first: i, last: j });
    i = j;
  }
  return out;
}

/** Frames of [from, end) that no illustration label covers (first uncovered frame, or null). */
export function uncoveredFrame(labels: readonly { from: number; dur: number }[], from: number, end: number): number | null {
  const xs = [...labels].sort((a, b) => a.from - b.from);
  let f = from;
  for (const l of xs) {
    if (l.from > f) break;
    f = Math.max(f, l.from + l.dur);
    if (f >= end) return null;
  }
  return f < end ? f : null;
}

/** Re-derives the AI-illustration SourceLabels from the final picture track (idempotent on a consistent timeline). */
export function reconcileAiLabels(t: Timeline, isAi: (assetId: string) => boolean): Timeline {
  const runs = aiRuns(t, isAi);
  const labels = t.overlays.filter(isIllustration);
  const exact = (o: OverlayItem, r: AiRun) => o.from === r.from && o.from + o.dur === r.end;
  const keep = new Set(labels.filter((o) => runs.some((r) => exact(o, r))).map((o) => o.id));
  const missing = runs.filter((r) => !labels.some((o) => keep.has(o.id) && exact(o, r)));
  if (keep.size === labels.length && missing.length === 0) return t;
  const overlays = t.overlays.filter((o) => !isIllustration(o) || keep.has(o.id));
  const used = new Set<string>([...t.overlays.map((o) => o.id), ...t.video.map((c) => c.id)]);
  const m = COMPONENT_META.SourceLabel;
  const text = LABEL_TEXT[t.lang].illustration;
  for (const r of missing) {
    const c0 = t.video[r.first]!, c1 = t.video[r.last]!;
    const ref = c0.beatId ?? c0.chapterId;
    let n = 0;
    while (used.has(ids.overlay(ref, "SourceLabel", n))) n++;
    const id = ids.overlay(ref, "SourceLabel", n);
    used.add(id);
    // the disclosure is mandatory: take topLeft unless another HUD label sits there, then topRight, else topLeft anyway
    const busy = (z: "topLeft" | "topRight") => overlays.some((o) => o.component === "SourceLabel" && o.zone === z && o.from < r.end && r.from < o.from + o.dur);
    const zone = !busy("topLeft") ? "topLeft" : !busy("topRight") ? "topRight" : "topLeft";
    overlays.push({
      id, start: c0.start, end: c1.end, from: r.from, dur: r.end - r.from, beatId: c0.beatId, band: m.band, z: 300 + m.priority, zone,
      enterFrames: framesAt(t.fps, m.enter30), exitFrames: framesAt(t.fps, m.exit30), followsCamera: m.followsCamera,
      component: "SourceLabel", props: { text, kind: "illustration", zone },
    } as OverlayItem);
  }
  overlays.sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1));
  return { ...t, overlays };
}
