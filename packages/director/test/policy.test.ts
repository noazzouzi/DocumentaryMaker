import { describe, expect, it } from "vitest";
import { type Timeline } from "@docmaker/core";
import { TEST_STYLE } from "@docmaker/core/testing";
import { cutsWithSfx, isImpact, maxGapFrames, punchEvents, sfxEvents } from "../src/stats";
import { keyOf } from "../src/transitions";
import { eligibleActs, runs } from "./helpers";

const S = TEST_STYLE;
interface Acc { f: number; w: number; structural: boolean }

/** Accents read back from a timeline (same weights as the director's salience arbitration). */
function accents(t: Timeline): Acc[] {
  const W = S.budgets.salience.weights;
  const chapterStarts = new Set(t.chapters.map((c) => c.from));
  const reveal = new Set(t.audio.silences.filter((s) => s.reason === "reveal").map((s) => s.from + s.dur));
  const nearReveal = (f: number) => [...reveal].some((a) => f >= a && f - a <= 6);
  const out: Acc[] = [];
  t.video.forEach((c, i) => {
    if (i === 0) return;
    const k = keyOf(c.transitionIn);
    if (k === "cut") return;
    if (k === S.transitionPolicy.montage.primary && t.video[i - 1]!.beatId === c.beatId) return; // montage rhythm (exempt)
    out.push({ f: c.from, w: k === "flash" ? W.flash : W.transitionNonCut, structural: chapterStarts.has(c.from) || nearReveal(c.from) });
  });
  for (const f of t.fx) {
    if (f.fx === "zoom" && f.shape === "span" && f.amt >= 0.08) out.push({ f: f.from, w: W.punch, structural: false });
    if (f.fx === "punch") out.push({ f: f.from, w: W.punch, structural: true });
    if (f.fx === "flash") out.push({ f: f.from, w: W.flash, structural: true });
  }
  for (const o of t.overlays) {
    if (o.band === "hud") continue;
    const slam = o.component === "KeywordSlam" || o.component === "Stamp" || o.component === "FreezeLabel";
    out.push({ f: o.from, w: slam ? W.slam : W.overlayEntry, structural: o.component === "ChapterCard" || o.component === "TitleSting" || nearReveal(o.from) || o.component === "KineticText" && o.from + o.dur === t.durationInFrames });
  }
  for (const s of t.audio.sfx) {
    if (!isImpact(s.category)) continue;
    out.push({ f: s.eventFrame, w: W.impactSfx, structural: chapterStarts.has(s.eventFrame) || s.combo === "reveal" || s.reason === "SHOCK plate" || s.priority >= 5 });
  }
  return out.sort((a, b) => a.f - b.f);
}

