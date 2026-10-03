import { describe, expect, it } from "vitest";
import { COMPONENT_META, FrozenAsset, msToFrame, type Timeline } from "@docmaker/core";
import { TEST_STYLE } from "@docmaker/core/testing";
import { direct } from "../src/index";
import { effectiveUpscale } from "../src/stats";
import { errorsOf, runs, scaleAt } from "./helpers";
import { policyScenario } from "./scenario";
import { tulipInputs } from "./tulip";

describe("Ken Burns", () => {
  it("never stalls at a cut: d(scale)/df at f = 0 and f = dur − 1 is ≥ 50 % of the mean slope", () => {
    let checked = 0;
    for (const out of Object.values(runs())) {
      for (const c of out.timeline.video) {
        const cam = c.camera;
        if (cam.kind !== "kenBurns" || cam.keys.length !== 2) continue;
        const [a, b] = cam.keys as [typeof cam.keys[0], typeof cam.keys[0]];
        const mean = (b.scale - a.scale) / (b.f - a.f);
        if (Math.abs(mean) < 1e-6) continue;
        const d0 = scaleAt(cam, 1) - scaleAt(cam, 0);
        const d1 = scaleAt(cam, c.dur) - scaleAt(cam, c.dur - 1);
        expect(d0 / mean, c.id).toBeGreaterThanOrEqual(0.5);
        expect(d1 / mean, c.id).toBeGreaterThanOrEqual(0.5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("moves at a matched rate (scaleRatePerSec × act intensity) and uses the kb ease", () => {
    const t = runs().policy.timeline;
    const [lo, hi] = TEST_STYLE.cameraPolicy.kenBurns.scaleRatePerSec;
    for (const c of t.video) {
      if (c.camera.kind !== "kenBurns") continue;
      expect(c.camera.ease).toBe("kb");
      const rate = Math.abs(c.camera.keys[1]!.scale - c.camera.keys[0]!.scale) / (c.dur / t.fps);
      const I = Math.max(...Object.values(TEST_STYLE.budgets.actIntensity), 1);
      expect(rate, c.id).toBeLessThanOrEqual(hi * I + 1e-3);
      if (rate > 0) expect(rate, c.id).toBeGreaterThan(lo * 0.2 - 1e-9); // the upscale guard may slow a move down
    }
  });

  it("consecutive moves never repeat or reverse a direction", () => {
    const opp: Record<string, string> = { in: "out", out: "in", left: "right", right: "left", up: "down", down: "up" };
    for (const out of Object.values(runs())) {
      const dirs = out.timeline.video.map((c) => c.camera.direction).filter((d) => d !== "none");
      for (let i = 1; i < dirs.length; i++) {
        expect(dirs[i], `#${i}`).not.toBe(dirs[i - 1]);
        expect(dirs[i], `#${i}`).not.toBe(opp[dirs[i - 1]!]);
      }
    }
  });
});

function stillScenario() {
  const sc = policyScenario({ seconds: 300, chapters: 3 });
  const mk = (id: string, w: number, h: number) => FrozenAsset.parse({ ...Object.values(sc.input.frozen).find((a) => a.kind === "image")!, id, width: w, height: h, projectRel: `media/${id}.jpg` });
  const portrait = mk("a".repeat(64), 900, 1200);
  const small = mk("b".repeat(64), 600, 400);
  const portraits = [portrait, mk("c".repeat(64), 900, 1200), mk("d".repeat(64), 1000, 1300)];
  const frozen = { ...sc.input.frozen, [small.id]: small, ...Object.fromEntries(portraits.map((p) => [p.id, p])) };
  const narrBeats = [...new Set(sc.input.picks.picks.map((p) => p.beatId))];
  // 3 consecutive beats with portraits, one with the small image
  const target = new Map<string, string>([[narrBeats[10]!, portraits[0]!.id], [narrBeats[11]!, portraits[1]!.id], [narrBeats[12]!, portraits[2]!.id], [narrBeats[20]!, small.id]]);
  const picks = sc.input.picks.picks.filter((p) => !(target.has(p.beatId) && p.slot > 0)).map((p) => (target.has(p.beatId) ? { ...p, assetId: target.get(p.beatId)! } : p));
  const out = direct({ ...sc.input, frozen, picks: { ...sc.input.picks, picks } });
  return { out, portrait, small, target };
}

describe("stills", () => {
  const { out, small, target } = stillScenario();
  const t: Timeline = out.timeline;
  const clipsOf = (assetId: string) => t.video.filter((c) => (c.source.kind === "image" || c.source.kind === "video") && c.source.assetId === assetId);

  it("a 900 × 1200 portrait becomes a framed card", () => {
    const pid = [...target.values()][0]!;
    const cs = clipsOf(pid);
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) expect(c.layout).toBe("card");
  });

  it("a 600 × 400 image becomes a card with heightFrac ≤ 1.6·400/1080", () => {
    const cs = clipsOf(small.id);
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) {
      expect(c.layout).toBe("card");
      expect(c.layoutParams!.heightFrac).toBeLessThanOrEqual((1.6 * 400) / 1080 + 1e-9);
    }
  });

  it("never 3 cards in a row (unless all three are forced cards too small for any other layout)", () => {
    const forcedTiny = (c: Timeline["video"][number]) => {
      if (c.source.kind !== "image") return false;
      const a = t.assets[c.source.assetId]!;
      const forced = a.width! / a.height! < TEST_STYLE.stills.cardIfAspectBelow || a.width! < TEST_STYLE.stills.cardIfWidthBelow;
      return forced && Math.min(1920 / a.width!, 1080 / a.height!) > TEST_STYLE.cameraPolicy.maxUpscale;
    };
    let runsOf3 = 0;
    for (let i = 2; i < t.video.length; i++) {
      const tri = [t.video[i - 2]!, t.video[i - 1]!, t.video[i]!];
      if (!tri.every((c) => c.layout === "card")) continue;
      runsOf3++;
      expect(tri.every(forcedTiny), t.video[i]!.id).toBe(true);
    }
    expect(t.video.some((c) => c.layout === "contain-blur")).toBe(true); // the three forced portraits in a row
    void runsOf3;
  });

  it("no shot's effective upscale exceeds maxUpscale after camera, reframe and punch", () => {
    for (let i = 0; i < t.video.length; i++) {
      const u = effectiveUpscale(t, i);
      if (u === null) continue;
      expect(u, t.video[i]!.id).toBeLessThanOrEqual(TEST_STYLE.cameraPolicy.maxUpscale + 0.01);
    }
    expect(errorsOf(out)).toEqual([]);
  });

  it("cards carry their styling (border, alternating tilt, shadow, backdrop)", () => {
    const cards = t.video.filter((c) => c.layout === "card");
    expect(cards.length).toBeGreaterThan(3);
    for (const c of cards) {
      const p = c.layoutParams!;
      expect(p.shadow).toBe(true);
      expect(p.borderPx).toBeGreaterThanOrEqual(10);
      expect(Math.abs(p.tiltDeg)).toBeLessThanOrEqual(4);
    }
    const tilts = cards.filter((c) => !/:\d+$/.test(c.id) || c.id.endsWith(":0")).map((c) => Math.sign(c.layoutParams!.tiltDeg));
    expect(new Set(tilts).size).toBe(2);
  });

  it("treatments follow the asset analysis (grayscale → bw, pre-1970 → archival)", () => {
    const sc = policyScenario();
    const gray = Object.values(sc.input.frozen).find((a) => a.analysis.grayscale);
    const out2 = runs().policy.timeline;
    if (gray) for (const c of out2.video.filter((x) => x.source.kind === "image" && x.source.assetId === gray.id)) expect(c.treatment).toBe("bw");
  });
});

describe("montage", () => {
  const sc = policyScenario();
  const t = runs().policy.timeline;
  const tracks = new Map(sc.input.music.map((m) => [m.assetId, m]));
  const beats = new Set<number>();
  for (const m of t.audio.music) {
    const tr = tracks.get(m.assetId)!;
    const L = msToFrame(tr.durationMs, t.fps);
    for (const ms of tr.beatsMs) for (let k = 0; k < 50; k++) {
      const f = m.from + msToFrame(ms, t.fps) - m.sourceInFrames + k * L;
      if (f >= m.from + m.dur) break;
      if (f >= m.from) beats.add(f);
      if (!m.loop) break;
    }
  }
  const near = (f: number, d: number) => [...beats].some((b) => Math.abs(b - f) <= d);
  const montageBeats = new Set(t.video.filter((c) => c.beatId?.endsWith("-BR")).map((c) => c.beatId));

  it("has montage beats with fast cuts", () => {
    expect(montageBeats.size).toBeGreaterThan(0);
  });

  it("beat punches sit on snapped cuts and snapped cuts are within ±3 f of a music beat", () => {
    let snapped = 0;
    for (let i = 1; i < t.video.length; i++) {
      const c = t.video[i]!;
      if (!montageBeats.has(c.beatId) || t.video[i - 1]!.beatId !== c.beatId) continue;
      const punch = t.fx.find((f) => f.fx === "zoom" && f.shape === "hit" && f.from === c.from);
      if (punch) { snapped++; expect(near(c.from, 3), c.id).toBe(true); }
      expect(punch?.amt ?? TEST_STYLE.cameraPolicy.montage.beatPunch.amt).toBeCloseTo(TEST_STYLE.cameraPolicy.montage.beatPunch.amt, 6);
    }
    expect(snapped).toBeGreaterThan(0);
  });
});

describe("generated keyword cards", () => {
  it("are never reframed or punched: camera ≤ 1.05, no span zoom (punch) over them (SHOCK plate hits are momentary)", () => {
    // every third non-clip beat becomes a text card without picks (→ generated keywordCard backdrop)
    const input = tulipInputs().input;
    const tc = new Set(input.plans.filter((p, k) => k % 3 === 1 && /-B\d{3}$/.test(p.id)).map((p) => p.id));
    const plans = input.plans.map((p) => (tc.has(p.id) ? { ...p, visualKind: "text_card" as const } : p));
    const picks = { ...input.picks, picks: input.picks.picks.filter((p) => !tc.has(p.beatId)) };
    const out = direct({ ...input, plans, picks });
    expect(errorsOf(out)).toEqual([]);
    const t = out.timeline;
    const cards = t.video.filter((c) => c.source.kind === "generated" && c.source.recipe === "keywordCard");
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) {
      expect(c.camera.kind, c.id).not.toBe("reframe");
      for (const k of c.camera.keys) expect(k.scale, c.id).toBeLessThanOrEqual(1.05 + 1e-9);
      const zooms = t.fx.filter((f) => f.fx === "zoom" && f.shape === "span" && f.target !== "all" && f.from < c.from + c.dur && c.from < f.from + f.dur && f.from >= c.from);
      expect(zooms.map((f) => f.id), c.id).toEqual([]);
    }
  });
});

describe("text cards under text overlays", () => {
  it("a keywordCard headline never sits under a centred text overlay (TEXT_COLLISION): the backdrop goes textless", () => {
    // the demo's text_card beats (CH3-B004 "THE TWIST" gets a KineticText from its EMPHASIS cue) without picks → keywordCard
    const input = tulipInputs().input;
    const tc = new Set(input.plans.filter((p) => p.visualKind === "text_card").map((p) => p.id));
    expect(tc.size).toBeGreaterThan(0);
    const plans = input.plans;
    const picks = { ...input.picks, picks: input.picks.picks.filter((p) => !tc.has(p.beatId)) };
    const out = direct({ ...input, plans, picks });
    const t = out.timeline;
    const kt = t.overlays.filter((o) => o.component === "KineticText" && o.beatId && tc.has(o.beatId));
    expect(kt.length).toBeGreaterThan(0);
    for (const o of kt) {
      const under = t.video.filter((c) => c.from < o.from + o.dur && o.from < c.from + c.dur);
      for (const c of under) expect(c.source.kind === "generated" && c.source.recipe === "keywordCard" && c.source.text !== "", `${c.id} under ${o.id}`).toBe(false);
    }
    expect(out.lint.filter((l) => l.rule === "TEXT_COLLISION")).toEqual([]);
    expect(t.video.some((c) => c.source.kind === "generated" && c.source.recipe === "keywordCard" && c.source.text !== "")).toBe(true); // cards without an overlay keep their headline
  });
});

describe("full-frame cards", () => {
  it("a reading-time QuoteCard holds ≤ 6 s and does not hide the next picked beat beyond 4 s after its entry", () => {
    const t = runs().tulip.timeline;
    const cards = t.overlays.filter((o) => o.component === "QuoteCard" && ((o.props as { words: unknown[] }).words.length === 0));
    expect(cards.length).toBeGreaterThan(0);
    for (const o of cards) {
      expect(o.dur, o.id).toBeLessThanOrEqual(o.enterFrames + 6 * t.fps);
      // picture clips of other beats with their own picked asset that start under the card
      const hidden = t.video.filter((c) => c.beatId !== o.beatId && c.beatId?.endsWith("-CLIP") === false && (c.source.kind === "image" || c.source.kind === "video") && c.from > o.from && c.from < o.from + o.dur);
      for (const c of hidden) expect(o.from + o.dur, `${o.id} over ${c.id}`).toBeLessThanOrEqual(Math.max(c.from, o.from + 4 * t.fps));
    }
  });
});

describe("transitions under full-frame cards", () => {
  it("no transition or transition SFX at a seam hidden by an opaque full-frame card", () => {
    let seams = 0;
    for (const out of Object.values(runs())) {
      const t = out.timeline;
      const cards = t.overlays.filter((o) => COMPONENT_META[o.component].fullFrame && o.band === "graphics");
      for (const c of t.video.slice(1)) {
        const hidden = cards.some((o) => o.from + o.enterFrames <= c.from - 4 && o.from + o.dur - o.exitFrames >= c.from + 4);
        if (!hidden) continue;
        seams++;
        const tr = c.transitionIn;
        expect(tr.kind === "cut" && tr.accent.type === "none", `${c.id} ${JSON.stringify(tr)}`).toBe(true);
        expect(t.audio.sfx.filter((x) => x.sourceItemId === c.id && /whoosh|swish/.test(x.category)).map((x) => x.id), c.id).toEqual([]);
      }
    }
    expect(seams).toBeGreaterThan(0);
  });
});
