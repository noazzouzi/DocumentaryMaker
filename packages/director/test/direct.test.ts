import { describe, expect, it } from "vitest";
import { Timeline, canonicalJson, stableStringify, type AssetPick, type Timeline as TL } from "@docmaker/core";
import { makeFrozen } from "@docmaker/core/testing";
import { direct } from "../src/index";
import { errorsOf, runs } from "./helpers";
import { policyScenario } from "./scenario";
import { tulipInputs } from "./tulip";

const items = (t: TL) => {
  const a = t.audio;
  return new Map<string, unknown>([...t.video, ...t.overlays, ...t.captions, ...t.fx, ...a.vo, ...a.music, ...a.sfx, ...a.clip, ...a.silences, ...t.markers].map((x) => [x.id, x]));
};

describe("direct — determinism", () => {
  it("is byte-identical across runs and never mutates its input", () => {
    const sc = policyScenario();
    const before = canonicalJson({ ...sc.input, validateAsset: null });
    const a = direct(sc.input);
    const b = direct(sc.input);
    const c = direct(policyScenario().input);
    expect(canonicalJson({ ...sc.input, validateAsset: null })).toBe(before);
    const ser = (o: typeof a) => stableStringify({ timeline: o.timeline, lint: o.lint, stats: o.stats, usage: o.usage, rejected: o.rejectedOverrides }, 0);
    expect(ser(b)).toBe(ser(a));
    expect(ser(c)).toBe(ser(a));
  });

  it("changing one beat's pick only changes items of that beat (plus SFX/music overlapping it)", () => {
    const sc = policyScenario();
    const base = direct(sc.input);
    // a mid-film beat with a single still pick and no overlay
    const t = base.timeline;
    const beat = t.video.find((c, i) => i > 30 && c.source.kind === "image" && c.layout === "cover" && t.video.filter((x) => x.beatId === c.beatId).length === 1
      && !t.overlays.some((o) => o.beatId === c.beatId) && c.beatId && /-B\d{3}$/.test(c.beatId))!.beatId!;
    const fresh = Object.values(makeFrozen({ images: 1, videos: 0 }))[0]!;
    const fresh2 = { ...fresh, id: "f".repeat(64), projectRel: `media/${"f".repeat(64)}.jpg` };
    const input = { ...sc.input, frozen: { ...sc.input.frozen, [fresh2.id]: fresh2 } };
    const picks: AssetPick[] = sc.input.picks.picks.map((p) => (p.beatId === beat && p.slot === 0 ? { ...p, assetId: fresh2.id } : p));
    const changed = direct({ ...input, picks: { ...sc.input.picks, picks } });
    const A = items(base.timeline), B = items(changed.timeline);
    const bWin = base.timeline.video.filter((c) => c.beatId === beat);
    const w0 = bWin[0]!.from, w1 = bWin[bWin.length - 1]!.from + bWin[bWin.length - 1]!.dur;
    const overlapsBeat = (x: unknown) => {
      const it = x as { from: number; dur: number };
      return it.from < w1 && w0 < it.from + it.dur;
    };
    const ids = new Set([...A.keys(), ...B.keys()]);
    const offenders: string[] = [];
    for (const id of ids) {
      const a = A.get(id), b = B.get(id);
      if (a !== undefined && b !== undefined && canonicalJson(a) === canonicalJson(b)) continue;
      if (id.includes(beat)) continue;
      if ((id.startsWith("sfx:") || id.startsWith("mus:")) && (overlapsBeat(a ?? b) || overlapsBeat(b ?? a))) continue;
      offenders.push(id);
    }
    expect(offenders).toEqual([]);
    expect(changed.timeline.video.find((c) => c.beatId === beat)!.source).toMatchObject({ assetId: fresh2.id });
  });
});

describe("direct — validity", () => {
  it("produces schema-valid timelines without lint errors (rich, policy and tulip-mania scenarios)", () => {
    for (const [name, out] of Object.entries(runs())) {
      expect(() => Timeline.parse(out.timeline), name).not.toThrow();
      expect(errorsOf(out), name).toEqual([]);
      expect(out.rejectedOverrides).toEqual([]);
    }
  });

  it("the tulip-mania fixture produces no lint error and the full M1 vocabulary", () => {
    const out = direct(tulipInputs().input);
    expect(errorsOf(out)).toEqual([]);
    const comps = new Set(out.timeline.overlays.map((o) => o.component));
    for (const c of ["TitleSting", "ChapterCard", "LowerThird", "NumberCounter", "MapPin", "DocumentCard", "SourceLabel"]) expect(comps, c).toContain(c);
    expect(out.timeline.audio.silences.some((s) => s.reason === "reveal")).toBe(true);
    expect(out.timeline.audio.music.length).toBeGreaterThan(0);
  });

  it("writes the usage table and every referenced asset", () => {
    const out = runs().policy;
    const used = new Set(out.usage.map((u) => u.assetId));
    for (const c of out.timeline.video) if (c.source.kind === "image" || c.source.kind === "video") expect(used.has(c.source.assetId)).toBe(true);
    for (const u of out.usage) expect(out.timeline.assets[u.assetId], u.assetId).toBeDefined();
    expect(out.usage.find((u) => u.assetId === out.timeline.audio.voProgram.assetId)?.itemIds).toContain("vo_program");
  });

  it("directs at 24 and 25 fps", () => {
    for (const fps of [24, 25] as const) {
      const out = direct(policyScenario({ fps, seconds: 240, chapters: 3 }).input);
      expect(out.timeline.fps).toBe(fps);
      expect(() => Timeline.parse(out.timeline)).not.toThrow();
      expect(errorsOf(out)).toEqual([]);
    }
  });

  it("fills every DirectorStats field", () => {
    const s = runs().policy.stats;
    expect(s.shots).toBeGreaterThan(100);
    expect(s.durationSec).toBeGreaterThan(500);
    for (const v of Object.values(s)) if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
    expect(s.keywordCaptions).toBeGreaterThan(0);
    expect(s.cleanStretches).toBeGreaterThan(0);
  });
});
