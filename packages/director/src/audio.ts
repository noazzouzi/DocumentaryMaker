// Step 11 — AUDIO (§9.3, §9.6): silences (11a), J/L cuts (11d), ducking + voSpans + VO clips (11e), music sections.
import {
  ids, lerp, msToFrame, type ClipAudio, type DuckingSpec, type MusicSection, type SilenceMark, type VoClip,
} from "@docmaker/core";
import { anchorAt, clamp, cueFrame, cueWord, type Ctx, type Shot } from "./ctx";
import type { MusicPlan, PlannedSilence } from "./music";
import type { Bleep } from "./overlays";

/** 11a: reveal + chapter silences (planned in step 1), then drop_out, IRONY and bleeps. */
export function buildSilences(ctx: Ctx, music: MusicPlan, bleeps: readonly Bleep[]): PlannedSilence[] {
  const out: PlannedSilence[] = [...music.silences];
  const seen = new Set(out.map((s) => s.id));
  const push = (s: PlannedSilence) => {
    const from = clamp(s.from, 0, ctx.N - 1), end = clamp(s.end, from + 1, ctx.N);
    if (seen.has(s.id) || end - from < 1) return;
    seen.add(s.id);
    out.push({ ...s, from, end });
  };
  for (const b of ctx.beats) {
    if (b.plan.musicCue === "drop_out" || b.plan.sfx.includes("silence_drop")) {
      const len = ctx.S(lerp(ctx.M.dropOutSec, ctx.R(`dro:${b.id}`)()));
      const w = b.wordEnd > b.wordStart ? ctx.words[b.wordStart]! : null;
      push({ id: ids.silence("drop_out", b.id), reason: "drop_out", ref: b.id, from: b.onset, end: b.onset + len, affects: ["music"], anchorWord: w?.id ?? null });
    }
    b.cues.forEach((c, k) => {
      if (c.type !== "IRONY") return;
      const a = cueFrame(ctx, b, k);
      const len = ctx.S(lerp(ctx.M.ironyDropSec, ctx.R(`iro:${b.id}`)()));
      push({ id: ids.silence("irony", b.id), reason: "irony", ref: b.id, from: a, end: a + len, affects: ["music"], anchorWord: cueWord(ctx, b, k)?.id ?? null });
    });
  }
  for (const bl of bleeps) push({ id: ids.silence("bleep", bl.wordId), reason: "bleep", ref: bl.wordId, from: bl.from, end: bl.from + bl.dur, affects: ["vo"], anchorWord: bl.wordId });
  return out.sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1));
}

export function silenceItems(ctx: Ctx, sil: readonly PlannedSilence[]): SilenceMark[] {
  return sil.map((s) => {
    const hint = s.anchorWord ? { word: s.anchorWord } : s.reason === "chapter" ? { chapter: s.ref } : { beat: ctx.beatById.has(s.ref) ? s.ref : null };
    return { id: s.id, start: anchorAt(ctx, s.from, hint), end: anchorAt(ctx, s.end, hint), from: s.from, dur: s.end - s.from, reason: s.reason, affects: s.affects };
  });
}

/** 11d: ClipAudio per clip segment with J (12 f early) / L (9 f late) extensions when the VO leaves room. */
export function clipAudio(ctx: Ctx, shots: readonly Shot[]): { items: ClipAudio[]; jl: number } {
  const items: ClipAudio[] = [];
  let jl = 0;
  const J = ctx.F30(12), L = ctx.F30(9);
  for (const seg of ctx.layout.segments) {
    if (seg.mode !== "clip") continue;
    const pic = shots.filter((s) => s.role === "clip" && s.beatId === `${seg.segmentId}-CLIP`);
    if (!pic.length || !seg.clipAssetId) continue;
    const P0 = pic[0]!.from, P1 = pic[pic.length - 1]!.end;
    const S0 = pic[0]!.src.sourceIn;
    const media = pic[0]!.src.mediaFrames ?? Number.POSITIVE_INFINITY;
    let from = P0, end = P1, srcIn = S0;
    const wi = ctx.words.findIndex((w) => w.from >= P0);
    const prev = wi > 0 ? ctx.words[wi - 1] : wi < 0 ? ctx.words[ctx.words.length - 1] : undefined;
    const next = ctx.words.find((w) => w.from >= P1);
    if ((!prev || P0 - (prev.from + prev.dur) >= J) && S0 - J >= 0 && P0 - J >= 0) { from = P0 - J; srcIn = S0 - J; jl++; }
    if ((!next || next.from - P1 >= L) && S0 + (P1 - P0) + L <= media && P1 + L <= ctx.N) { end = P1 + L; jl++; }
    items.push({
      id: ids.clipAudio(seg.segmentId), start: anchorAt(ctx, from, { segment: seg.segmentId }), end: anchorAt(ctx, end, { segment: seg.segmentId }),
      from, dur: end - from, segmentId: seg.segmentId, assetId: seg.clipAssetId, sourceInFrames: srcIn, gainDb: 0, duckUnderVo: true,
    });
  }
  return { items, jl };
}

