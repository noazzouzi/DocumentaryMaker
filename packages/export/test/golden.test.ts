// §13.6 golden tests: the brief's 12 s scenario through every writer, compared with test/golden/* (whitespace
// normalised), parity with the validated research prototypes (test/golden/reference/*), and DTD validation.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { describe, expect, it } from "vitest";
import { ExportTimeline, ExportTransition } from "@docmaker/core";
import { makeTimeline } from "@docmaker/core/testing";
import { toExportTimeline, writeFcpxml, writeMarkersEdl, writeOtio, writeSrt, writeXmeml } from "../src/index";
import { GOLDEN_DIR, HAS_XMLLINT, expectGolden, fakeConform, normXml, xmllint } from "./helpers";
import { scenario } from "./scenario";

interface OtioRange { start_time: { value: number }; duration: { value: number } }
interface OtioItem { OTIO_SCHEMA: string; in_offset: { value: number }; out_offset: { value: number }; source_range: OtioRange; media_references?: { DEFAULT_MEDIA: { target_url: string } } }
interface OtioMarker { name: string; marked_range: OtioRange; color: string }

const ref = (name: string) => readFileSync(path.join(GOLDEN_DIR, "reference", name), "utf8");
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", isArray: (n) => ["asset", "keyframe", "asset-clip", "marker", "clipitem", "track", "transitionitem", "parameter", "link"].includes(n) });

describe("golden: 12 s scenario", () => {
  const et = scenario();

  it("FCPXML 1.10", () => expectGolden("demo.fcpxml", writeFcpxml(et, { version: "1.10" }), normXml));
  it("xmeml premiere", () => expectGolden("demo_premiere.xml", writeXmeml(et, { flavour: "premiere" }), normXml));
  it("xmeml resolve", () => expectGolden("demo_resolve.xml", writeXmeml(et, { flavour: "resolve" }), normXml));
  it("OTIO", () => expectGolden("demo.otio", writeOtio(et, { premiereMetadata: true }), (s) => JSON.stringify(JSON.parse(s))));
  it("marker EDL", () => expectGolden("demo_markers_resolve.edl", writeMarkersEdl(et)));
  it("SRT (makeTimeline 12 s)", () => expectGolden("demo.srt", writeSrt(makeTimeline({ seconds: 12 }))));

  it("is deterministic (byte-identical across runs)", () => {
    const a = [writeFcpxml(et, { version: "1.10" }), writeXmeml(et, { flavour: "premiere" }), writeOtio(et, { premiereMetadata: true }), writeMarkersEdl(et)];
    const b = [writeFcpxml(scenario(), { version: "1.10" }), writeXmeml(scenario(), { flavour: "premiere" }), writeOtio(scenario(), { premiereMetadata: true }), writeMarkersEdl(scenario())];
    expect(a).toEqual(b);
  });
});

describe("parity with the validated prototypes", () => {
  const et = scenario();

  it("xmeml premiere contains every element of the prototype, in order", () => {
    // the prototype is a subsequence of our output (we only add the b-roll file timecode and a static opacity value)
    const lines = (s: string) => normXml(s).replace(/></g, ">\n<").split("\n");
    const ours = lines(writeXmeml(et, { flavour: "premiere" }));
    const theirs = lines(ref("demo_premiere.xml"));
    let i = 0;
    const missing: string[] = [];
    for (const l of theirs) {
      const j = ours.indexOf(l, i);
      if (j < 0) missing.push(l);
      else i = j + 1;
    }
    expect(missing).toEqual([]);
  });

  it("FCPXML: same timing, keyframes, lanes, transition and media URLs as the prototype", () => {
    const facts = (xml: string) => {
      const d = parser.parse(xml).fcpxml;
      const assets = new Map<string, string>(d.resources.asset.map((a: { id: string; name: string }) => [a.id, a.name]));
      const spine = d.library.event.project.sequence.spine;
      const photo = spine.video;
      const broll = spine["asset-clip"][0];
      const anchored = [...photo["asset-clip"], ...broll["asset-clip"]].map((c: Record<string, string>) => `${assets.get(c.ref)}@${c.lane}:${c.offset}+${c.duration}`);
      const scaleKf = photo["adjust-transform"].param.keyframeAnimation.keyframe.map((k: Record<string, string>) => `${k.time}=${k.value}`);
      const vol = photo["asset-clip"][1]["adjust-volume"].param.keyframeAnimation.keyframe.slice(0, 3).map((k: Record<string, string>) => `${k.time}=${k.value}`);
      return {
        urls: d.resources.asset.map((a: { "media-rep": { src: string } }) => a["media-rep"].src).sort(),
        photo: `${photo.offset}/${photo.start}/${photo.duration}`, broll: `${broll.offset}/${broll.start}/${broll.duration}`,
        transition: `${spine.transition.offset}/${spine.transition.duration}/${spine.transition.name}`,
        anchored, scaleKf, vol,
      };
    };
    expect(facts(writeFcpxml(et, { version: "1.10" }))).toEqual(facts(ref("demo.fcpxml")));
  });

  it("OTIO: same tracks, ranges, transition and markers as the prototype", () => {
    const facts = (s: string) => {
      const d = JSON.parse(s);
      const tracks = d.tracks.children.map((t: { kind: string; children: OtioItem[] }) => ({
        kind: t.kind,
        items: t.children.map((c) => c.OTIO_SCHEMA === "Transition.1" ? `T${c.in_offset.value}/${c.out_offset.value}` : `${c.OTIO_SCHEMA}:${c.source_range.start_time.value}+${c.source_range.duration.value}${c.media_references ? `@${c.media_references.DEFAULT_MEDIA.target_url}` : ""}`),
      }));
      return { tracks, markers: d.tracks.markers.map((m: OtioMarker) => `${m.name}@${m.marked_range.start_time.value}+${m.marked_range.duration.value}:${m.color}`), start: d.global_start_time.value };
    };
    expect(facts(writeOtio(et, { premiereMetadata: true }))).toEqual(facts(ref("demo.otio")));
  });

  it("marker EDL: header, CRLF, event syntax and colours of the prototype", () => {
    const ours = writeMarkersEdl(et);
    expect(ours.startsWith("TITLE: Demo Markers\r\nFCM: NON-DROP FRAME\r\n\r\n")).toBe(true);
    expect(ours.replace(/\r\n/g, "")).not.toMatch(/\n/);
    const theirs = ref("demo_markers_resolve.edl").split("\r\n").filter((l) => l.startsWith(" |"));
    for (const l of theirs) expect(ours).toContain(l);
    expect(ours).toContain("001  001      V     C        00:00:00:00 00:00:00:01 00:00:00:00 00:00:00:01  \r\n");
  });
});

