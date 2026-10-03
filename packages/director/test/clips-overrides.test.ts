import { describe, expect, it } from "vitest";
import { buildAnchorIndex, type OverridesDoc, type Timeline } from "@docmaker/core";
import { TEST_NOW, TEST_STYLE } from "@docmaker/core/testing";
import { applyOverrides, direct } from "../src/index";
import { errorsOf, runs } from "./helpers";
import { policyScenario } from "./scenario";

describe("clips", () => {
  const sc = policyScenario();
  const out = runs().policy;
  const t = out.timeline;
  const seg = sc.clipSegment!;
  const pics = t.video.filter((c) => c.beatId === `${seg}-CLIP` && c.source.kind === "video");

  it("a clip longer than 8 s switches pip → cover at a sentence boundary", () => {
    expect(pics.length).toBeGreaterThanOrEqual(2);
    expect(pics[0]!.layout).toBe("pip");
    expect(pics[0]!.layoutParams).not.toBeNull();
    expect(pics[1]!.layout).toBe("cover");
    // the switch lands just before a clip word that starts a sentence
    const words = sc.input.clipWords[seg]!;
    const segL = sc.layout.segments.find((s) => s.segmentId === seg)!;
    const inMs = segL.clipPassageInMs!;
    const starts = words.filter((w, k) => k > 0 && /[.?!]$/.test(words[k - 1]!.text)).map((w) => segL.from + Math.round(((w.startMs - inMs) * t.fps) / 1000) - TEST_STYLE.cameraPolicy.shots.cutLeadFrames);
    expect(starts).toContain(pics[1]!.from);
    expect(pics.every((c) => c.sourceLabel?.startsWith("Source: "))).toBe(true);
    expect(t.overlays.some((o) => o.component === "SourceLabel" && o.beatId === `${seg}-CLIP`)).toBe(true);
  });

  it("clip picture and audio stay lip-synced (J cut) and inside their media (MEDIA_RANGE)", () => {
    const ca = t.audio.clip.find((c) => c.segmentId === seg)!;
    expect(ca).toBeDefined();
    const p0 = pics[0]!;
    expect(ca.sourceInFrames - (p0.source.kind === "video" ? p0.source.sourceInFrames : 0)).toBe(ca.from - p0.from);
    expect(out.stats.jlCuts).toBeGreaterThanOrEqual(1);
    const media = t.assets[ca.assetId]!.durationFrames!;
    expect(ca.sourceInFrames).toBeGreaterThanOrEqual(0);
    expect(ca.sourceInFrames + ca.dur).toBeLessThanOrEqual(media);
    expect(out.lint.filter((l) => l.rule === "MEDIA_RANGE" || l.rule === "T_OVERLAP")).toEqual([]);
  });

  it("overlap transitions (crossfade intents) keep MEDIA_RANGE and T_OVERLAP clean", () => {
    const sc2 = policyScenario({ seconds: 300, chapters: 3 });
    const plans = sc2.input.plans.map((p, k) => (k % 3 === 1 && !p.id.endsWith("-CLIP") && !p.id.endsWith("-BR") ? { ...p, transitionIn: "crossfade" as const } : p));
    const out2 = direct({ ...sc2.input, plans });
    const overlaps = out2.timeline.video.filter((c) => c.transitionIn.kind === "overlap");
    expect(overlaps.length).toBeGreaterThan(0);
    for (const c of overlaps) expect(c.transitionIn.kind === "overlap" && c.transitionIn.durationFrames % 2).toBe(0);
    expect(errorsOf(out2)).toEqual([]);
  });
});