export function duckingSpec(ctx: Ctx): DuckingSpec {
  const M = ctx.M;
  return {
    musicDuckDb: Math.min(0, clamp(M.duckDb, M.duckRangeDb[0], M.duckRangeDb[1])), sfxDuckDb: Math.min(0, M.sfxDuckDb), clipDuckDb: Math.min(0, M.clipDuckDb),
    musicUnderClipDb: Math.min(0, clamp(M.duckDb, M.duckRangeDb[0], M.duckRangeDb[1])), attackMs: 150, releaseMs: 400, bridgeMs: 600, padBeforeMs: 80, padAfterMs: 120,
  };
}

/** Merged speech spans [from, to) of vo / clip-narrated words, bridged while the gap is < bridgeMs. */
export function voSpans(ctx: Ctx, d: DuckingSpec): [number, number][] {
  const out: [number, number][] = [];
  for (const seg of ctx.layout.segments) {
    if (seg.mode !== "vo" && seg.mode !== "clip-narrated") continue;
    for (const w of ctx.words.slice(seg.wordStart, seg.wordEnd)) {
      const a = w.from, b = w.from + w.dur;
      const last = out[out.length - 1];
      if (last && ((a - last[1]) * 1000) / ctx.fps < d.bridgeMs) last[1] = Math.max(last[1], b);
      else out.push([a, b]);
    }
  }
  return out;
}

/** Per-segment VO clips for NLE export (vo:<segmentId> and vo:<segmentId>:b after a REVEAL insertion). */
export function voClips(ctx: Ctx): VoClip[] {
  const out: VoClip[] = [];
  const gain = ctx.layout.voProgram.bakedGainDb;
  for (const seg of ctx.layout.segments) {
    if ((seg.mode !== "vo" && seg.mode !== "clip-narrated") || !seg.voAssetId || !/^[a-f0-9]{64}$/.test(seg.voAssetId)) continue;
    const end = seg.from + seg.dur;
    const ins = seg.insertions[0];
    if (!ins) {
      out.push({ id: ids.vo(seg.segmentId), start: anchorAt(ctx, seg.from, { segment: seg.segmentId }), end: anchorAt(ctx, end, { segment: seg.segmentId }), from: seg.from, dur: seg.dur, segmentId: seg.segmentId, assetId: seg.voAssetId, sourceInFrames: 0, gainDb: gain });
      continue;
    }
    const aEnd = Math.min(end - 1, seg.from + Math.max(1, msToFrame(ins.splitAtMs, ctx.fps)));
    const bFrom = Math.min(end - 1, Math.max(aEnd, seg.from + msToFrame(ins.splitAtMs + ins.ms, ctx.fps)));
    out.push({ id: ids.vo(seg.segmentId), start: anchorAt(ctx, seg.from, { segment: seg.segmentId }), end: anchorAt(ctx, aEnd, { segment: seg.segmentId }), from: seg.from, dur: aEnd - seg.from, segmentId: seg.segmentId, assetId: seg.voAssetId, sourceInFrames: 0, gainDb: gain });
    if (end - bFrom >= 1) {
      out.push({ id: ids.vo(seg.segmentId, "b"), start: anchorAt(ctx, bFrom, { segment: seg.segmentId }), end: anchorAt(ctx, end, { segment: seg.segmentId }), from: bFrom, dur: end - bFrom, segmentId: seg.segmentId, assetId: seg.voAssetId, sourceInFrames: msToFrame(ins.splitAtMs, ctx.fps), gainDb: gain });
    }
  }
  return out;
}

export function musicItems(ctx: Ctx, music: MusicPlan): MusicSection[] {
  return music.items.map((it) => ({
    id: it.id, start: anchorAt(ctx, it.from, { chapter: it.chapterId }), end: anchorAt(ctx, it.end, { chapter: it.chapterId }),
    from: it.from, dur: it.end - it.from, assetId: it.track.assetId, sourceInFrames: Math.max(0, it.sourceIn), loop: it.loop, gainDb: ctx.M.noVoGainDb,
    fadeInFrames: it.fadeIn, fadeOutFrames: it.fadeOut, endMode: it.endMode, alignDownbeatAt: it.alignDownbeatAt, mood: it.mood, energy: it.energy, bpm: it.track.bpm,
  }));
}
