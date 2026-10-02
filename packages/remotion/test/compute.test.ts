import { describe, expect, it } from "vitest";
import type { Timeline } from "@docmaker/core";
import { computeTimeline, coverWindow, dipPhases, partIndexAt, pictureParts, planChunks, resolveCover, sliceHash, type ComputedChapter } from "../src/compute";
import { clone, cut, innerClipIndex, lengthenFirstChapter, shiftAll, timeline, withTransition } from "./helpers";

/** Program-relative [start, end) of every series item. */
function layoutSeries(ch: ComputedChapter): { seqs: { id: string; start: number; end: number; head: number; tail: number }[]; trans: { id: string; start: number; d: number }[] } {
  let pos = 0;
  const seqs: { id: string; start: number; end: number; head: number; tail: number }[] = [];
  const trans: { id: string; start: number; d: number }[] = [];
  for (const s of ch.series) {
    if (s.type === "seq") {
      seqs.push({ id: s.clip.id, start: ch.from + pos, end: ch.from + pos + s.durationInFrames, head: s.headHandle, tail: s.tailHandle });
      pos += s.durationInFrames;
    } else {
      pos -= s.durationInFrames;
      trans.push({ id: s.clipId, start: ch.from + pos, d: s.durationInFrames });
    }
  }
  return { seqs, trans };
}

