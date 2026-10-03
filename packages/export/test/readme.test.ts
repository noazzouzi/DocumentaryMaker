// Bundle README (§13.5): import steps, sizing checkbox, marker EDL, exportRoot, non-portable list, FR section.
import { describe, expect, it } from "vitest";
import { makeTimeline } from "@docmaker/core/testing";
import { bundleFileNames, exportReadme, nonPortableSummary } from "../src/index";

describe("exportReadme", () => {
  const t = makeTimeline({ seconds: 60 });
  const all = ["fcpxml", "xmeml-premiere", "otio", "markers-edl", "srt", "stems", "publish-kit", "editorial-report", "reference-mp4"] as const;
  const md = exportReadme({ t, formats: [...all], exportRoot: null, asOf: "2026-09-30", hasReference: false, lang: "en" });

  it("explains Resolve, Premiere and FCP imports with the exact file names", () => {
    const f = bundleFileNames(t);
    expect(md).toContain("Use sizing information");
    expect(md).toContain("Timeline Markers from EDL");
    expect(md).toContain(f.fcpxml);
    expect(md).toContain(f.premiere);
    expect(md).toContain(f.otio);
    expect(md).toContain("Final Cut Pro");
    expect(md).toContain("cannot decode H.264/AAC");
  });
  it("states that there is no reference render yet, the asOf date, the Remotion licence and the AI checklist", () => {
    expect(md).toContain("no reference render yet");
    expect(md).toContain("2026-09-30");
    expect(md).toContain("Remotion licence");
    expect(md).toMatch(/AI \/ synthetic disclosure checklist/);
    expect(exportReadme({ t, formats: [...all], exportRoot: null, asOf: "2026-09-30", hasReference: true, lang: "en" })).toContain("reference.mp4");
  });
  it("lists the non-portable effects found in the timeline", () => {
    const np = nonPortableSummary(t);
    expect(np.some((x) => /cover transition flash/.test(x.label))).toBe(true);
    for (const x of np) expect(md).toContain(`${x.label}: ${x.count}`);
  });
  it("mentions the export root when set and has a French section", () => {
    const fr = exportReadme({ t, formats: ["fcpxml"], exportRoot: "D:\\Montage\\Tulipes", asOf: "2026-09-30", hasReference: false, lang: "fr" });
    expect(fr).toContain("D:\\Montage\\Tulipes");
    expect(fr).toContain("## Français");
    expect(fr).not.toContain(".premiere.xml");
  });
});
