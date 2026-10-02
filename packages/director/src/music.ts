// Step 1 — MUSIC PLAN (§9.3, §9.6): sections, chapter-boundary recipes (silence-hit / jcut), reveal restarts, beat grid.
import { ids, lerp, msToFrame, type MusicMood, type MusicTrack } from "@docmaker/core";
import type { Ctx } from "./ctx";
import type { RevealInfo } from "./reveal";

export interface MusicItem {
  id: string; chapterId: string; from: number; end: number; track: MusicTrack; sourceIn: number; loop: boolean;
  fadeIn: number; fadeOut: number; endMode: "fade" | "hardStop" | "crossfade"; alignDownbeatAt: number | null;
  mood: MusicMood; energy: "low" | "mid" | "high"; recipe: "start" | "silence-hit" | "jcut" | "reveal";
}
export interface PlannedSilence {
  id: string; reason: "reveal" | "chapter" | "drop_out" | "irony" | "bleep" | "user"; ref: string; from: number; end: number;
  affects: ("music" | "sfx" | "clip" | "vo")[]; anchorWord: string | null;
}
export interface Section { chapters: number[]; from: number; end: number; mood: MusicMood; energy: "low" | "mid" | "high"; track: MusicTrack | null }
export interface MusicPlan {
  items: MusicItem[]; sections: Section[]; beats: number[]; downbeats: number[];
  silenceHits: Map<string, number>; // chapterId → silence length (frames)
  silences: PlannedSilence[]; // reveal + chapter silences (drop_out / irony / bleep are added by later passes)
}

const sortTracks = (ts: readonly MusicTrack[]) => [...ts].sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0));

/** Acts (maximal runs of chapters with the same act) at least `minSec` long: their total duration in seconds. */
export function eligibleSeconds(ctx: Ctx, minSec: number): number {
  let total = 0;
  let k = 0;
  while (k < ctx.chapters.length) {
    let j = k;
    while (j + 1 < ctx.chapters.length && ctx.chapters[j + 1]!.act === ctx.chapters[k]!.act) j++;
    const dur = (ctx.chapters[j]!.end - ctx.chapters[k]!.from) / ctx.fps;
    if (dur >= minSec) total += dur;
    k = j + 1;
  }
  return total;
}

function buildSections(ctx: Ctx): Section[] {
  const chs = ctx.chapters;
  const starts: number[] = [];
  chs.forEach((c, ci) => {
    const cue = c.beats.some((b) => b.plan.musicCue === "start" || b.plan.musicCue === "change_mood");
    if (ci === 0 || cue || c.act !== chs[ci - 1]!.act) starts.push(ci);
  });
  let groups: number[][] = starts.map((s, k) => {
    const e = k + 1 < starts.length ? starts[k + 1]! : chs.length;
    return Array.from({ length: e - s }, (_, i) => s + i);
  });
  const durOf = (g: number[]) => chs[g[g.length - 1]!]!.end - chs[g[0]!]!.from;
  const minF = ctx.M.sectionSec[0] * ctx.fps;
  const maxF = ctx.M.sectionSec[1] * ctx.fps;
  // merge short sections into a neighbour
  for (let guard = 0; guard < 1000 && groups.length > 1; guard++) {
    let k = -1;
    for (let i = 0; i < groups.length; i++) if (durOf(groups[i]!) < minF && (k < 0 || durOf(groups[i]!) < durOf(groups[k]!))) k = i;
    if (k < 0) break;
    const into = k === 0 ? 1 : k === groups.length - 1 ? k - 1 : durOf(groups[k - 1]!) <= durOf(groups[k + 1]!) ? k - 1 : k + 1;
    const merged = into < k ? [...groups[into]!, ...groups[k]!] : [...groups[k]!, ...groups[into]!];
    groups = groups.filter((_, i) => i !== k && i !== into);
    groups.splice(Math.min(k, into), 0, merged);
  }
  // split long sections at the chapter boundary nearest the middle
  for (let guard = 0; guard < 1000; guard++) {
    const k = groups.findIndex((g) => g.length > 1 && durOf(g) > maxF);
    if (k < 0) break;
    const g = groups[k]!;
    const mid = (chs[g[0]!]!.from + chs[g[g.length - 1]!]!.end) / 2;
    let best = 1;
    for (let i = 1; i < g.length; i++) if (Math.abs(chs[g[i]!]!.from - mid) < Math.abs(chs[g[best]!]!.from - mid)) best = i;
    groups.splice(k, 1, g.slice(0, best), g.slice(best));
  }
  return groups.map((g) => ({ chapters: g, from: chs[g[0]!]!.from, end: chs[g[g.length - 1]!]!.end, mood: "none" as MusicMood, energy: "mid" as const, track: null }));
}

