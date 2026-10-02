// Step 12 — MARKERS, ASSETS, USAGE (§9.3).
import { P, collectAssetIds, ids, msToFrame, type Marker, type Timeline, type TimelineAsset } from "@docmaker/core";
import type { Ctx, Shot } from "./ctx";
import { AD_BREAK_NAME } from "./resources";

const mk = (ctx: Ctx, m: Omit<Marker, "frame"> & { frame: number }): Marker => ({ ...m, frame: Math.max(0, Math.min(ctx.N - 1, m.frame)), name: m.name.slice(0, 200), note: m.note.slice(0, 2000) });

/** Ad-break positions: the outline's adBreakAfter, else the style schedule (first after ≥ firstAfterSec[0], then ≥ everySec[0]). */
function adBreakChapters(ctx: Ctx): string[] {
  if (ctx.outline) return ctx.outline.chapters.filter((c) => c.adBreakAfter).map((c) => c.id);
  const ab = ctx.style.scriptProfile.adBreaks;
  const out: string[] = [];
  let next = ab.firstAfterSec[0];
  for (const ch of ctx.chapters.slice(0, -1)) {
    if (ch.end / ctx.fps >= next) { out.push(ch.id); next = ch.end / ctx.fps + ab.everySec[0]; }
  }
  return out;
}

export function buildMarkers(ctx: Ctx, shots: readonly Shot[]): Marker[] {
  const out: Marker[] = [];
  for (const ch of ctx.chapters) out.push(mk(ctx, { id: ids.marker("chapter", ch.id), frame: ch.from, dur: 0, name: ch.title || ch.id, note: ch.act, color: "blue", kind: "chapter" }));
  for (const id of adBreakChapters(ctx)) {
    const ch = ctx.chapters.find((c) => c.id === id);
    if (!ch || ch.end >= ctx.N) continue;
    out.push(mk(ctx, { id: ids.marker("ad-break", id), frame: ch.end, dur: 0, name: AD_BREAK_NAME[ctx.lang], note: `after ${id}`, color: "red", kind: "ad-break" }));
  }
  for (const s of ctx.layout.sponsorMarkers) out.push(mk(ctx, { id: ids.marker("sponsor", s.segmentId), frame: s.frame, dur: 0, name: "Sponsor", note: s.segmentId, color: "purple", kind: "sponsor" }));
  for (const it of ctx.I.factCheck?.items ?? []) {
    if (it.resolution === "rewritten") continue;
    const seg = ctx.segById.get(it.where);
    const beat = ctx.beatById.get(it.where);
    const frame = seg ? seg.from : beat ? beat.from : null;
    if (frame === null) continue;
    out.push(mk(ctx, {
      id: ids.marker("factcheck", it.id), frame, dur: 0, name: `Fact-check: ${it.verdict} (${it.risk})`,
      note: [it.sentence, it.problem, it.resolution !== "open" ? `resolution: ${it.resolution}${it.note ? ` — ${it.note}` : ""}` : ""].filter(Boolean).join(" | "),
      color: "yellow", kind: "factcheck",
    }));
  }
  for (const seg of ctx.layout.segments) {
    if (seg.mode !== "clip") continue;
    const clip = ctx.clipBySeg.get(seg.segmentId);
    const label = shots.find((s) => s.beatId === `${seg.segmentId}-CLIP` && s.sourceLabel)?.sourceLabel ?? "Clip";
    const yt = clip?.youtube;
    const note = yt ? `${yt.url} ${yt.startMs !== null ? `@${(yt.startMs / 1000).toFixed(1)}s` : ""}`.trim() : clip?.source ?? "";
    out.push(mk(ctx, { id: ids.marker("source", seg.segmentId), frame: seg.from, dur: seg.dur, name: label, note, color: "green", kind: "source" }));
  }
  for (const segId of [...ctx.I.pickupSegments].sort()) {
    const seg = ctx.segById.get(segId);
    if (!seg) continue;
    out.push(mk(ctx, { id: ids.marker("pickup", segId), frame: seg.from, dur: seg.dur, name: "PICKUP TTS", note: segId, color: "orange", kind: "pickup" }));
  }
  return out.sort((a, b) => a.frame - b.frame || (a.id < b.id ? -1 : 1));
}

/** TimelineAsset for every id referenced by the timeline (frozen, VO segments, vo_program, SFX entries, music tracks). */
export function buildAssets(ctx: Ctx, t: Pick<Timeline, "video" | "overlays" | "audio">): Record<string, TimelineAsset> {
  const out: Record<string, TimelineAsset> = {};
  const voSeg = new Map<string, { rel: string; ms: number }>();
  for (const s of ctx.layout.segments) {
    if (s.voAssetId && s.voFile) voSeg.set(s.voAssetId, { rel: s.voFile, ms: s.endMs - s.startMs - s.insertions.reduce((a, x) => a + x.ms, 0) });
  }
  const sfx = new Map(ctx.I.sfx.map((e) => [e.assetId, e]));
  const music = new Map(ctx.I.music.map((m) => [m.assetId, m]));
  const wav = (id: string, frames: number | null, rel: string): TimelineAsset => ({ id, kind: "audio", ext: "wav", mime: "audio/wav", width: null, height: null, durationFrames: frames, hasAudio: true, projectRel: rel });
  for (const id of collectAssetIds(t as Timeline)) {
    const f = ctx.frozen[id];
    if (f) {
      out[id] = {
        id, kind: f.kind, ext: f.ext, mime: f.mime, width: f.width, height: f.height, durationFrames: f.durationMs !== null ? msToFrame(f.durationMs, ctx.fps) : null,
        hasAudio: f.hasAudio, projectRel: f.projectRel,
      };
      continue;
    }
    if (id === ctx.layout.voProgram.assetId) { out[id] = wav(id, msToFrame(ctx.layout.voProgram.durationMs, ctx.fps), ctx.layout.voProgram.projectRel); continue; }
    const v = voSeg.get(id);
    if (v) { out[id] = wav(id, msToFrame(v.ms, ctx.fps), v.rel); continue; }
    const e = sfx.get(id);
    if (e) { out[id] = wav(id, msToFrame(e.durationMs, ctx.fps), P.media(id, "wav")); continue; }
    const m = music.get(id);
    if (m) { out[id] = wav(id, msToFrame(m.durationMs, ctx.fps), P.media(id, "wav")); continue; }
  }
  return out;
}

/** assetId → item ids using it (sorted, unique). */
export function buildUsage(t: Timeline): { assetId: string; itemIds: string[] }[] {
  const m = new Map<string, Set<string>>();
  const add = (a: string, item: string) => { const s = m.get(a) ?? new Set<string>(); s.add(item); m.set(a, s); };
  const walk = (v: unknown, item: string) => {
    if (Array.isArray(v)) { for (const x of v) walk(x, item); return; }
    if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/assetid$/i.test(k) && typeof x === "string") add(x, item); else walk(x, item);
    }
  };
  for (const c of t.video) if (c.source.kind === "image" || c.source.kind === "video") add(c.source.assetId, c.id);
  for (const o of t.overlays) walk(o.props, o.id);
  add(t.audio.voProgram.assetId, "vo_program");
  for (const x of [...t.audio.vo, ...t.audio.music, ...t.audio.sfx, ...t.audio.clip]) add(x.assetId, x.id);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([assetId, s]) => ({ assetId, itemIds: [...s].sort() }));
}
