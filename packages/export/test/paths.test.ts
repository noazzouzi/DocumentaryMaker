// §13.2 paths: spaces, accents, exportRoot remap, file://localhost for xmeml, Windows roots, ASCII-safe names.
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { conformName, fileUrl, safeStem, toExportTimeline, writeFcpxml, writeOtio, writeXmeml, writtenPathFor, xmemlPathUrl } from "../src/index";
import { scenario } from "./scenario";
import { makeTimeline } from "@docmaker/core/testing";
import { fakeConform } from "./helpers";

describe("file URLs", () => {
  it("percent-encodes spaces and accents exactly like pathToFileURL", () => {
    const p = "/Users/me/Docs/Rupture catastrophique é/photo #1?.jpg";
    expect(fileUrl(p)).toBe(pathToFileURL(p).href);
    expect(fileUrl(p)).toBe("file:///Users/me/Docs/Rupture%20catastrophique%20%C3%A9/photo%20%231%3F.jpg");
  });
  it("xmeml uses file://localhost/", () => {
    expect(xmemlPathUrl("/Users/me/a b/é.wav")).toBe("file://localhost/Users/me/a%20b/%C3%A9.wav");
  });
  it("Windows export roots become file:///C:/… URLs", () => {
    expect(fileUrl("C:\\Users\\Me\\Vidéos\\clip 1.mp4")).toBe("file:///C:/Users/Me/Vid%C3%A9os/clip%201.mp4");
    expect(xmemlPathUrl("D:/Edit/x.wav")).toBe("file://localhost/D:/Edit/x.wav");
  });
});

describe("exportRoot remap", () => {
  const dir = "/srv/docmaker/projects/tulips/export/en";
  it("rewrites paths under the export dir onto the editing machine root", () => {
    expect(writtenPathFor(`${dir}/media/001_a_12345678.jpg`, dir, "/Volumes/Edit/Tulipes à vendre")).toBe("/Volumes/Edit/Tulipes à vendre/media/001_a_12345678.jpg");
    expect(writtenPathFor(`${dir}/stems/vo.wav`, dir, "C:\\Edit\\tulips\\")).toBe("C:/Edit/tulips/stems/vo.wav");
    expect(writtenPathFor(`${dir}/media/x.wav`, dir, null)).toBe(`${dir}/media/x.wav`);
  });
  it("keeps paths outside the export dir untouched", () => {
    expect(writtenPathFor("/elsewhere/x.wav", dir, "/Volumes/Edit")).toBe("/elsewhere/x.wav");
  });
  it("flows into every writer (FCPXML/OTIO file:///, xmeml file://localhost/)", () => {
    const t = makeTimeline({ seconds: 20 });
    const et = toExportTimeline(t, { exportDir: dir, exportRoot: "/Users/éditeur/Mon Projet", conformed: fakeConform(t, dir) });
    const enc = "/Users/%C3%A9diteur/Mon%20Projet/media/";
    expect(writeFcpxml(et, { version: "1.10" })).toContain(`src="file://${enc}`);
    expect(writeOtio(et, { premiereMetadata: true })).toContain(`"target_url": "file://${enc}`);
    const xm = writeXmeml(et, { flavour: "premiere" });
    expect(xm).toContain(`<pathurl>file://localhost${enc}`);
    expect(xm).not.toContain("/srv/docmaker");
  });
  it("XML-escapes names (& < > \")", () => {
    const et = scenario();
    et.name = 'Tom & Jerry <"cut">';
    et.markers[0]!.name = "A & B";
    const x = writeFcpxml(et, { version: "1.10" });
    expect(x).toContain('project name="Tom &amp; Jerry &lt;&quot;cut&quot;&gt;"');
    expect(x).toContain('value="A &amp; B"');
    expect(writeXmeml(et, { flavour: "premiere" })).toContain("<name>A &amp; B</name>");
  });
});

describe("conformed names", () => {
  it("are unique, ASCII-safe NNN_<slug>_<id8>.<ext>", () => {
    expect(conformName(7, "La rupture catastrophique — Johnny Depp & Amber", "a1b2c3d4e5f6", "JPG")).toBe("007_la-rupture-catastrophique-johnny-depp-am_a1b2c3d4.jpg");
    expect(conformName(12, "Œuvre ß", "v:B001:0", "wav")).toMatch(/^012_oeuvre-ss_[0-9a-f]{8}\.wav$/);
    expect(safeStem("¡¿")).toBe("media");
    expect(conformName(1, "x", "v:B001:0", "png")).not.toBe(conformName(1, "x", "v:B001:1", "png"));
  });
});
