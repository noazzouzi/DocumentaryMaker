// Static media for the Player and downloads (SPEC §14.3): allowlisted top-level dirs, traversal + symlink-escape guard,
// single byte-range requests (206/416), weak ETag revalidation. `?v=` cache busters are ignored.
import "server-only";
import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { HttpError } from "./http";
import { safeRel } from "./docs";

export const MEDIA_ROOTS: ReadonlySet<string> = new Set(["media", "program", "voice", "render", "export", "qa"]);

const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska", ts: "video/mp2t",
  wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg",
  json: "application/json; charset=utf-8", srt: "application/x-subrip; charset=utf-8", txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8", xml: "application/xml; charset=utf-8", fcpxml: "application/xml; charset=utf-8",
  otio: "application/json; charset=utf-8", edl: "text/plain; charset=utf-8", cube: "text/plain; charset=utf-8",
  html: "text/plain; charset=utf-8", // never served as active HTML from project folders
  zip: "application/zip",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
};
export const mimeOf = (file: string): string => MIME[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";

export type RangeResult = { kind: "full" } | { kind: "partial"; start: number; end: number } | { kind: "unsatisfiable" };

/** RFC 9110 single byte range. Malformed or multi-range headers are ignored (full response), per the RFC's MAY. */
export function parseRange(header: string | null, size: number): RangeResult {
  if (!header) return { kind: "full" };
  const m = /^\s*bytes\s*=\s*(.+)$/i.exec(header);
  if (!m) return { kind: "full" };
  const spec = m[1]!.trim();
  if (spec.includes(",")) return { kind: "full" };
  const r = /^(\d*)\s*-\s*(\d*)$/.exec(spec);
  if (!r) return { kind: "full" };
  const [, a, b] = r;
  if (a === "" && b === "") return { kind: "full" };
  if (a === "") {
    const n = Number(b);
    if (n === 0 || size === 0) return { kind: "unsatisfiable" };
    return { kind: "partial", start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(a);
  const end = b === "" ? size - 1 : Number(b);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { kind: "full" };
  if (b !== "" && end < start) return { kind: "full" }; // syntactically invalid → ignore the header
  if (start >= size) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end: Math.min(end, size - 1) };
}

export const STYLE_FONT_EXT: ReadonlySet<string> = new Set(["woff2", "woff", "ttf", "otf"]);

/**
 * Resolves an allowlisted media path inside the project dir; 403 on traversal/symlink escape, 404 when missing.
 * `styles/<dir>/fonts/<file>` (what styleFontAssets() puts in timeline.render.fonts, mounted by the render asset server)
 * maps to <home>/styles (`stylesDir`) instead, font files only, so the Player preview loads a user style's own fonts.
 */
export async function resolveMediaPath(projectDir: string, segments: readonly string[], stylesDir?: string): Promise<{ abs: string; rel: string; size: number; mtimeMs: number }> {
  const rel = safeRel(segments);
  const top = rel.split("/")[0]!;
  if (top === "styles") {
    const parts = rel.split("/");
    const ext = path.extname(rel).slice(1).toLowerCase();
    if (!stylesDir || parts.length < 4 || parts[2] !== "fonts" || !STYLE_FONT_EXT.has(ext)) throw new HttpError(403, "FORBIDDEN", "path not allowed");
    return resolveInside(stylesDir, parts.slice(1).join("/"), rel);
  }
  if (!MEDIA_ROOTS.has(top)) throw new HttpError(403, "FORBIDDEN", "path not allowed");
  return resolveInside(projectDir, rel, rel);
}

/** `relInRoot` inside `rootDir` (lexically and after realpath); 403 on escape, 404 when missing or not a file. */
async function resolveInside(rootDir: string, relInRoot: string, rel: string): Promise<{ abs: string; rel: string; size: number; mtimeMs: number }> {
  const root = path.resolve(rootDir);
  const abs = path.resolve(root, relInRoot);
  if (!abs.startsWith(root + path.sep)) throw new HttpError(403, "FORBIDDEN", "path not allowed");
  let real: string;
  let realRoot: string;
  try {
    realRoot = await realpath(root);
    real = await realpath(abs);
  } catch {
    throw new HttpError(404, "UPSTREAM_MISSING", "not found");
  }
  if (!real.startsWith(realRoot + path.sep)) throw new HttpError(403, "FORBIDDEN", "path not allowed");
  const st = await stat(real).catch(() => null);
  if (!st || !st.isFile()) throw new HttpError(404, "UPSTREAM_MISSING", "not found");
  return { abs: real, rel, size: st.size, mtimeMs: st.mtimeMs };
}

export const weakEtag = (size: number, mtimeMs: number): string => `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;

/** Builds the (possibly partial) file response. */
export function fileResponse(
  req: Request,
  f: { abs: string; rel: string; size: number; mtimeMs: number },
  o: { download?: boolean } = {},
): Response {
  const etag = weakEtag(f.size, f.mtimeMs);
  const base: Record<string, string> = {
    "Content-Type": mimeOf(f.abs),
    "Accept-Ranges": "bytes",
    ETag: etag,
    "Last-Modified": new Date(f.mtimeMs).toUTCString(),
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    // opened directly (as a document), a served file is sandboxed: an SVG with script cannot act on the app origin
    "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
    "X-Frame-Options": "DENY",
    "Content-Disposition": `${o.download ? "attachment" : "inline"}; filename="${path.basename(f.abs).replace(/[^\w.-]/g, "_")}"`,
  };
  const inm = req.headers.get("if-none-match");
  if (inm && inm.split(",").some((t) => t.trim() === etag || t.trim() === "*")) {
    return new Response(null, { status: 304, headers: base });
  }
  // If-Range with a different validator → ignore Range (send the whole file)
  const ifRange = req.headers.get("if-range");
  const rangeHeader = ifRange && ifRange.trim() !== etag ? null : req.headers.get("range");
  const range = parseRange(rangeHeader, f.size);
  const head = req.method === "HEAD";
  if (range.kind === "unsatisfiable") {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${f.size}` } });
  }
  if (range.kind === "partial") {
    const len = range.end - range.start + 1;
    const body = head ? null : (Readable.toWeb(createReadStream(f.abs, { start: range.start, end: range.end })) as ReadableStream<Uint8Array>);
    return new Response(body, {
      status: 206,
      headers: { ...base, "Content-Length": String(len), "Content-Range": `bytes ${range.start}-${range.end}/${f.size}` },
    });
  }
  const body = head || f.size === 0 ? null : (Readable.toWeb(createReadStream(f.abs)) as ReadableStream<Uint8Array>);
  return new Response(body, { status: 200, headers: { ...base, "Content-Length": String(f.size) } });
}
