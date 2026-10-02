import { describe, expect, it } from "vitest";
import { type Timeline, computeGainTables, dbToGain, gainToDb, itemEnvelope } from "../src/index";
import { makeTimeline } from "../src/testing/index";

const base = makeTimeline({ seconds: 10, overlays: false, audio: false });
function withAudio(a: Partial<Timeline["audio"]>): Timeline {
  return {
    ...base,
    audio: {
      ...base.audio, voSpans: [], vo: [], music: [], sfx: [], clip: [], silences: [],
      ducking: { musicDuckDb: -12, sfxDuckDb: -4, clipDuckDb: -10, musicUnderClipDb: -12, attackMs: 100, releaseMs: 400, bridgeMs: 600, padBeforeMs: 100, padAfterMs: 100 },
      ...a,
    },
  };
}
const db = (g: number) => Math.round(gainToDb(g) * 1000) / 1000;
const clipItem = (from: number, dur: number) => ({ id: `ca:CH1-S0${from}`, start: { ref: "program", edge: "start", offset: from }, end: { ref: "program", edge: "start", offset: from + dur }, from, dur, segmentId: "CH1-S01", assetId: "a".repeat(64), sourceInFrames: 0, gainDb: 0, duckUnderVo: true }) as Timeline["audio"]["clip"][number];

describe("computeGainTables (golden, 30 fps)", () => {
  // F(ms) = ms·30/1000 → pad 3 f, attack 3 f, release 12 f
  const t = withAudio({ voSpans: [[60, 90]] });
  const g = computeGainTables(t);
  it("has one value per frame", () => {
    expect(g.length).toBe(300);
    expect(g.fps).toBe(30);
    expect(g.vo.every((x) => x === 1)).toBe(true);
  });
  it("ducks music by musicDuckDb on [a − pad, b + pad) with linear attack/release ramps", () => {
    // s = 57, e = 93, attack window [54, 57), release [93, 105)
    expect(db(g.music[50]!)).toBe(0);
    expect(db(g.music[54]!)).toBe(0); // ramp start (env 0)
    expect(db(g.music[55]!)).toBeCloseTo(-4, 3); // env 1/3
    expect(db(g.music[56]!)).toBeCloseTo(-8, 3);
    expect(db(g.music[57]!)).toBe(-12);
    expect(db(g.music[92]!)).toBe(-12);
    expect(db(g.music[93]!)).toBe(-12); // release starts at env 1
    expect(db(g.music[99]!)).toBeCloseTo(-6, 3); // env 0.5
    expect(db(g.music[105]!)).toBe(0);
    expect(db(g.sfx[70]!)).toBe(-4);
    expect(db(g.clip[70]!)).toBe(-10);
  });
  it("bridges close spans (overlapping ramps keep the music ducked)", () => {
    const b = computeGainTables(withAudio({ voSpans: [[60, 90], [96, 120]] }));
    for (let k = 57; k < 123; k++) expect(db(b.music[k]!)).toBe(-12);
  });
  it("ducks music under clip audio (musicUnderClipDb) without pads", () => {
    const c = computeGainTables(withAudio({ clip: [clipItem(150, 30)] }));
    expect(db(c.music[146]!)).toBe(0);
    expect(db(c.music[150]!)).toBe(-12);
    expect(db(c.music[179]!)).toBe(-12);
    expect(db(c.music[200]!)).toBe(0);
    expect(db(c.clip[160]!)).toBe(0); // clip table only reacts to VO
  });
  it("silences zero the affected tables, including vo for bleeps", () => {
    const sil = (from: number, dur: number, affects: ("music" | "sfx" | "clip" | "vo")[]) => ({ id: `sil:user:${from}`, start: { ref: "program", edge: "start", offset: from }, end: { ref: "program", edge: "start", offset: from + dur }, from, dur, reason: "bleep", affects }) as Timeline["audio"]["silences"][number];
    const s = computeGainTables(withAudio({ voSpans: [[60, 90]], silences: [sil(70, 5, ["vo"]), sil(200, 10, ["music", "sfx"])] }));
    expect(s.vo[69]).toBe(1);
    for (let k = 70; k < 75; k++) expect(s.vo[k]).toBe(0);
    expect(s.vo[75]).toBe(1);
    expect(s.music[71]).toBeGreaterThan(0);
    for (let k = 200; k < 210; k++) expect([s.music[k], s.sfx[k]]).toEqual([0, 0]);
    expect(s.clip[205]).toBe(1);
  });
});

describe("itemEnvelope", () => {
  it("linear fades inside [0, dur)", () => {
    const it0 = { dur: 100, fadeInFrames: 10, fadeOutFrames: 20 };
    expect(itemEnvelope(it0, -1)).toBe(0);
    expect(itemEnvelope(it0, 0)).toBe(0);
    expect(itemEnvelope(it0, 5)).toBe(0.5);
    expect(itemEnvelope(it0, 50)).toBe(1);
    expect(itemEnvelope(it0, 90)).toBe(0.5);
    expect(itemEnvelope(it0, 100)).toBe(0);
    expect(itemEnvelope({ dur: 10 }, 3)).toBe(1);
  });
  it("dB helpers", () => {
    expect(dbToGain(0)).toBe(1);
    expect(dbToGain(-20)).toBeCloseTo(0.1, 12);
    expect(gainToDb(0)).toBe(-180);
  });
});
