// Media paths written into NLE documents (§13.2): exportRoot remap + percent-encoded file URLs.
//   writtenPath = exportRoot ? posixJoin(exportRoot, relative(exportDir, localPath)) : localPath
//   FCPXML/OTIO: pathToFileURL(writtenPath).href (é → %C3%A9); xmeml: the same URL with file:// → file://localhost
import path from "node:path";
import { pathToFileURL } from "node:url";

const WIN_DRIVE = /^[A-Za-z]:[\\/]/;
const toPosix = (p: string) => p.replace(/\\/g, "/");

/** The path of a conformed file as the editing machine will see it. */
export function writtenPathFor(localPath: string, exportDir: string, exportRoot: string | null): string {
  if (!exportRoot) return localPath;
  const rel = toPosix(path.relative(exportDir, localPath));
  if (rel.startsWith("../") || rel === "..") {
    // outside the export dir (should not happen after conform): keep the local path, a relink will be needed
    return localPath;
  }
  const root = toPosix(exportRoot).replace(/\/+$/, "");
  return root === "" ? `/${rel}` : `${root}/${rel}`;
}

/** Absolute file:/// URL, percent-encoded (spaces, accents, '#', '?', '%'). Windows drive paths are supported. */
export function fileUrl(writtenPath: string): string {
  const p = toPosix(writtenPath);
  if (WIN_DRIVE.test(writtenPath)) {
    const esc = p.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F");
    return new URL(`file:///${esc}`).href;
  }
  if (p.startsWith("//")) return new URL(`file:${p.replace(/%/g, "%25").replace(/#/g, "%23").replace(/\?/g, "%3F")}`).href; // UNC
  return pathToFileURL(path.posix.isAbsolute(p) ? p : path.posix.join("/", p)).href;
}

/** Premiere-style pathurl: file://localhost/… */
export function xmemlPathUrl(writtenPath: string): string {
  return fileUrl(writtenPath).replace(/^file:\/\/\//, "file://localhost/");
}

/** ASCII-safe file stem: accents folded, lowercase, [a-z0-9-], ≤ 40 chars, never empty. */
export function safeStem(s: string, fallback = "media"): string {
  const ascii = s
    .replace(/œ/g, "oe").replace(/Œ/g, "OE").replace(/æ/g, "ae").replace(/Æ/g, "AE").replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  return ascii || fallback;
}

/** 8 ASCII chars identifying an id (hex ids keep their prefix; others are hashed). */
export function id8(id: string): string {
  if (/^[0-9a-f]{8,}$/i.test(id)) return id.slice(0, 8).toLowerCase(); // content-hash asset ids keep their prefix
  // FNV-1a 32-bit → 8 hex chars (stable, no crypto needed)
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Unique conformed file name "NNN_<slug>_<id8>.<ext>". */
export function conformName(index: number, label: string, id: string, ext: string): string {
  return `${String(index).padStart(3, "0")}_${safeStem(label)}_${id8(id)}.${ext.toLowerCase()}`;
}