function moodRanking(ctx: Ctx, s: Section): MusicMood[] {
  const count = new Map<MusicMood, number>();
  for (const ci of s.chapters) for (const b of ctx.chapters[ci]!.beats) {
    if (b.plan.musicMood !== "none") count.set(b.plan.musicMood, (count.get(b.plan.musicMood) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map((e) => e[0]);
}

function chooseTracks(ctx: Ctx, sections: Section[]): void {
  const tracks = sortTracks(ctx.I.music);
  let prev: Section | null = null;
  for (const s of sections) {
    const ranking = moodRanking(ctx, s);
    let mood: MusicMood = ranking[0] ?? (prev?.mood ?? "none");
    let avoidTrack: MusicTrack | null = null;
    if (prev && mood === prev.mood) {
      if (ranking[1]) mood = ranking[1];
      else avoidTrack = prev.track;
    }
    const prevBuild = prev ? prev.chapters.some((ci) => ctx.chapters[ci]!.beats.some((b) => b.plan.musicCue === "build")) : false;
    const beats = s.chapters.flatMap((ci) => ctx.chapters[ci]!.beats);
    const mean = beats.length ? Math.round(beats.reduce((a, b) => a + b.energy, 0) / beats.length) : 3;
    const energy = prevBuild ? "high" : mean <= 2 ? "low" : mean >= 4 ? "high" : "mid";
    let cands = tracks.filter((t) => t.moods.includes(mood) && t.energy === energy);
    if (cands.length === 0) cands = tracks.filter((t) => t.moods.includes(mood));
    if (cands.length === 0) cands = tracks;
    if (avoidTrack && cands.length > 1) cands = cands.filter((t) => t.assetId !== avoidTrack!.assetId);
    const firstCh = ctx.chapters[s.chapters[0]!]!.id;
    const track = cands.length ? cands[Math.floor(ctx.R(`mus:${firstCh}`)() * cands.length)]! : null;
    s.mood = mood === "none" ? (track?.moods.find((m) => m !== "none") ?? "none") : mood;
    s.energy = energy;
    s.track = track;
    prev = s;
  }
}

/** sourceIn (track frames) such that downbeat j lands on `alignAt` for an item starting at `itemFrom`. */
function alignedSourceIn(ctx: Ctx, track: MusicTrack, itemFrom: number, alignAt: number, barsIn: number): { sourceIn: number; align: number | null } {
  const dbs = track.downbeatsMs.map((ms) => msToFrame(ms, ctx.fps));
  if (dbs.length === 0) return { sourceIn: 0, align: null };
  const barF = dbs.length >= 2 ? dbs[1]! - dbs[0]! : msToFrame((4 * 60000) / (track.bpm ?? 100), ctx.fps);
  const lead = alignAt - itemFrom;
  let j = dbs.findIndex((d) => d >= barsIn * barF - 1 && d - lead >= 0);
  if (j < 0) j = dbs.findIndex((d) => d - lead >= 0);
  if (j < 0) return { sourceIn: 0, align: null };
  return { sourceIn: dbs[j]! - lead, align: alignAt };
}

export function planMusic(ctx: Ctx, reveals: readonly RevealInfo[]): MusicPlan {
  const silences: PlannedSilence[] = [];
  const silenceHits = new Map<string, number>();
  // reveal silences (always first in the budget)
  for (const r of reveals) {
    if (!r.hasSilence) continue;
    silences.push({ id: ids.silence("reveal", r.beat.id), reason: "reveal", ref: r.beat.id, from: r.S0, end: r.a, affects: ["music", "sfx"], anchorWord: r.wordId });
  }
  const sections = ctx.I.music.length > 0 ? buildSections(ctx) : [];
  chooseTracks(ctx, sections);
  const hasMusic = sections.some((s) => s.track !== null);

  // chapter-boundary silence-hits: the title-sting boundary always, then the largest act/macro changes until the budget is met
  if (hasMusic) {
    const target = Math.round((ctx.X.silencesPerFiveMin * eligibleSeconds(ctx, ctx.style.techniqueFloor.exemptActsShorterThanSec)) / 300);
    let count = silences.length;
    const pick = (ci: number) => {
      const c = ctx.chapters[ci]!;
      const len = Math.max(1, ctx.F30(Math.round(lerp(ctx.X.silenceFrames, ctx.R(`silc:${c.id}`)()))));
      if (c.from - len <= ctx.chapters[ci - 1]!.from) return;
      silenceHits.set(c.id, len);
      silences.push({ id: ids.silence("chapter", c.id), reason: "chapter", ref: c.id, from: c.from - len, end: c.from, affects: ["music", "sfx"], anchorWord: null });
      count++;
    };
    const ts = ctx.chapters.findIndex((c) => c.titleSting);
    if (ts > 0) pick(ts);
    const cands = ctx.chapters
      .filter((c) => c.idx > 0 && !silenceHits.has(c.id))
      .map((c) => {
        const p = ctx.chapters[c.idx - 1]!;
        return { ci: c.idx, score: (c.macro !== p.macro ? 2 : 0) + (c.act !== p.act ? 1 : 0) };
      })
      .sort((a, b) => b.score - a.score || a.ci - b.ci);
    for (const c of cands) {
      if (count >= target) break;
      pick(c.ci);
    }
  }

  // items
  const items: MusicItem[] = [];
  if (hasMusic) {
    const secOf = (ci: number) => sections.find((s) => s.chapters.includes(ci))!;
    const mk = (id: string, chapterId: string, from: number, s: Section, recipe: MusicItem["recipe"], alignAt: number | null, fadeIn: number): MusicItem => {
      const track = s.track!;
      const al = alignAt === null ? { sourceIn: 0, align: null } : alignedSourceIn(ctx, track, from, alignAt, recipe === "jcut" ? 1 : 2);
      return {
        id, chapterId, from, end: ctx.N, track, sourceIn: al.sourceIn, loop: false, fadeIn, fadeOut: 0, endMode: "fade",
        alignDownbeatAt: al.align, mood: s.mood, energy: s.energy, recipe,
      };
    };
    const revealsBy = new Map(reveals.filter((r) => r.hasSilence).map((r) => [r.chapterId, r]));
    let cur: MusicItem | null = null;
    ctx.chapters.forEach((c, ci) => {
      const s = secOf(ci);
      if (!s.track) return;
      const sectionStart = s.chapters[0] === ci;
      if (ci === 0 || !cur) {
        cur = mk(ids.music(c.id), c.id, ci === 0 ? 0 : c.from, s, "start", null, ctx.M.fadeInFrames);
        items.push(cur);
      } else if (silenceHits.has(c.id)) {
        cur.end = c.from - silenceHits.get(c.id)!;
        cur.endMode = "hardStop";
        cur = mk(ids.music(c.id), c.id, c.from, s, "silence-hit", c.from, 0);
        items.push(cur);
      } else if (sectionStart) {
        const start = Math.max(cur.from + 1, c.from - ctx.M.jCutFrames);
        cur.end = Math.min(ctx.N, start + ctx.M.crossfadeFrames);
        cur.endMode = "crossfade";
        cur.fadeOut = cur.end - start;
        cur = mk(ids.music(c.id), c.id, start, s, "jcut", c.from, ctx.M.crossfadeFrames);
        items.push(cur);
      }
      const r = revealsBy.get(c.id);
      if (r && cur && r.S0 - cur.from >= ctx.F30(6)) {
        cur.end = r.S0;
        cur.endMode = "hardStop";
        cur.fadeOut = 0;
        cur = mk(ids.music(c.id, 1), c.id, r.a, s, "reveal", r.a, 0);
        items.push(cur);
      }
    });
    const last = items[items.length - 1];
    if (last) {
      last.end = ctx.N;
      last.endMode = "fade";
      last.fadeOut = Math.min(ctx.M.fadeOutFrames, ctx.N - last.from);
    }
    for (const it of items) {
      const L = msToFrame(it.track.durationMs, ctx.fps);
      if (it.sourceIn + (it.end - it.from) > L) {
        if (it.track.loopable) it.loop = true;
        else {
          it.end = Math.max(it.from + 1, it.from + L - it.sourceIn);
          it.endMode = "fade";
          it.fadeOut = Math.min(ctx.M.fadeOutFrames, it.end - it.from);
        }
      }
      it.fadeIn = Math.min(it.fadeIn, it.end - it.from);
      it.fadeOut = Math.min(it.fadeOut, it.end - it.from);
    }
  }

  // beat grid (program frames)
  const beats = new Set<number>();
  const downbeats = new Set<number>();
  for (const it of items) {
    const L = msToFrame(it.track.durationMs, ctx.fps);
    const put = (ms: number, set: Set<number>) => {
      const bf = msToFrame(ms, ctx.fps);
      for (let k = 0; k < 10_000; k++) {
        const f = it.from + (bf - it.sourceIn) + k * L;
        if (f >= it.end) break;
        if (f >= it.from) set.add(f);
        if (!it.loop || L <= 0) break;
      }
    };
    for (const ms of it.track.beatsMs) put(ms, beats);
    for (const ms of it.track.downbeatsMs) put(ms, downbeats);
  }
  return {
    items: items.filter((it) => it.end - it.from >= 1), sections, beats: [...beats].sort((a, b) => a - b), downbeats: [...downbeats].sort((a, b) => a - b),
    silenceHits, silences,
  };
}

/** Nearest grid frame to f within ±maxDist (null if none). */
export function nearestIn(grid: readonly number[], f: number, maxDist: number): number | null {
  let lo = 0, hi = grid.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (grid[mid]! < f) lo = mid + 1; else hi = mid;
  }
  let best: number | null = null;
  for (const k of [lo - 1, lo, lo + 1]) {
    const g = grid[k];
    if (g === undefined) continue;
    if (Math.abs(g - f) <= maxDist && (best === null || Math.abs(g - f) < Math.abs(best - f) || (Math.abs(g - f) === Math.abs(best - f) && g < best))) best = g;
  }
  return best;
}
