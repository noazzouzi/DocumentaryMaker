// Fake @docmaker/export (walking skeleton, §16.5): minimal but well-formed bundle files (XML/OTIO/EDL/SRT/README),
// stems copied, reference.mp4 linked when given. Reads only the Timeline.
import { copyFile, link, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { srtTime, type Timeline } from "@docmaker/core";
import type { ExportApi } from "../../src/deps";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function makeFakeExporter(): ExportApi {
  const srt = (t: Timeline): string => {
    const groups = t.captions.filter((g) => g.variant !== "keywords").map((g) => ({ from: g.from, dur: g.dur, text: g.words.map((w) => w.text).join(" ") }));
    const cues = groups.length ? groups : t.chapters.map((c) => ({ from: c.from, dur: c.dur, text: c.title }));
    return cues.map((g, i) => `${i + 1}\n${srtTime(g.from, t.fps)} --> ${srtTime(g.from + g.dur, t.fps)}\n${g.text}\n`).join("\n");
  };
  const api: ExportApi = {
    async conformForNle() {
      return {};
    },
    toExportTimeline(t) {
      return { name: t.title, fps: t.fps, width: 1920, height: 1080, durationFrames: t.durationInFrames } as unknown as ReturnType<ExportApi["toExportTimeline"]>;
    },
    writeFcpxml: (et) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE fcpxml>\n<fcpxml version="1.10"><resources/><library><event name="${esc(String((et as unknown as { name: string }).name))}"/></library></fcpxml>\n`,
    writeXmeml: () => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4"><sequence><name>skeleton</name></sequence></xmeml>\n`,
    writeOtio: () => JSON.stringify({ OTIO_SCHEMA: "Timeline.1", name: "skeleton", tracks: { OTIO_SCHEMA: "Stack.1", children: [] } }, null, 2),
    writeMarkersEdl: () => "TITLE: skeleton\nFCM: NON-DROP FRAME\n",
    writeSrt: srt,
    writePublishKit: (i) => `# ${i.t.title}\n\n${i.t.chapters.map((c) => `${srtTime(c.from, i.t.fps).slice(3, 8)} ${c.title}`).join("\n")}\n\n${i.credits}\n`,
    writeEditorialReport: (i) => `# Editorial report (${i.lang})\n\n${i.factCheck.items.length} fact-check item(s).\n\nNot legal advice.\n`,
    exportReadme: (i) => `# Export (${i.lang})\n\nFormats: ${i.formats.join(", ")}\n\n${i.hasReference ? "reference.mp4 included" : "no reference render yet"}\n`,
    async writeExportBundle(i) {
      await mkdir(i.exportDir, { recursive: true });
      const base = `${i.t.projectSlug}.${i.t.lang}`;
      const files: [string, string][] = [
        [`${base}.fcpxml`, api.writeFcpxml(api.toExportTimeline(i.t, { exportDir: i.exportDir, exportRoot: i.exportRoot, conformed: i.conformed }), { version: i.fcpxmlVersion })],
        [`${base}.premiere.xml`, api.writeXmeml(null as never, { flavour: "premiere" })],
        [`${base}.otio`, api.writeOtio(null as never, { premiereMetadata: false })],
        [`${base}.markers.edl`, api.writeMarkersEdl(null as never)],
        [`${base}.srt`, api.writeSrt(i.t)],
        ["credits.md", i.credits],
        ["README.md", i.readme],
      ];
      if (i.publishKit) files.push([`publish.${i.t.lang}.md`, i.publishKit]);
      if (i.editorialReport) files.push([`editorial-report.${i.t.lang}.md`, i.editorialReport]);
      for (const [name, text] of files) await writeFile(path.join(i.exportDir, name), text);
      const out = files.map(([n]) => n);
      await mkdir(path.join(i.exportDir, "stems"), { recursive: true });
      for (const s of ["vo", "music", "sfx", "clip"]) {
        const src = path.join(i.projectDir, "audio", i.t.lang, "stems", `${s}.wav`);
        try {
          await copyFile(src, path.join(i.exportDir, "stems", `${s}.wav`));
          out.push(`stems/${s}.wav`);
        } catch { /* no stem */ }
      }
      if (i.referenceMp4) {
        const dest = path.join(i.exportDir, "reference.mp4");
        await link(i.referenceMp4, dest).catch(() => copyFile(i.referenceMp4!, dest));
        out.push("reference.mp4");
      }
      return { dir: i.exportDir, files: out };
    },
  };
  return api;
}
