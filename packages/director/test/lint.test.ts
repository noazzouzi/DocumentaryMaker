import { describe, expect, it } from "vitest";
import { COMPONENT_META, docHash, type StyleData, type Timeline } from "@docmaker/core";
import { TEST_STYLE, makeLayout, makeTimeline } from "@docmaker/core/testing";
import { LINT_RULES, lintTimeline } from "../src/index";
import { holdOf } from "../src/overlays/hold";
import { runs } from "./helpers";

const TABLE: Record<string, "error" | "warn"> = {
  V_CONTIGUOUS: "error", V_BOUNDS: "error", IDS_UNIQUE: "error", ASSET_MISSING: "error", RESOLVE_MISMATCH: "error", T_OVERLAP: "error",
  MEDIA_RANGE: "error", ZONE_KEEPOUT: "error", OVERSHOOT: "error", FLASH_CAP: "error", TRANSITION_RUN: "error", POLICY: "error",
  PRIVATE_PERSON: "error", CLIP_SHARE: "error", DENSITY_MAX: "warn", DENSITY_MIN: "warn", STATIC_HOLD: "warn", NO_VISUAL_CHANGE: "warn",
  READABILITY: "warn", PRIMARY_SHARE: "warn", SILENT_CUT_SHARE: "warn", SFX_REPEAT: "warn", TECHNIQUE_FLOOR: "warn", UPSCALE: "warn", ASSET_REUSE: "warn",
};

describe("LINT_RULES", () => {
  it("is exactly the §4.13 table", () => {
    expect(Object.keys(LINT_RULES).sort()).toEqual(Object.keys(TABLE).sort());
    for (const [k, v] of Object.entries(TABLE)) {
      expect(LINT_RULES[k]!.level, k).toBe(v);
      expect(LINT_RULES[k]!.help.length).toBeGreaterThan(10);
    }
  });
});

