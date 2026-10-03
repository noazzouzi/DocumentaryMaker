import { describe, expect, it } from "vitest";
import { sfxDensityEvents, type SfxCue, type Timeline } from "@docmaker/core";
import { makeTimeline } from "@docmaker/core/testing";
import { densityReport } from "../src/index";

describe("densityReport", () => {
  it("counts SFX and impacts per minute, the silent-cut share and a nominal chapter RMS", () => {
    const t = makeTimeline({ seconds: 150, fps: 30 });
    const r = densityReport(t);
    expect(r.sfxPerMin.length).toBe(3);
    const ev = sfxDensityEvents(t);
    const total = ev.length;
    // full minutes are counts, the last 30 s is scaled ×2
    const counts = [0, 0, 0];
    for (const f of ev) counts[Math.min(2, Math.floor(f / 1800))]!++;
    expect(r.sfxPerMin).toEqual([counts[0], counts[1], counts[2]! * 2]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
    expect(r.impactsPerMin.every((v, i) => v <= r.sfxPerMin[i]!)).toBe(true);
    expect(r.silentCutShare).toBeGreaterThanOrEqual(0);
    expect(r.silentCutShare).toBeLessThanOrEqual(1);
    expect(Object.keys(r.chapterRmsDb).sort()).toEqual(t.chapters.map((c) => c.id).sort());
    for (const v of Object.values(r.chapterRmsDb)) { expect(v).toBeGreaterThan(-40); expect(v).toBeLessThan(-10); }
  });

  it("reads a quieter chapter as lower and a cut with an SFX as non-silent", () => {
    const t = makeTimeline({ seconds: 120, fps: 30 });
    const quiet: Timeline = structuredClone(t);
    const ch0 = quiet.chapters[0]!;
    quiet.audio.music = quiet.audio.music.map((m) => (m.from === ch0.from ? { ...m, gainDb: -10 } : m));
    quiet.audio.sfx = quiet.audio.sfx.filter((c) => c.from >= ch0.from + ch0.dur);
    const a = densityReport(t).chapterRmsDb[ch0.id]!;
    const b = densityReport(quiet).chapterRmsDb[ch0.id]!;
    expect(b).toBeLessThan(a);
    // every cut gets an SFX exactly on it → share 0; none → 1
    const all: Timeline = structuredClone(t);
    const proto = t.audio.sfx[0]!;
    all.audio.sfx = all.video.slice(1).map((v, i) => ({ ...proto, id: `sfx:cut${i}:whoosh.light`, eventFrame: v.from, category: "whoosh.light" as const }));
    expect(densityReport(all).silentCutShare).toBe(0);
    const none: Timeline = structuredClone(t);
    none.audio.sfx = [];
    expect(densityReport(none).silentCutShare).toBe(1);
    expect(densityReport(none).sfxPerMin).toEqual([0, 0]);
  });

  // regression: a 29-s chapter render (22 cues, 7 of them NumberCounter tick roll members) was reported as
  // "45.36 SFX per minute" — extrapolated from a partial minute and counted with a different rule from the director
  it("counts with the director's rule and does not extrapolate a partial minute shorter than 30 s", () => {
    const base = makeTimeline({ seconds: 120, fps: 30 });
    const t: Timeline = structuredClone(base);
    t.durationInFrames = 873; // 29.1 s
    const proto = base.audio.sfx[0]!;
    const cue = (id: string, f: number, category: SfxCue["category"], sourceItemId: string): SfxCue =>
      ({ ...proto, id, from: f, dur: 10, eventFrame: f, peakOffsetFrames: 0, category, sourceItemId, priority: 2 });
    const sfx: SfxCue[] = [];
    // a counter: 8 ticks 3 frames apart → 1 head + 7 roll members
    for (let k = 0; k < 8; k++) sfx.push(cue(`sfx:ov:counter:tick:${k}`, 300 + 3 * k, "tick", "ov:counter"));
    // 13 other accents, one of them a priority-5 impact (it counts: the caps hold for priority 5 too)
    for (let k = 0; k < 13; k++) sfx.push(cue(`sfx:x${k}:whoosh.light`, 20 + 60 * k, "whoosh.light", `x${k}`));
    sfx.push({ ...cue("sfx:plate:impact", 850, "impact", "plate"), priority: 5 });
    t.audio.sfx = sfx;
    expect(sfx.length).toBe(22);
    expect(sfxDensityEvents(t).length).toBe(15);
    const r = densityReport(t);
    expect(r.sfxPerMin).toEqual([15]); // raw count, not 15 × 60 / 29.1
    expect(r.impactsPerMin).toEqual([1]);
    // a partial minute of ≥ 30 s is still scaled to a rate
    const t45: Timeline = { ...t, durationInFrames: 1350 };
    expect(densityReport(t45).sfxPerMin).toEqual([20]);
    // a roll of one item more than 1 s apart is two events; two items' ticks at once are two events
    t.audio.sfx = [cue("a", 100, "tick", "ov:a"), cue("b", 131, "tick", "ov:a"), cue("c", 131, "tick", "ov:b"), cue("d", 133, "pop", "ov:b")];
    expect(sfxDensityEvents(t)).toEqual([100, 131, 131, 133]);
    t.audio.sfx = [cue("a", 100, "tick", "ov:a"), cue("b", 130, "tick", "ov:a"), cue("c", 160, "tick", "ov:a")];
    expect(sfxDensityEvents(t)).toEqual([100]);
  });
});
