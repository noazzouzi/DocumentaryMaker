import { describe, expect, it } from "vitest";
import type { JobEventInput } from "@docmaker/core";
import { PHASE_WEIGHTS, ProgressTracker } from "../src/progress";

describe("ProgressTracker (§12.4)", () => {
  it("weights sum to 1 and phases are cumulative", () => {
    expect(Object.values(PHASE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    const p = new ProgressTracker(() => undefined, "en");
    expect(p.pctOf("bundle", 1)).toBeCloseTo(0.05);
    expect(p.pctOf("chunks", 0.5)).toBeCloseTo(0.05 + 0.425);
    expect(p.pctOf("concat", 1)).toBeCloseTo(0.93);
    expect(p.pctOf("post", 1)).toBeCloseTo(0.98);
    expect(p.pctOf("mux", 1)).toBeCloseTo(1);
  });

  it("renormalises when post is skipped", () => {
    const p = new ProgressTracker(() => undefined, "en", ["post"]);
    expect(p.pctOf("post", 1)).toBeCloseTo(p.pctOf("concat", 1));
    expect(p.pctOf("chunks", 1)).toBeCloseTo(0.9 / 0.95);
    expect(p.pctOf("mux", 1)).toBeCloseTo(1);
  });

  it("throttles to ≤ 4 Hz, always emits forced/finished updates, never goes backwards", () => {
    const events: JobEventInput[] = [];
    let now = 0;
    const p = new ProgressTracker((e) => events.push(e), "fr", [], 250, () => now);
    p.update("chunks", 0.1, "chunk 1/3");
    now = 100;
    p.update("chunks", 0.2, "chunk 1/3"); // throttled
    now = 300;
    p.update("chunks", 0.3, "chunk 1/3", { renderedFrames: 10 });
    p.update("chunks", 1, "chunk 3/3"); // finished: always emitted
    p.update("bundle", 0.5, "late bundle event", {}, true); // forced but cannot go backwards
    const pcts = events.map((e) => (e as { pct: number }).pct);
    expect(events).toHaveLength(4);
    for (let i = 1; i < pcts.length; i++) expect(pcts[i]!).toBeGreaterThanOrEqual(pcts[i - 1]!);
    const e = events[1] as Extract<JobEventInput, { type: "progress" }>;
    expect(e).toMatchObject({ type: "progress", stage: "render", lang: "fr", message: "chunk 1/3" });
    expect(e.detail).toMatchObject({ phase: "chunks", renderedFrames: 10 });
  });
});
