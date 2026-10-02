import { describe, expect, it } from "vitest";
import {
  DocmakerError, buildAnchorIndex, canonicalJson, docHash, msToFrame, resolveAnchor, resolveTimeline, type ProgramLayout,
} from "@docmaker/core";
import { lintTimeline } from "../src/index";
import { buildInputs } from "./fixtures";
import { runs } from "./helpers";
import { richScenario } from "./rich";

describe("anchors (RESOLVE_MISMATCH)", () => {
  const sc = richScenario();
  const b = buildInputs({ script: sc.script, plans: sc.plans, slices: sc.slices, take: sc.take, frozen: sc.frozen, clips: sc.clips });
  const out = runs().rich;
  const t = out.timeline;

  it("resolveTimeline on the director output is the identity", () => {
    const r = resolveTimeline(t, buildAnchorIndex(b.layout, b.layoutHash));
    expect(r.dropped).toEqual([]);
    expect(canonicalJson(r.timeline)).toBe(canonicalJson(t));
    expect(lintTimeline(t, b.input.style, { layout: b.layout, layoutHash: b.layoutHash, frozen: b.frozen }).filter((i) => i.rule === "RESOLVE_MISMATCH")).toEqual([]);
  });

  it("anchors are word/segment/beat/chapter based, not absolute", () => {
    const refs = new Set([...t.video, ...t.overlays, ...t.captions, ...t.fx, ...t.audio.sfx].map((x) => x.start.ref));
    expect(refs.has("word")).toBe(true);
    expect(refs.has("program")).toBe(false);
  });

  it("a different layout hash throws and is reported", () => {
    const other: ProgramLayout = { ...b.layout, pauses: { ...b.layout.pauses, tailMs: b.layout.pauses.tailMs + 1 } };
    const h = docHash(other);
    expect(() => resolveTimeline(t, buildAnchorIndex(other, h))).toThrow(DocmakerError);
    const issues = lintTimeline(t, b.input.style, { layout: other, layoutHash: h, frozen: b.frozen });
    expect(issues.some((i) => i.rule === "RESOLVE_MISMATCH" && i.level === "error")).toBe(true);
  });

  it("a removed word → ANCHOR_MISSING", () => {
    const cap = t.captions.find((c) => c.start.ref === "word")!;
    const wordId = cap.start.ref === "word" ? cap.start.wordId : "";
    const layout = { ...b.layout, words: b.layout.words.filter((w) => w.id !== wordId) };
    const ix = buildAnchorIndex(layout, b.layoutHash);
    try {
      resolveAnchor(cap.start, ix);
      expect.unreachable();
    } catch (e) {
      expect((e as DocmakerError).code).toBe("ANCHOR_MISSING");
    }
    const r = resolveTimeline(t, ix);
    expect(r.dropped).toContain(cap.id);
  });
});

describe("RevealSequence", () => {
  const sc = richScenario();
  const b = buildInputs({ script: sc.script, plans: sc.plans, slices: sc.slices, take: sc.take, frozen: sc.frozen, clips: sc.clips });
  const t = runs().rich.timeline;
  const sil = t.audio.silences.find((s) => s.reason === "reveal")!;

  it("riser ends at the silence start, impact lands on the reveal word, nothing speaks inside the silence", () => {
    expect(sil).toBeDefined();
    expect(sil.affects).toEqual(["music", "sfx"]);
    const riser = t.audio.sfx.find((s) => s.category === "riser" && s.combo === "reveal")!;
    const impact = t.audio.sfx.find((s) => s.category === "impact" && s.combo === "reveal")!;
    expect(riser.from + riser.peakOffsetFrames).toBe(sil.from);
    expect(riser.eventFrame).toBe(sil.from);
    expect(impact.from + impact.peakOffsetFrames).toBe(sil.from + sil.dur);
    const seg = b.layout.segments.find((s) => s.insertions.length > 0)!;
    const a = b.layout.words.find((w) => w.segmentId === seg.segmentId && w.idx === seg.insertions[0]!.afterWordIdx + 1)!;
    expect(sil.from + sil.dur).toBe(a.from);
    for (const w of b.layout.words) expect(w.from < sil.from + sil.dur && w.from + w.dur > sil.from, w.id).toBe(false);
    const ms = msToFrame(b.layout.pauses.preRevealMs, b.layout.fps);
    expect(sil.dur).toBeLessThanOrEqual(ms);
  });

  it("restarts the music on a downbeat at the reveal and hard-stops the previous section at the silence", () => {
    const re = t.audio.music.find((m) => /:r1$/.test(m.id))!;
    expect(re.from).toBe(sil.from + sil.dur);
    expect(re.alignDownbeatAt).toBe(re.from);
    const prev = t.audio.music.filter((m) => m.from < re.from).at(-1)!;
    expect(prev.from + prev.dur).toBe(sil.from);
    expect(prev.endMode).toBe("hardStop");
  });

  it("flashes on the reveal (cut flash or fx flash)", () => {
    const a = sil.from + sil.dur;
    const cutFlash = t.video.find((c) => c.from === a && c.transitionIn.kind === "cover" && c.transitionIn.presentation === "flash");
    const fxFlash = t.fx.find((f) => f.fx === "flash" && f.from === a);
    expect(Boolean(cutFlash) || Boolean(fxFlash)).toBe(true);
  });
});
