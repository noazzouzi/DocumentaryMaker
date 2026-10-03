// Resolve marker EDL (§13.3): CMX3600-style events whose comment lines carry |C:ResolveColor… |M:name |D:frames.
// Import: Media Pool > Timelines > Import > Timeline Markers from EDL. CRLF line endings, NDF timecode from 00:00:00:00.
import type { ExportMarker, ExportTimeline } from "@docmaker/core";
import { RESOLVE_COLOR, cleanText, tcNdf, timebase } from "./util";

/** Every marker of the export timeline at absolute frames: timeline markers + clip markers (nle notes). */
export function allMarkers(et: ExportTimeline): ExportMarker[] {
  const out: ExportMarker[] = [...et.markers];
  for (const t of et.video) for (const c of t.clips) for (const m of c.markers) out.push({ ...m, frame: c.start + m.frame });
  return out.sort((a, b) => a.frame - b.frame || a.name.localeCompare(b.name));
}

export function writeMarkersEdl(et: ExportTimeline): string {
  const tb = timebase(et.fps);
  const CRLF = "\r\n";
  const title = cleanText(`${et.name} Markers`).replace(/\|/g, "/") || "Markers";
  let s = `TITLE: ${title}${CRLF}FCM: NON-DROP FRAME${CRLF}${CRLF}`;
  const width = 3;
  allMarkers(et).forEach((m, i) => {
    const n = String(i + 1).padStart(width, "0");
    const a = tcNdf(et.tcStartFrames + m.frame, tb);
    const b = tcNdf(et.tcStartFrames + m.frame + 1, tb);
    const name = cleanText(m.name).replace(/\|/g, "/") || "Marker";
    s += `${n}  001      V     C        ${a} ${b} ${a} ${b}  ${CRLF}`;
    s += ` |C:${RESOLVE_COLOR[m.color]} |M:${name} |D:${Math.max(1, m.duration)}${CRLF}${CRLF}`;
  });
  return s;
}
