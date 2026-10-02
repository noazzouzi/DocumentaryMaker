// Chapter-aligned render chunks (§10.3): every chapter starts a chunk; chapters longer than chunkFrames are split
// evenly. `to` is INCLUSIVE (it is the renderMedia frameRange end and RenderChunk.to).
import type { ComputedTimeline } from "./types";

export function planChunks(ct: ComputedTimeline, chunkFrames: number): { index: number; from: number; to: number }[] {
  const size = Number.isFinite(chunkFrames) && chunkFrames >= 1 ? Math.floor(chunkFrames) : Number.POSITIVE_INFINITY;
  const out: { index: number; from: number; to: number }[] = [];
  const chapters = [...ct.chapters].filter((c) => c.dur > 0).sort((a, b) => a.from - b.from);
  const ranges: { from: number; dur: number }[] = chapters.length ? chapters : [{ from: 0, dur: ct.durationInFrames }];
  for (const ch of ranges) {
    const from = Math.max(0, ch.from);
    const end = Math.min(ct.durationInFrames, ch.from + ch.dur);
    const dur = end - from;
    if (dur <= 0) continue;
    const n = Math.max(1, Math.ceil(dur / size));
    for (let k = 0; k < n; k++) {
      const a = from + Math.round((k * dur) / n);
      const b = from + Math.round(((k + 1) * dur) / n);
      if (b > a) out.push({ index: out.length, from: a, to: b - 1 });
    }
  }
  return out;
}
