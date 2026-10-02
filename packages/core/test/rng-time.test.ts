import { describe, expect, it } from "vitest";
import { fnv1a32, framesAt, frameToMs, frameToSample48k, lerp, msToFrame, mulberry32, rngFor, secToFrames, srtTime, timecode, weightedPick } from "../src/index";

describe("rng", () => {
  it("fnv1a32 vectors", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });
  it("mulberry32 is deterministic, in [0,1) and matches the reference sequence", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const xs = Array.from({ length: 1000 }, () => a());
    expect(xs).toEqual(Array.from({ length: 1000 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    // reference: $SP/mgtest/motion.ts rng(1) first values
    const r = mulberry32(1);
    expect(r()).toBeCloseTo(0.6270739405881613, 15);
    expect(r()).toBeCloseTo(0.002735721180215478, 15);
  });
  it("rngFor keys streams", () => {
    expect(rngFor(1, "x")()).toBe(mulberry32(fnv1a32("1|x"))());
    expect(rngFor(1, "x")()).not.toBe(rngFor(1, "y")());
  });
  it("lerp and weightedPick", () => {
    expect(lerp([2, 4], 0.25)).toBe(2.5);
    expect(weightedPick({}, () => 0.5)).toBeNull();
    expect(weightedPick({ a: 0, b: 0 }, () => 0.5)).toBeNull();
    expect(weightedPick({ b: 1, a: 1 }, () => 0.1)).toBe("a"); // keys sorted
    expect(weightedPick({ b: 1, a: 1 }, () => 0.9)).toBe("b");
    expect(weightedPick({ a: 1, b: 0, c: 3 }, () => 0.3)).toBe("c");
  });
});

describe("time", () => {
  it("frame conversions", () => {
    expect(msToFrame(1000, 30)).toBe(30);
    expect(frameToMs(45, 30)).toBe(1500);
    expect(secToFrames(2.5, 24)).toBe(60);
    expect(framesAt(25, 30)).toBe(25);
    for (const fps of [24, 25, 30]) for (let f = 0; f < 200; f++) expect(Number.isInteger(frameToSample48k(f, fps))).toBe(true);
  });
  it("timecode and srtTime", () => {
    expect(timecode(0, 30)).toBe("00:00:00:00");
    expect(timecode(30 * 3661 + 7, 30)).toBe("01:01:01:07");
    expect(srtTime(45, 30)).toBe("00:00:01,500");
    expect(srtTime(30 * 3600 + 1, 30)).toBe("01:00:00,033");
  });
});
