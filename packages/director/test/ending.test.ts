import { describe, expect, it } from "vitest";
import { FrozenAsset, type Timeline } from "@docmaker/core";
import { direct } from "../src/index";
import { errorsOf, runs } from "./helpers";
import { policyScenario } from "./scenario";

/** Successive uses of one video asset inside a beat never rewind to an earlier part of the media. */
function rewinds(t: Timeline): string[] {
  const out: string[] = [];
  const last = new Map<string, { end: number; id: string }>();
  for (const c of t.video) {
    if (c.source.kind !== "video" || !c.beatId) continue;
    const key = `${c.beatId}|${c.source.assetId}`;
    const p = last.get(key);
    const media = t.assets[c.source.assetId]?.durationFrames ?? Infinity;
    // a tail-limited re-entry (media exhausted) may step back a little, never to an earlier shot's head
    const tailLimited = c.source.sourceInFrames + c.dur + 8 >= media;
    if (p && c.source.sourceInFrames < p.end && !(tailLimited && c.source.sourceInFrames > p.end - c.dur)) out.push(`${c.id} in=${c.source.sourceInFrames} < ${p.end} (after ${p.id})`);
    last.set(key, { end: c.source.sourceInFrames + c.dur, id: c.id });
  }
  return out;
}

describe("programme ending and montage media", () => {
  it("montage and beat shots play a video on instead of replaying its head (also when the media runs short)", () => {
    expect(rewinds(runs().policy.timeline)).toEqual([]);
    const sc = policyScenario();
    const frozen = Object.fromEntries(Object.entries(sc.input.frozen).map(([id, a]) => [id, a.kind === "video" && a.role !== "clip" ? FrozenAsset.parse({ ...a, durationMs: 6000 }) : a]));
    const out = direct({ ...sc.input, frozen });
    expect(errorsOf(out)).toEqual([]);
    expect(rewinds(out.timeline)).toEqual([]);
  });

  it("no riser builds into the last 2 s, and the picture fades to black at the end", () => {
    for (const out of Object.values(runs())) {
      const t = out.timeline;
      const N = t.durationInFrames;
      expect(t.audio.sfx.filter((s) => (s.category === "riser" || s.category === "swell.reverse") && s.combo !== "reveal" && s.eventFrame > N - 2 * t.fps).map((s) => s.id)).toEqual([]);
      const fade = t.fx.find((f) => f.fx === "dark" && f.from + f.dur === N);
      expect(fade).toBeDefined();
      expect(fade!.amt).toBe(1);
      expect(fade!.target).toBe("all");
      expect(fade!.pre).toBeGreaterThanOrEqual(Math.round(0.5 * t.fps));
    }
  });

  it("a safe-messaging end card stays readable: the fade then darkens the picture only", () => {
    const sc = policyScenario({ seconds: 120, chapters: 2 });
    const out = direct({ ...sc.input, riskFlags: ["suicide_self_harm"] });
    const fade = out.timeline.fx.find((f) => f.fx === "dark" && f.from + f.dur === out.timeline.durationInFrames);
    expect(fade?.target).toBe("picture");
  });

  it("a music-build riser on the last beat is not placed", () => {
    const sc = policyScenario({ seconds: 120, chapters: 2 });
    const lastBeat = [...sc.input.plans].filter((p) => /-B\d{3}$/.test(p.id)).pop()!;
    const plans = sc.input.plans.map((p) => (p.id === lastBeat.id ? { ...p, musicCue: "build" as const } : p));
    const out = direct({ ...sc.input, plans });
    const N = out.timeline.durationInFrames;
    expect(out.timeline.audio.sfx.filter((s) => s.category === "riser" && s.eventFrame > N - 2 * out.timeline.fps)).toEqual([]);
  });
});