describe("applyOverrides", () => {
  const sc = policyScenario({ seconds: 240, chapters: 3 });
  const base = direct(sc.input).timeline;
  const ix = buildAnchorIndex(sc.layout, sc.layoutHash);
  const ctx = { style: TEST_STYLE, validateAsset: sc.input.validateAsset, plans: sc.input.plans };
  const doc = (overrides: OverridesDoc["overrides"]): OverridesDoc => ({ schemaVersion: 1, lang: "en", overrides });
  const target = (itemId: string, o: Partial<OverridesDoc["overrides"][number]["target"]> = {}) => ({ itemId, component: null, beatId: null, planKey: null, assetId: null, wordNorm: null, ...o });
  const clip = base.video.find((c, i) => i > 3 && c.source.kind === "image" && c.beatId && /-B\d{3}$/.test(c.beatId))!;
  const plan = sc.input.plans.find((p) => p.id === clip.beatId)!;
  const ov = base.overlays.find((o) => o.component === "KineticText" || o.component === "NumberCounter")!;

  it("applies valid overrides (transition, props, sfx gain, removal, added overlay)", () => {
    const sfx = base.audio.sfx[0]!;
    const wordId = sc.layout.words[20]!.id;
    const r = applyOverrides(base, doc([
      { id: "o1", createdAt: TEST_NOW, target: target(clip.id, { beatId: clip.beatId, planKey: plan.planKey }), override: { op: "setTransition", clipId: clip.id, transition: { kind: "cover", presentation: "flash", durationFrames: 4, direction: "left", color: "#FFFFFF", peak: 0.3 } } },
      { id: "o2", createdAt: TEST_NOW, target: target(sfx.id), override: { op: "setSfxGain", itemId: sfx.id, gainDb: -3 } },
      { id: "o3", createdAt: TEST_NOW, target: target(ov.id, { component: ov.component }), override: { op: "removeItem", itemId: ov.id } },
      {
        id: "o4", createdAt: TEST_NOW, target: target("ov:user:KineticText:0"),
        override: {
          op: "addOverlay", item: {
            id: "ov:user:KineticText:0", start: { ref: "word", wordId, edge: "start", offset: 0, expectNorm: sc.layout.words[20]!.norm }, end: { ref: "word", wordId, edge: "start", offset: 60, expectNorm: sc.layout.words[20]!.norm },
            from: 0, dur: 1, beatId: null, band: "graphics", z: 120, zone: "center", enterFrames: 8, exitFrames: 6, followsCamera: false, component: "KineticText",
            props: { lines: ["USER NOTE"], emphasis: [], align: "center" },
          },
        },
      },
    ]), ix, ctx);
    expect(r.rejected).toEqual([]);
    const t: Timeline = r.timeline;
    expect(t.video.find((c) => c.id === clip.id)!.transitionIn.kind).toBe("cover");
    expect(t.audio.sfx.find((x) => x.id === sfx.id)!.gainDb).toBe(-3);
    expect(t.overlays.some((o) => o.id === ov.id)).toBe(false);
    const added = t.overlays.find((o) => o.id === "ov:user:KineticText:0")!;
    expect(added.from).toBe(sc.layout.words[20]!.from);
    expect(added.dur).toBe(60);
  });

  it("rejects a fingerprint mismatch (planKey changed)", () => {
    const r = applyOverrides(base, doc([{ id: "x", createdAt: TEST_NOW, target: target(clip.id, { beatId: clip.beatId, planKey: "0123456789abcdef" }), override: { op: "setLayout", clipId: clip.id, layout: "card" } }]), ix, ctx);
    expect(r.rejected.map((x) => x.id)).toEqual(["x"]);
    expect(r.rejected[0]!.reason).toMatch(/planKey/);
    expect(r.timeline).toBe(base);
  });

  it("rejects removeItem on vo:* and on picture clips", () => {
    const vo = base.audio.vo[0]!;
    const r = applyOverrides(base, doc([
      { id: "a", createdAt: TEST_NOW, target: target(vo.id), override: { op: "removeItem", itemId: vo.id } },
      { id: "b", createdAt: TEST_NOW, target: target(clip.id), override: { op: "removeItem", itemId: clip.id } },
    ]), ix, ctx);
    expect(r.rejected.map((x) => x.id)).toEqual(["a", "b"]);
    expect(r.timeline.audio.vo.some((x) => x.id === vo.id)).toBe(true);
  });

  it("rejects invalid merged props, policy failures and invalid overlaps", () => {
    const short = base.video.find((c, i) => i > 0 && c.dur < 32 && base.video[i - 1]!.chapterId === c.chapterId)!;
    const r = applyOverrides(base, doc([
      { id: "p", createdAt: TEST_NOW, target: target(ov.id, { component: ov.component }), override: { op: "patchOverlayProps", itemId: ov.id, props: { lines: [] , value: "not a number" } } },
      { id: "s", createdAt: TEST_NOW, target: target(clip.id), override: { op: "replaceSource", clipId: clip.id, source: { kind: "image", assetId: "e".repeat(64), crop: null, focal: { x: 0.5, y: 0.5 } } } },
      { id: "t", createdAt: TEST_NOW, target: target(short.id), override: { op: "setTransition", clipId: short.id, transition: { kind: "overlap", presentation: "dissolve", durationFrames: 30, direction: "left" } } },
    ]), ix, { ...ctx, validateAsset: () => [{ level: "error", rule: "POLICY", where: "x", msg: "AI image of a real person" }] });
    expect(r.rejected.map((x) => x.id).sort()).toEqual(["p", "s", "t"]);
  });

  it("re-matches a moved word anchor by its norm, and rejects a vanished one", () => {
    const w = sc.layout.words[30]!;
    const wrongId = `${w.segmentId}:${w.idx + 1}`;
    const item = (id: string, wordId: string, norm: string) => ({
      id, start: { ref: "word" as const, wordId, edge: "start" as const, offset: 0, expectNorm: norm }, end: { ref: "word" as const, wordId, edge: "start" as const, offset: 45, expectNorm: norm },
      from: 0, dur: 1, beatId: null, band: "graphics" as const, z: 120, zone: "center" as const, enterFrames: 8, exitFrames: 6, followsCamera: false, component: "KineticText" as const,
      props: { lines: ["X"], emphasis: [], align: "center" as const },
    });
    const r = applyOverrides(base, doc([
      { id: "m", createdAt: TEST_NOW, target: target("ov:user:KineticText:1"), override: { op: "addOverlay", item: item("ov:user:KineticText:1", wrongId, w.norm) } },
      { id: "n", createdAt: TEST_NOW, target: target("ov:user:KineticText:2"), override: { op: "addOverlay", item: item("ov:user:KineticText:2", wrongId, "zzzzzz") } },
    ]), ix, ctx);
    expect(r.rejected.map((x) => x.id)).toEqual(["n"]);
    expect(r.timeline.overlays.find((o) => o.id === "ov:user:KineticText:1")!.from).toBe(w.from);
  });

  it("direct applies overrides and reports rejections without throwing", () => {
    const out = direct({ ...sc.input, overrides: doc([
      { id: "ok", createdAt: TEST_NOW, target: target(clip.id, { beatId: clip.beatId, planKey: plan.planKey }), override: { op: "setLayout", clipId: clip.id, layout: "card" } },
      { id: "bad", createdAt: TEST_NOW, target: target("v:CH9-B001:0"), override: { op: "setLayout", clipId: "v:CH9-B001:0", layout: "card" } },
    ]) });
    expect(out.rejectedOverrides.map((x) => x.id)).toEqual(["bad"]);
    expect(out.timeline.video.find((c) => c.id === clip.id)!.layout).toBe("card");
    expect(out.lint.some((l) => l.rule === "OVERRIDE_REJECTED" && l.where === "bad")).toBe(true);
  });

  it("a replaceSource onto an AI asset gets an illustration label; replacing an AI picture drops the stale label (AI_DISCLOSURE)", () => {
    const decl = { kind: "ai-generated" as const, license: null, author: "", url: "", note: "" };
    const illus = (t: Timeline) => t.overlays.filter((o) => o.component === "SourceLabel" && (o.props as { kind: string }).kind === "illustration");
    const over = (t: Timeline, c: { from: number; dur: number }) => illus(t).filter((o) => o.from < c.from + c.dur && c.from < o.from + o.dur);
    const realId = clip.source.kind === "image" ? clip.source.assetId : "";
    // (1) a new AI image swapped onto a non-person beat clip
    const aiId = "a".repeat(64);
    const frozen = { ...sc.input.frozen, [aiId]: { ...sc.input.frozen[realId]!, id: aiId, declaration: decl } };
    const out = direct({ ...sc.input, frozen, overrides: doc([{ id: "ai", createdAt: TEST_NOW, target: target(clip.id), override: { op: "replaceSource", clipId: clip.id, source: { kind: "image", assetId: aiId, crop: null, focal: { x: 0.5, y: 0.5 } } } }]) });
    expect(out.rejectedOverrides).toEqual([]);
    const c1 = out.timeline.video.find((c) => c.id === clip.id)!;
    expect(c1.source.kind === "image" && c1.source.assetId).toBe(aiId);
    const labels = over(out.timeline, c1);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.from).toBe(c1.from);
    expect(labels[0]!.from + labels[0]!.dur).toBe(c1.from + c1.dur);
    expect(out.lint.filter((l) => l.rule === "AI_DISCLOSURE")).toEqual([]);
    expect(out.lint.filter((l) => l.rule === "RESOLVE_MISMATCH" || l.rule === "IDS_UNIQUE")).toEqual([]);
    // (2) the clip's own picture is AI (labelled by step 7); replacing it with a real photo leaves no false label
    const frozen2 = { ...sc.input.frozen, [realId]: { ...sc.input.frozen[realId]!, declaration: decl } };
    const before = direct({ ...sc.input, frozen: frozen2 });
    expect(over(before.timeline, clip).length).toBeGreaterThan(0);
    expect(before.lint.filter((l) => l.rule === "AI_DISCLOSURE")).toEqual([]);
    const other = base.video.map((c) => (c.source.kind === "image" ? c.source.assetId : null)).find((id) => id !== null && id !== realId)!;
    const after = direct({ ...sc.input, frozen: frozen2, overrides: doc([{ id: "real", createdAt: TEST_NOW, target: target(clip.id), override: { op: "replaceSource", clipId: clip.id, source: { kind: "image", assetId: other, crop: null, focal: { x: 0.5, y: 0.5 } } } }]) });
    expect(after.rejectedOverrides).toEqual([]);
    expect(over(after.timeline, clip)).toEqual([]);
    expect(after.lint.filter((l) => l.rule === "AI_DISCLOSURE")).toEqual([]);
    // every remaining AI clip is still covered
    for (const c of after.timeline.video) {
      if (c.source.kind === "image" && c.source.assetId === realId) expect(over(after.timeline, c).length, c.id).toBeGreaterThan(0);
    }
  });

  it("a replaceSource refused by validateAsset is a POLICY lint error (§16.6)", () => {
    const imageId = (c: Timeline["video"][number]) => (c.source.kind === "image" ? c.source.assetId : null);
    const other = base.video.map(imageId).find((id) => id !== null && id !== imageId(clip))!;
    const out = direct({
      ...sc.input,
      // only the replacement fails the policy (every placed asset is re-checked too)
      validateAsset: (id) => (id === other ? [{ level: "error", rule: "POLICY", where: "x", msg: "CC-BY-NC under monetized" }] : []),
      overrides: doc([{ id: "nc", createdAt: TEST_NOW, target: target(clip.id), override: { op: "replaceSource", clipId: clip.id, source: { kind: "image", assetId: other, crop: null, focal: { x: 0.5, y: 0.5 } } } }]),
    });
    expect(out.rejectedOverrides.map((x) => x.id)).toEqual(["nc"]);
    expect(out.lint.find((l) => l.where === "nc")).toMatchObject({ level: "error", rule: "POLICY" });
  });
});