describe("lintTimeline", () => {
  const layout = makeLayout({ seconds: 60 });
  const ctx = { layout, layoutHash: docHash(layout), frozen: {} };
  // the factory's transition pattern (flash 0.6 every sixth shot) is not drama-policy compliant: start from plain cuts
  const raw = makeTimeline({ seconds: 60 });
  const base: Timeline = { ...raw, video: raw.video.map((c) => ({ ...c, transitionIn: c.transitionIn.kind === "overlap" ? c.transitionIn : { kind: "cut", accent: { type: "none" } } })) };
  const lint = (t: Timeline, style: StyleData = TEST_STYLE) => lintTimeline(t, style, ctx);
  const has = (t: Timeline, rule: string, style?: StyleData) => lint(t, style).some((i) => i.rule === rule && i.level === TABLE[rule]);
  const clone = () => structuredClone(base);

  it("passes the factory timeline without errors (and flags its explicit-flash pattern)", () => {
    expect(lint(base).filter((i) => i.level === "error")).toEqual([]);
    expect(lint(raw).some((i) => i.rule === "FLASH_CAP")).toBe(true);
  });

  it("flags picture gaps (V_CONTIGUOUS) and items past the end (V_BOUNDS)", () => {
    const t = clone();
    t.video[1] = { ...t.video[1]!, from: t.video[1]!.from + 1, dur: t.video[1]!.dur - 1 };
    expect(has(t, "V_CONTIGUOUS")).toBe(true);
    const u = clone();
    u.overlays[0] = { ...u.overlays[0]!, dur: u.durationInFrames - u.overlays[0]!.from + 10 };
    expect(has(u, "V_BOUNDS")).toBe(true);
  });

  it("flags duplicate ids, missing assets and anchors that do not resolve", () => {
    const t = clone();
    t.captions.push({ ...t.captions[0]! });
    expect(has(t, "IDS_UNIQUE")).toBe(true);
    const u = clone();
    delete u.assets[u.audio.voProgram.assetId];
    expect(has(u, "ASSET_MISSING")).toBe(true);
    const v = clone();
    v.overlays[0] = { ...v.overlays[0]!, from: v.overlays[0]!.from + 1 };
    expect(has(v, "RESOLVE_MISMATCH")).toBe(true);
  });

  it("flags overlap on a chapter's first clip, media overruns and keep-out zones", () => {
    const t = clone();
    const i = t.video.findIndex((c, k) => k > 0 && t.chapters.some((ch) => ch.from === c.from));
    t.video[i] = { ...t.video[i]!, transitionIn: { kind: "overlap", presentation: "dissolve", durationFrames: 10, direction: "left" } };
    expect(has(t, "T_OVERLAP")).toBe(true);
    const u = clone();
    const vi = u.video.findIndex((c) => c.source.kind === "video");
    const c = u.video[vi]!;
    if (c.source.kind === "video") u.video[vi] = { ...c, source: { ...c.source, sourceInFrames: 100000 } };
    expect(has(u, "MEDIA_RANGE")).toBe(true);
    const style: StyleData = structuredClone(TEST_STYLE);
    const w = clone();
    w.render = { ...w.render, tokens: { ...w.render.tokens, layout: { ...w.render.tokens.layout, keepOut: [{ x: 0, y: 600, w: 1920, h: 480, reason: "test" }] } } };
    expect(has(w, "ZONE_KEEPOUT", style)).toBe(true);
  });

  it("flags disallowed overshoot, flash caps and transition runs", () => {
    const t = clone();
    t.render = { ...t.render, motion: { ...t.render.motion, overshootAllowedIn: [] } };
    if (t.overlays.some((o) => COMPONENT_META[o.component].overshootAllowed)) expect(has(t, "OVERSHOOT")).toBe(true);
    const u = clone();
    u.video[3] = { ...u.video[3]!, transitionIn: { kind: "cover", presentation: "flash", durationFrames: 4, direction: "left", color: "#FFFFFF", peak: 0.95 } };
    expect(has(u, "FLASH_CAP")).toBe(true);
    const v = clone();
    const fl = { kind: "cover", presentation: "glitch", durationFrames: 6, direction: "left", color: "#FFFFFF", peak: 0.8 } as const;
    for (const k of [2, 3, 4]) v.video[k] = { ...v.video[k]!, transitionIn: fl };
    expect(has(v, "TRANSITION_RUN")).toBe(true);
  });

  it("flags excessive clip share", () => {
    const t = clone();
    t.video = t.video.map((c, k) => (k % 2 === 0 && c.source.kind === "video" ? c : k < 12 ? { ...c, beatId: "CH1-S01-CLIP", source: { kind: "video", assetId: Object.values(t.assets).find((a) => a.kind === "video")!.id, sourceInFrames: 0, crop: null, focal: { x: 0.5, y: 0.5 } } } : c));
    expect(lint(t).some((i) => i.rule === "CLIP_SHARE")).toBe(true);
  });

  it("flags a clip passage longer than maxClipSeconds (when the caller passes it)", () => {
    const t = clone();
    const vid = Object.values(t.assets).find((a) => a.kind === "video")!.id;
    // consecutive shots from #3 until the passage reaches ≥ 5 s
    let total = 0;
    t.video = t.video.map((c, k) => {
      if (k < 3 || total >= 5 * t.fps) return c;
      total += c.dur;
      return { ...c, beatId: "CH1-S02-CLIP", source: { kind: "video", assetId: vid, sourceInFrames: 0, crop: null, focal: { x: 0.5, y: 0.5 } } };
    });
    const clipLen = (max: number | null) => lintTimeline(t, TEST_STYLE, { ...ctx, maxClipSeconds: max }).filter((i) => i.rule === "CLIP_SHARE" && i.where === "CH1-S02-CLIP");
    expect(total).toBeGreaterThanOrEqual(5 * t.fps);
    expect(clipLen(3).map((i) => i.level)).toEqual(["error"]);
    expect(clipLen(Math.ceil(total / t.fps))).toEqual([]);
    expect(clipLen(null)).toEqual([]);
  });

  it("warns on static holds, missing visual change and short reads", () => {
    const t = clone();
    t.video = t.video.map((c) => ({ ...c, camera: { ...c.camera, kind: "static", keys: [{ f: 0, scale: 1.04, x: 0, y: 0, rot: 0 }] } }));
    t.fx = [];
    t.overlays = t.overlays.filter((o) => o.band === "hud");
    const merged = { ...t.video[0]!, dur: 600 };
    t.video = [merged, ...t.video.filter((c) => c.from >= 600)];
    const issues = lintTimeline(t, TEST_STYLE, ctx);
    expect(issues.some((i) => i.rule === "STATIC_HOLD")).toBe(true);
    expect(issues.some((i) => i.rule === "NO_VISUAL_CHANGE")).toBe(true);
    const u = clone();
    const lt = u.overlays.findIndex((o) => o.component === "LowerThird");
    if (lt >= 0) { u.overlays[lt] = { ...u.overlays[lt]!, dur: 20 }; expect(lint(u).some((i) => i.rule === "READABILITY" && i.where === u.overlays[lt]!.id)).toBe(true); }
  });
});

describe("readability over directed programmes", () => {
  it("every overlay meets its ReadPolicy hold or carries a READABILITY warning", () => {
    for (const [name, out] of Object.entries(runs())) {
      const t = out.timeline;
      for (const o of t.overlays) {
        const m = COMPONENT_META[o.component];
        if (m.read.mode === "none") continue;
        const ats: number[] = [];
        const walk = (v: unknown) => {
          if (Array.isArray(v)) { v.forEach(walk); return; }
          if (v && typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if ((k === "at" || /At$/.test(k)) && typeof x === "number") ats.push(x); else walk(x); }
        };
        walk(o.props);
        const p = o.props as Record<string, unknown>;
        const h = holdOf(o.component, p, t.fps, { narratedEnd: m.read.mode === "narrated" ? (ats.length ? Math.max(...ats) : 0) : null, typeFrames: o.component === "DateStamp" ? Math.round((2 * [...String(p.text)].length * t.fps) / 30) : undefined });
        if (o.dur >= Math.min(h.readHold, h.maxHold)) continue;
        const warned = out.lint.some((i) => i.rule === "READABILITY" && (i.where === o.id || i.where === o.beatId || i.where === o.id.split(":")[1]));
        expect(warned, `${name}: ${o.id}`).toBe(true);
      }
    }
  });
});