describe("computeTimeline", () => {
  const t = timeline({ seconds: 60 });
  const ct = computeTimeline(t);

  it("mirrors the timeline frame/size and has no warnings for factory input", () => {
    expect(ct.fps).toBe(t.fps);
    expect(ct.durationInFrames).toBe(t.durationInFrames);
    expect([ct.width, ct.height]).toEqual([1920, 1080]);
    expect(ct.warnings).toEqual([]);
  });

  it("series total equals the chapter duration (Σ seq − Σ d = Σ dur) and chapters tile the program", () => {
    let cursor = 0;
    for (const ch of ct.chapters) {
      expect(ch.from).toBe(cursor);
      const seq = ch.series.filter((s) => s.type === "seq").reduce((a, s) => a + s.durationInFrames, 0);
      const trans = ch.series.filter((s) => s.type === "trans").reduce((a, s) => a + s.durationInFrames, 0);
      expect(seq - trans).toBe(ch.dur);
      cursor += ch.dur;
    }
    expect(cursor).toBe(t.durationInFrames);
  });

  it("centres every overlap on its cut with even d and d/2 handles on both sides", () => {
    const factoryOverlaps = t.video.filter((c) => c.transitionIn.kind === "overlap");
    expect(factoryOverlaps.length).toBeGreaterThan(0);
    let checked = 0;
    for (const ch of ct.chapters) {
      const { seqs, trans } = layoutSeries(ch);
      for (const tr of trans) {
        const clip = t.video.find((c) => c.id === tr.id)!;
        expect(tr.d % 2).toBe(0);
        expect(tr.start + tr.d / 2).toBe(clip.from); // centred on the anchored cut
        const inc = seqs.find((s) => s.id === tr.id)!;
        expect(inc.head).toBe(tr.d / 2);
        expect(inc.start).toBe(clip.from - tr.d / 2);
        const prev = seqs[seqs.indexOf(inc) - 1]!;
        expect(prev.tail).toBe(tr.d / 2);
        expect(prev.end).toBe(clip.from + tr.d / 2);
        checked++;
      }
    }
    expect(checked).toBe(factoryOverlaps.length);
  });

  it("video trimBefore = sourceInFrames − head handle", () => {
    for (const ch of ct.chapters) {
      for (const s of ch.series) {
        if (s.type !== "seq") continue;
        if (s.clip.source.kind === "video") expect(s.trimBefore).toBe(s.clip.source.sourceInFrames - s.headHandle);
        else expect(s.trimBefore).toBe(0);
      }
    }
  });

  it("odd overlap durations are rounded down to even; overlaps on a chapter's first clip become cuts", () => {
    const i = innerClipIndex(t, 40, "image");
    const odd = withTransition(t, i, { kind: "overlap", presentation: "dissolve", durationFrames: 11 as never, direction: "left" });
    const c1 = computeTimeline(odd);
    const tr = c1.chapters.flatMap((c) => c.series).find((s) => s.type === "trans" && s.clipId === t.video[i]!.id);
    expect(tr?.durationInFrames).toBe(10);
    expect(c1.warnings.some((w) => w.includes("adjusted to 10"))).toBe(true);

    const firstOfCh2 = t.video.findIndex((c) => c.from === t.chapters[1]!.from);
    const bad = withTransition(t, firstOfCh2, { kind: "overlap", presentation: "dissolve", durationFrames: 10, direction: "left" });
    const c2 = computeTimeline(bad);
    expect(c2.chapters[1]!.series[0]!.type).toBe("seq");
    expect(c2.chapters[1]!.series.some((s) => s.type === "trans" && s.clipId === t.video[firstOfCh2]!.id)).toBe(false);
    expect(c2.warnings.some((w) => w.includes("first clip"))).toBe(true);
  });

  it("an overlap longer than its neighbours allow is shortened (lint T_OVERLAP) and never breaks the series", () => {
    const i = innerClipIndex(t, 30);
    const minDur = Math.min(t.video[i]!.dur, t.video[i - 1]!.dur);
    const long = withTransition(t, i, { kind: "overlap", presentation: "dissolve", durationFrames: 30, direction: "left" });
    // make the previous clip short enough to force the clamp
    long.video[i - 1] = { ...long.video[i - 1]!, transitionIn: cut };
    const c = computeTimeline(long);
    const tr = c.chapters.flatMap((x) => x.series).find((s) => s.type === "trans" && s.clipId === t.video[i]!.id);
    if (minDur - 2 >= 30) expect(tr?.durationInFrames).toBe(30);
    else expect(tr?.durationInFrames ?? 0).toBeLessThanOrEqual(minDur - 2);
    for (const ch of c.chapters) {
      const seq = ch.series.filter((s) => s.type === "seq").reduce((a, s) => a + s.durationInFrames, 0);
      const trans = ch.series.filter((s) => s.type === "trans").reduce((a, s) => a + s.durationInFrames, 0);
      expect(seq - trans).toBe(ch.dur);
    }
  });

  it("cut accents: pulses and flashes", () => {
    const pulses = t.video.filter((c) => c.transitionIn.kind === "cut" && c.transitionIn.accent.type === "pulse");
    expect(ct.pulses.map((p) => p.from)).toEqual(pulses.map((c) => c.from));
    const i = innerClipIndex(t);
    const fl = computeTimeline(withTransition(t, i, { kind: "cut", accent: { type: "flash", peak: 0.4, frames: 4, color: "#FFFFFF" } }));
    expect(fl.cutFlashes).toContainEqual({ from: t.video[i]!.from - 2, dur: 4, peak: 0.4, color: "#FFFFFF" });
  });

  it("velocity accents: exit on A, entry on B, frames clamped to the clips, pushCut flash", () => {
    const i = innerClipIndex(t, 20);
    const A = t.video[i - 1]!;
    const B = t.video[i]!;
    const v = computeTimeline(withTransition(t, i, { kind: "cut", accent: { type: "velocity", preset: "whip", direction: "left", exitFrames: 8, entryFrames: 8, flash: 0 } }));
    expect(v.exits[A.id]).toEqual({ preset: "whip", direction: "left", frames: 8, flash: 0 });
    expect(v.entries[B.id]).toEqual({ preset: "whip", direction: "left", frames: 8, flash: 0 });
    expect(v.cutFlashes.length).toBe(ct.cutFlashes.length);

    const p = computeTimeline(withTransition(t, i, { kind: "cut", accent: { type: "velocity", preset: "pushCut", direction: "left", exitFrames: 5, entryFrames: 6, flash: 0.2 } }));
    expect(p.cutFlashes).toContainEqual({ from: B.from - 1, dur: 2, peak: 0.2, color: "#f5f2ed" });

    const short = clone(t);
    short.video[i] = { ...B, transitionIn: { kind: "cut", accent: { type: "velocity", preset: "zoomThrough", direction: "left", exitFrames: 20, entryFrames: 30, flash: 0 } } };
    const s = computeTimeline(short);
    expect(s.exits[A.id]!.frames).toBe(Math.min(20, A.dur));
    expect(s.entries[B.id]!.frames).toBe(Math.min(30, B.dur));
  });

  it("covers: flash centred on the cut; dips switch mid-hold; glitch adds derived glitch + rgb fx", () => {
    const flashes = t.video.filter((c) => c.transitionIn.kind === "cover");
    expect(ct.covers.length).toBe(flashes.length);
    for (const w of ct.covers) {
      expect(w.from).toBe(w.cut - Math.floor(w.dur / 2));
      expect(w.presentation).toBe("flash");
    }
    const i = innerClipIndex(t);
    const B = t.video[i]!;
    const dip = computeTimeline(withTransition(t, i, { kind: "cover", presentation: "dipToBlack", durationFrames: 30, direction: "left", color: "#000000", peak: 1 }));
    const w = dip.covers.find((c) => c.clipId === B.id)!;
    const ph = dipPhases(30);
    expect(ph.out + ph.hold + ph.inn).toBe(30);
    expect(w.cut - w.from).toBe(ph.out + Math.floor(ph.hold / 2));
    expect(w.cut - w.from).toBeGreaterThanOrEqual(ph.out);
    expect(w.cut - w.from).toBeLessThan(ph.out + ph.hold);

    const g = computeTimeline(withTransition(t, i, { kind: "cover", presentation: "glitch", durationFrames: 6, direction: "left", color: "#FFFFFF", peak: 0.8 }));
    const derived = g.fx.filter((f) => f.id.startsWith(`fx:${B.id}:cover-`));
    expect(derived.map((f) => f.fx).sort()).toEqual(["glitch", "rgb"]);
    for (const f of derived) {
      expect(f.from).toBe(B.from - 3);
      expect(f.dur).toBe(6);
    }
    expect(g.fx.map((f) => f.from)).toEqual([...g.fx.map((f) => f.from)].sort((a, b) => a - b));
  });

  it("overlays that treat the picture add derived fx (no backdrop-filter): counter blur, blur slams, comment piles", () => {
    const counters = t.overlays.filter((o) => o.component === "NumberCounter");
    for (const o of counters) {
      const b = ct.fx.find((f) => f.id === `fx:${o.id}:blur`)!;
      expect(b).toMatchObject({ fx: "blur", from: o.from, dur: o.dur, amt: 3, shape: "span", target: "picture" });
    }
    const u = clone(t);
    const slam = u.overlays.find((o) => o.component === "KeywordSlam")!;
    (slam.props as { background: string }).background = "blur";
    const cu = computeTimeline(u);
    expect(cu.fx.filter((f) => f.id.startsWith(`fx:${slam.id}:`)).map((f) => [f.fx, f.amt])).toEqual([["blur", 18], ["dark", 0.55]]);
  });

  it("deferred covers resolve through DEFERRED_TRANSITIONS only when unimplemented", () => {
    expect(resolveCover("flash")).toEqual({ presentation: "flash", mapped: false });
    expect(resolveCover("iris").presentation).toBe("iris");
    expect(resolveCover("nope" as never)).toEqual({ presentation: "flash", mapped: true });
    const i = innerClipIndex(t);
    const u = withTransition(t, i, { kind: "cover", presentation: "paperRip", durationFrames: 12, direction: "left", color: "#FFFFFF", peak: 1 });
    expect(coverWindow(u.video[i]!, u.durationInFrames)!.presentation).toBe("paperRip");
  });

  it("overlays by band, sorted by (z, from, id); burned captions only", () => {
    const bands = { picture: 0, graphics: 0, hud: 0 };
    for (const o of t.overlays) bands[o.band]++;
    expect(ct.overlays.graphics.length).toBe(bands.graphics);
    expect(ct.overlays.hud.length).toBe(bands.hud);
    for (const list of Object.values(ct.overlays)) {
      for (let k = 1; k < list.length; k++) {
        const a = list[k - 1]!;
        const b = list[k]!;
        expect(a.z < b.z || (a.z === b.z && (a.from < b.from || (a.from === b.from && a.id < b.id)))).toBe(true);
      }
    }
    expect(ct.captions.length).toBe(t.captions.filter((g) => g.burn && g.variant !== "srt").length);
    expect(ct.captions.every((g) => g.burn && g.variant !== "srt")).toBe(true);
  });

  it("is pure: deterministic and does not mutate its input", () => {
    const before = JSON.stringify(t);
    expect(computeTimeline(t)).toEqual(ct);
    expect(JSON.stringify(t)).toBe(before);
  });

  it("degrades malformed timelines: gaps filled with ink, overlaps trimmed, chapter-straddling clips split", () => {
    const u = clone(t);
    const gapClip = u.video[3]!;
    u.video.splice(3, 1); // hole in the picture
    const c = computeTimeline(u);
    expect(c.warnings.some((w) => w.includes("no picture"))).toBe(true);
    const parts = pictureParts(c);
    const filler = parts.find((p) => p.id === `gap:${gapClip.from}`)!;
    expect(filler.source).toEqual({ kind: "solid", color: t.render.tokens.palette.ink });
    // parts tile [0, N)
    let cursor = 0;
    for (const p of parts) {
      expect(p.from).toBe(cursor);
      cursor += p.dur;
    }
    expect(cursor).toBe(u.durationInFrames);

    const v = clone(t);
    const ch2 = v.chapters[1]!.from;
    const lastCh1 = v.video.findIndex((x) => x.from + x.dur === ch2);
    v.video[lastCh1] = { ...v.video[lastCh1]!, dur: v.video[lastCh1]!.dur + 10 }; // runs 10 f into CH2 (overlapping its first clip)
    const cv = computeTimeline(v);
    expect(cv.warnings.length).toBeGreaterThan(0);
    for (const ch of cv.chapters) {
      const seq = ch.series.filter((s) => s.type === "seq").reduce((a, s) => a + s.durationInFrames, 0);
      const trans = ch.series.filter((s) => s.type === "trans").reduce((a, s) => a + s.durationInFrames, 0);
      expect(seq - trans).toBe(ch.dur);
    }

    const noCh = clone(t);
    noCh.chapters = [];
    const cn = computeTimeline(noCh);
    expect(cn.chapters.map((x) => [x.id, x.from, x.dur])).toEqual([["_all", 0, t.durationInFrames]]);
  });

  it("partIndexAt finds the clip under a frame", () => {
    const parts = pictureParts(ct);
    for (const f of [0, 1, 129, 130, 849, 850, t.durationInFrames - 1]) {
      const p = parts[partIndexAt(parts, f)]!;
      expect(f >= p.from && f < p.from + p.dur).toBe(true);
    }
    expect(partIndexAt(parts, t.durationInFrames)).toBe(-1);
  });

  it("handles 24/25 fps and long programs quickly", () => {
    for (const fps of [24, 25] as const) {
      const tf = timeline({ seconds: 30, fps });
      const c = computeTimeline(tf);
      expect(c.chapters.reduce((a, x) => a + x.dur, 0)).toBe(tf.durationInFrames);
    }
    const long = timeline({ seconds: 900 });
    const t0 = performance.now();
    const c = computeTimeline(long);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(c.durationInFrames).toBe(long.durationInFrames);
  });
});

