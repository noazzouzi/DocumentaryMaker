import { describe, expect, it } from "vitest";
import type { Timeline } from "@docmaker/core";
import { makeTimeline } from "@docmaker/core/testing";
import { densityReport } from "../src/index";

describe("densityReport", () => {
  it("counts SFX and impacts per minute, the silent-cut share and a nominal chapter RMS", () => {
    const t = makeTimeline({ seconds: 150, fps: 30 });
    const r = densityReport(t);
    expect(r.sfxPerMin.length).toBe(3);
    const total = t.audio.sfx.length;
    // full minutes are counts, the last 30 s is scaled ×2
    const counts = [0, 0, 0];
    for (const c of t.audio.sfx) counts[Math.min(2, Math.floor(c.eventFrame / 1800))]!++;
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
});
