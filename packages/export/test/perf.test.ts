// A 30-minute program exports in a few seconds (keyframe sampling and gain curves stay linear-time).
import { describe, expect, it } from "vitest";
import { makeTimeline } from "@docmaker/core/testing";
import { toExportTimeline, writeFcpxml, writeMarkersEdl, writeOtio, writeSrt, writeXmeml } from "../src/index";
import { fakeConform } from "./helpers";

describe("scale", () => {
  it("30 min timeline → every writer in < 15 s", () => {
    const t = makeTimeline({ seconds: 1800 });
    const t0 = performance.now();
    const et = toExportTimeline(t, { exportDir: "/x/export/en", exportRoot: null, conformed: fakeConform(t, "/x/export/en", { stems: true }) });
    const sizes = [writeFcpxml(et, { version: "1.10" }), writeXmeml(et, { flavour: "premiere" }), writeXmeml(et, { flavour: "resolve" }), writeOtio(et, { premiereMetadata: true }), writeMarkersEdl(et), writeSrt(t)].map((s) => s.length);
    const t2 = performance.now();
    expect(et.video[0]!.clips.length).toBe(t.video.length);
    expect(t2 - t0).toBeLessThan(15_000);
    for (const s of sizes) expect(s).toBeGreaterThan(0);
  }, 60_000);
});