describe("planChunks", () => {
  const t = timeline({ seconds: 60 });
  const ct = computeTimeline(t);

  it("is chapter-aligned, inclusive, gap-free and splits long chapters evenly", () => {
    const chunks = planChunks(ct, 300);
    expect(chunks[0]!.from).toBe(0);
    expect(chunks[chunks.length - 1]!.to).toBe(t.durationInFrames - 1);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i]!.from).toBe(chunks[i - 1]!.to + 1);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
    for (const ch of t.chapters) {
      expect(chunks.some((c) => c.from === ch.from)).toBe(true);
      const inside = chunks.filter((c) => c.from >= ch.from && c.to < ch.from + ch.dur);
      const sizes = inside.map((c) => c.to - c.from + 1);
      expect(sizes.reduce((a, b) => a + b, 0)).toBe(ch.dur);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(300);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      expect(inside.length).toBe(Math.ceil(ch.dur / 300));
    }
  });

  it("one chunk per chapter when chunks are larger than chapters (and for invalid sizes)", () => {
    for (const size of [10_000, 0, Number.NaN]) {
      const chunks = planChunks(ct, size);
      expect(chunks.map((c) => [c.from, c.to])).toEqual(t.chapters.map((c) => [c.from, c.from + c.dur - 1]));
    }
  });
});