describe.skipIf(!HAS_XMLLINT)("DTD validation (xmllint)", () => {
  const big = (() => {
    const t = makeTimeline({ seconds: 90 });
    return toExportTimeline(t, { exportDir: "/tmp/export/en", exportRoot: null, conformed: fakeConform(t, "/tmp/export/en", { stems: true }) });
  })();
  for (const [label, et] of [["scenario", scenario()], ["makeTimeline 90 s", big]] as const) {
    it(`${label}: FCPXML 1.10 against the Apple DTD`, () => expect(xmllint(writeFcpxml(et, { version: "1.10" }), "fcpxml-1.10.dtd")).toBe(""));
    it(`${label}: xmeml premiere against the v4 DTD + Premiere ATTLISTs`, () => expect(xmllint(writeXmeml(et, { flavour: "premiere" }), "xmeml_dtd_4_premiere.dtd")).toBe(""));
    it(`${label}: xmeml resolve against the plain v4 DTD`, () => expect(xmllint(writeXmeml(et, { flavour: "resolve" }), "xmeml_dtd_4.dtd")).toBe(""));
  }
  it("the research prototypes still validate (fixture sanity)", () => {
    expect(xmllint(ref("demo.fcpxml"), "fcpxml-1.10.dtd")).toBe("");
    expect(xmllint(ref("demo_premiere.xml"), "xmeml_dtd_4_premiere.dtd")).toBe("");
  });
});

describe("contract", () => {
  it("an ExportTransition with an odd duration is rejected by the schema", () => {
    expect(ExportTransition.safeParse({ cutFrame: 180, duration: 15, kind: "dissolve" }).success).toBe(false);
    expect(ExportTransition.safeParse({ cutFrame: 180, duration: 16, kind: "dissolve" }).success).toBe(true);
    const bad = scenario();
    bad.video[0]!.transitions[0]!.duration = 31;
    expect(ExportTimeline.safeParse(bad).success).toBe(false);
  });

  it("FCPXML versions 1.11 and 1.13 only change the version attribute", () => {
    const et = scenario();
    const a = writeFcpxml(et, { version: "1.10" });
    for (const v of ["1.11", "1.13"] as const) expect(writeFcpxml(et, { version: v })).toBe(a.replace('<fcpxml version="1.10">', `<fcpxml version="${v}">`));
  });
});

// Optional round trip through the Python reference implementation (opentimelineio==0.18.1 + otio-fcp-adapter),
// run only where it is installed (CI job); skipped otherwise.
const HAS_OTIO = (() => {
  try {
    execFileSync("python3", ["-c", "import opentimelineio"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();
describe.skipIf(!HAS_OTIO)("OTIO round trip (python opentimelineio)", () => {
  it("reads the .otio back as 360 frames on 4 tracks with the dissolve centred at frame 180", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "w9-otio-"));
    const f = path.join(dir, "demo.otio");
    writeFileSync(f, writeOtio(scenario(), { premiereMetadata: true }));
    const py = [
      "import sys, opentimelineio as otio",
      "t = otio.adapters.read_from_file(sys.argv[1])",
      "v1 = t.tracks[0]",
      "tr = [c for c in v1 if isinstance(c, otio.schema.Transition)][0]",
      "print(int(t.duration().value), len(t.tracks), int(tr.in_offset.value), int(tr.out_offset.value), int(v1[2].range_in_parent().start_time.value))",
    ].join("\n");
    const out = execFileSync("python3", ["-c", py, f]).toString().trim();
    expect(out).toBe("360 4 15 15 180");
  });
});
