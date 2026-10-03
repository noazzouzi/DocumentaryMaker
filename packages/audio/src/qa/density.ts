// densityReport (qa stage): SFX / impact density per minute, the silent-cut share and a nominal per-chapter RMS.
// Pure (no audio decoding): levels are the nominal ones of §11.1 (VO −16 LUFS, music and clip audio −18 LUFS before
// their gains, SFX files ≈ −20 LUFS before theirs) weighted by the same gain tables as the mix, so a calm chapter shows up
// lower than a dense one. The real loudness of the mix is in the LoudnessDoc ("the mix was checked by meters only").
import { computeGainTables } from "@docmaker/core";
import type { SfxCategory, Timeline } from "@docmaker/core";

export const IMPACT_CATEGORIES: ReadonlySet<SfxCategory> = new Set<SfxCategory>(["impact", "impact.soft", "boom.sub", "boom.low", "thud"]);
const VO_DB = -16;
const BED_DB = -18;
const SFX_FILE_DB = -20;

export interface DensityReport { sfxPerMin: number[]; impactsPerMin: number[]; silentCutShare: number; chapterRmsDb: Record<string, number> }

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Shot boundaries with an SFX event within [cut − 2, cut + 3] frames (the director's definition of a non-silent cut). */
export function cutsWithSfx(t: Timeline): number {
  const ev = t.audio.sfx.map((x) => x.eventFrame).sort((a, b) => a - b);
  let n = 0;
  for (const c of t.video.slice(1)) {
    let lo = 0, hi = ev.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (ev[mid]! < c.from - 2) lo = mid + 1; else hi = mid; }
    if (lo < ev.length && ev[lo]! <= c.from + 3) n++;
  }
  return n;
}

export function densityReportImpl(t: Timeline): DensityReport {
  const N = t.durationInFrames;
  const W = 60 * t.fps;
  const windows = Math.max(1, Math.ceil(N / W));
  const sfx = new Array<number>(windows).fill(0);
  const imp = new Array<number>(windows).fill(0);
  for (const c of t.audio.sfx) {
    const w = Math.min(windows - 1, Math.max(0, Math.floor(c.eventFrame / W)));
    sfx[w]!++;
    if (IMPACT_CATEGORIES.has(c.category)) imp[w]!++;
  }
  // per-minute rates: full minutes are counts; a partial last minute is scaled to a rate
  const rate = (arr: number[]) => arr.map((v, w) => r2((v * W) / Math.max(1, Math.min(N, (w + 1) * W) - w * W)));
  const cuts = Math.max(0, t.video.length - 1);
  const silentCutShare = cuts === 0 ? 0 : r2(1 - cutsWithSfx(t) / cuts);

  // nominal power per frame
  const G = computeGainTables(t);
  const p = new Float64Array(N);
  const dbp = (db: number) => Math.pow(10, db / 10);
  const inVo = new Uint8Array(N);
  for (const [a, b] of t.audio.voSpans) for (let k = Math.max(0, a); k < Math.min(N, b); k++) inVo[k] = 1;
  for (let k = 0; k < N; k++) if (inVo[k]) p[k]! += dbp(VO_DB) * G.vo[k]! * G.vo[k]!;
  const env = (dur: number, fi: number, fo: number, local: number) => {
    let e = 1;
    if (fi > 0 && local < fi) e = local / fi;
    if (fo > 0 && local >= dur - fo) e = Math.min(e, (dur - local) / fo);
    return Math.max(0, e);
  };
  for (const m of t.audio.music) {
    for (let k = Math.max(0, m.from); k < Math.min(N, m.from + m.dur); k++) {
      const g = Math.pow(10, m.gainDb / 20) * env(m.dur, m.fadeInFrames, m.fadeOutFrames, k - m.from) * G.music[k]!;
      p[k]! += dbp(BED_DB) * g * g;
    }
  }
  for (const c of t.audio.sfx) {
    for (let k = Math.max(0, c.from); k < Math.min(N, c.from + c.dur); k++) {
      const g = Math.pow(10, c.gainDb / 20) * env(c.dur, c.fadeInFrames, c.fadeOutFrames, k - c.from) * G.sfx[k]!;
      p[k]! += dbp(SFX_FILE_DB) * g * g;
    }
  }
  for (const c of t.audio.clip) {
    for (let k = Math.max(0, c.from); k < Math.min(N, c.from + c.dur); k++) {
      const g = Math.pow(10, c.gainDb / 20) * (c.duckUnderVo ? G.clip[k]! : 1);
      p[k]! += dbp(BED_DB) * g * g;
    }
  }
  const chapterRmsDb: Record<string, number> = {};
  for (const ch of t.chapters) {
    let s = 0, n = 0;
    for (let k = Math.max(0, ch.from); k < Math.min(N, ch.from + ch.dur); k++) { s += p[k]!; n++; }
    chapterRmsDb[ch.id] = n === 0 || s === 0 ? -144 : r2(10 * Math.log10(s / n));
  }
  return { sfxPerMin: rate(sfx), impactsPerMin: rate(imp), silentCutShare, chapterRmsDb };
}