describe("policies over a synthetic 10-minute programme with every cue type", () => {
  const out = runs().policy;
  const t = out.timeline;
  const T = S.transitionPolicy;
  const nonCut = t.video.slice(1).map((c) => keyOf(c.transitionIn)).filter((k) => k !== "cut");

  it("no 3 identical non-cut transitions in a row; ≤ maxKindsPerFilm kinds; ≤ 3 dips to black", () => {
    for (let i = 2; i < nonCut.length; i++) expect(nonCut[i] === nonCut[i - 1] && nonCut[i] === nonCut[i - 2], `#${i} ${nonCut[i]}`).toBe(false);
    expect(new Set(nonCut).size).toBeLessThanOrEqual(T.maxKindsPerFilm);
    expect(nonCut.filter((k) => k === "dipToBlack").length).toBeLessThanOrEqual(3);
    expect(nonCut.filter((k) => k === "dipToBlack").length).toBeGreaterThanOrEqual(1);
  });

  it("non-cut share within 1 − cutShare ± tolerance and primary share inside primaryShare", () => {
    const share = nonCut.length / (t.video.length - 1);
    expect(share).toBeGreaterThanOrEqual(1 - T.cutShare - T.quota.tolerance - 1e-9);
    expect(share).toBeLessThanOrEqual(1 - T.cutShare + T.quota.tolerance + 1e-9);
    expect(out.stats.primaryShare).toBeGreaterThanOrEqual(T.primaryShare[0]);
    expect(out.stats.primaryShare).toBeLessThanOrEqual(T.primaryShare[1]);
  });

  it("punches, SFX and impacts per minute stay within [floor, cap] in acts ≥ 90 s", () => {
    const acts = eligibleActs(t, S.techniqueFloor.exemptActsShorterThanSec);
    expect(acts.length).toBeGreaterThan(1);
    const punches = punchEvents(t, S), sfx = sfxEvents(t), impacts = sfxEvents(t, isImpact);
    for (const a of acts) {
      const I = S.budgets.actIntensity[a.act] ?? 1;
      const min = (a.end - a.from) / t.fps / 60;
      const rate = (xs: number[]) => xs.filter((f) => f >= a.from && f < a.end).length / min;
      expect(rate(punches), `punches in ${a.act}`).toBeGreaterThanOrEqual(S.cameraPolicy.punch.perMin[0] * I - 0.5);
      expect(rate(punches), `punches in ${a.act}`).toBeLessThanOrEqual(S.cameraPolicy.punch.perMin[1] * I + 1e-9);
      expect(rate(sfx), `SFX in ${a.act}`).toBeGreaterThanOrEqual(S.sfxPolicy.perMin[0] * I - 1e-9);
      expect(rate(sfx), `SFX in ${a.act}`).toBeLessThanOrEqual(S.sfxPolicy.perMin[1] * I + 1e-9);
      expect(rate(impacts), `impacts in ${a.act}`).toBeLessThanOrEqual(S.sfxPolicy.impactsPerMin[1] * I + 1e-9);
    }
    const all = impacts.length / (t.durationInFrames / t.fps / 60);
    expect(all).toBeGreaterThanOrEqual(S.sfxPolicy.impactsPerMin[0] * 0.75);
    expect(out.lint.filter((i) => i.rule === "DENSITY_MAX")).toEqual([]);
  });

  it("about half of the cuts are silent (± 10 %)", () => {
    const silent = 1 - cutsWithSfx(t) / (t.video.length - 1);
    expect(silent).toBeGreaterThanOrEqual(S.sfxPolicy.silentCutShare - 0.1);
    expect(silent).toBeLessThanOrEqual(S.sfxPolicy.silentCutShare + 0.1);
  });

  it("routine flash peaks ≤ cap; explicit ones ≤ explicitMax and ≤ explicitPerMin", () => {
    const peaks: { f: number; p: number }[] = [];
    for (const c of t.video) {
      const tr = c.transitionIn;
      if (tr.kind === "cover" && tr.presentation === "flash") peaks.push({ f: c.from, p: tr.peak });
      if (tr.kind === "cut" && tr.accent.type === "velocity") expect(tr.accent.flash).toBeLessThanOrEqual(0.5);
    }
    for (const f of t.fx) if (f.fx === "flash") peaks.push({ f: f.from, p: f.amt });
    const explicit = peaks.filter((x) => x.p > T.flash.cap);
    for (const x of peaks) expect(x.p).toBeLessThanOrEqual(T.flash.explicitMax);
    for (const x of explicit) expect(explicit.filter((y) => y.f >= x.f && y.f < x.f + 60 * t.fps).length).toBeLessThanOrEqual(T.flash.explicitPerMin);
    expect(peaks.filter((x) => x.p <= T.flash.cap).every((x) => x.p <= 0.45 + 1e-9)).toBe(true);
  });

  it("never more than 6 s without a visual change", () => {
    expect(maxGapFrames(t) / t.fps).toBeLessThanOrEqual(6);
    expect(out.stats.maxNoChangeSec).toBeLessThanOrEqual(6);
  });

  it("one clean stretch (≥ 6 s without accents) per minute", () => {
    const acc = accents(t);
    const need = S.budgets.cleanStretch.minSec * t.fps;
    for (let b0 = 0; b0 + 60 * t.fps <= t.durationInFrames; b0 += 60 * t.fps) {
      const b1 = b0 + 60 * t.fps;
      const pts = [b0, ...acc.filter((a) => a.f >= b0 && a.f < b1).map((a) => a.f), b1];
      let best = 0;
      for (let k = 1; k < pts.length; k++) best = Math.max(best, pts[k]! - pts[k - 1]!);
      expect(best, `minute ${b0 / t.fps / 60}`).toBeGreaterThanOrEqual(need);
    }
  });

  it("respects the salience window (structural windows excepted)", () => {
    const acc = accents(t);
    const W = S.budgets.salience.windowSec * t.fps;
    for (const a of acc) {
      const win = acc.filter((x) => x.f >= a.f && x.f < a.f + W);
      if (win.some((x) => x.structural)) continue;
      const ch = t.chapters.filter((c) => c.from <= a.f).at(-1)!;
      const cap = S.budgets.salience.maxAccents * (S.budgets.actIntensity[ch.act] ?? 1);
      expect(win.reduce((s, x) => s + x.w, 0), `window at ${(a.f / t.fps).toFixed(1)} s`).toBeLessThanOrEqual(cap + 1e-9);
    }
  });
});