describe("sliceHash", () => {
  const t = timeline({ seconds: 60 });
  const ctx = { codeHash: "a".repeat(64), preset: "draft", premount: 30 };

  it("is a stable sha256", () => {
    const h = sliceHash(t, 850, 1149, ctx);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sliceHash(clone(t), 850, 1149, ctx)).toBe(h);
  });

  it("is sensitive to content inside the window, to the code hash and to the preset", () => {
    const h = sliceHash(t, 850, 1149, ctx);
    expect(sliceHash(t, 850, 1149, { ...ctx, codeHash: "b".repeat(64) })).not.toBe(h);
    expect(sliceHash(t, 850, 1149, { ...ctx, preset: "master" })).not.toBe(h);
    const u = clone(t);
    const lt = u.overlays.find((o) => o.from >= 850 && o.from < 1149)!;
    (lt.props as Record<string, unknown>).role = "changed";
    expect(sliceHash(u, 850, 1149, ctx)).not.toBe(h);
    const g = clone(t);
    g.grade.css.contrast += 0.1;
    expect(sliceHash(g, 850, 1149, ctx)).not.toBe(h);
  });

  it("ignores content outside [from − premount, to + premount] and audio", () => {
    const h = sliceHash(t, 1200, 1499, ctx);
    const u = clone(t);
    const early = u.overlays.find((o) => o.from + o.dur < 1200 - ctx.premount)!;
    (early.props as Record<string, unknown>).text = "changed far away";
    u.audio.sfx = [];
    u.markers = [];
    expect(sliceHash(u, 1200, 1499, ctx)).toBe(h);
  });

  it("chunk-relative invariance: shifting a chunk's items by a constant leaves its hash unchanged", () => {
    const k = 45;
    const shifted = shiftAll(t, k);
    for (const [from, to] of [[300, 599], [850, 1149], [1500, 1799]] as const) {
      expect(sliceHash(shifted, from + k, to + k, ctx)).toBe(sliceHash(t, from, to, ctx));
    }
  });

  it("lengthening CH1 does not invalidate later chunks whose content is unchanged", () => {
    const k = 37;
    const longer = lengthenFirstChapter(t, k);
    const before = planChunks(computeTimeline(t), 300).filter((c) => c.from >= t.chapters[1]!.from);
    const after = planChunks(computeTimeline(longer), 300).filter((c) => c.from >= longer.chapters[1]!.from);
    expect(after.length).toBe(before.length);
    // chunks beyond the premount reach of CH1's last clip keep their hash
    for (let i = 1; i < before.length; i++) {
      expect(sliceHash(longer, after[i]!.from, after[i]!.to, ctx)).toBe(sliceHash(t, before[i]!.from, before[i]!.to, ctx));
    }
  });

  it("hashes referenced assets (a re-conformed file changes the slice)", () => {
    const h = sliceHash(t, 0, 299, ctx);
    const u: Timeline = clone(t);
    const id = u.video.find((c) => c.source.kind === "image" && c.from < 299)!.source as { assetId: string };
    u.assets[id.assetId] = { ...u.assets[id.assetId]!, width: 1280 };
    expect(sliceHash(u, 0, 299, ctx)).not.toBe(h);
  });
});
