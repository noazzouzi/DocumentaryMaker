// Read-only CORS + Range static server for renders (port of $SP/rtest/render.mjs, hardened): bound to 127.0.0.1:<random>,
// serves only allowlisted project-relative prefixes plus explicit mounts, ignores the query string (`?v=` cache busters),
// refuses any `..` segment (403) and answers single byte ranges with 206 + Content-Range (what @remotion/media needs).
// `memory` entries are exact paths served from bytes held by the caller (the render's content-addressed timeline
// snapshot: the pages render exactly the bytes the chunk hashes were computed from, whatever happens on disk).
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo, Socket } from "node:net";
import path from "node:path";

export interface AssetServerOptions {
  root: string; allow: readonly RegExp[]; mounts?: Record<string, string>;
  /** Exact request paths (no leading slash) answered from these bytes, before mounts and the allowlist. Immutable. */
  memory?: Record<string, Buffer>;
}
export interface AssetServer { url: string; close(): Promise<void> }

const MIME: Record<string, string> = {
  ".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
  ".wav": "audio/wav", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf", ".cube": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".srt": "text/plain; charset=utf-8", ".vtt": "text/vtt",
};
export const mimeFor = (file: string): string => MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** Parses a single `bytes=` range against a size. null → serve the whole file; "unsatisfiable" → 416. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return null; // multi-range or malformed: RFC 9110 allows ignoring the header
  const [, a, b] = m;
  if (a === "" && b === "") return null;
  let start: number;
  let end: number;
  if (a === "") {
    const suffix = Number(b);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === "" ? size - 1 : Math.min(size - 1, Number(b));
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

type Resolved = { kind: "file"; file: string } | { kind: "memory"; name: string; body: Buffer } | { kind: "error"; status: 400 | 403 | 404 };

/** Maps a request target to a file, applying the `..` refusal, mounts and the allowlist. Exported for tests. */
export function resolveRequestPath(target: string, o: AssetServerOptions): Resolved {
  const rawPath = target.split(/[?#]/, 1)[0] ?? "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return { kind: "error", status: 400 };
  }
  if (decoded.includes("\0")) return { kind: "error", status: 400 };
  const segs = decoded.replace(/\\/g, "/").split("/").filter((s) => s !== "" && s !== ".");
  if (segs.some((s) => s === "..")) return { kind: "error", status: 403 };
  if (segs.length === 0) return { kind: "error", status: 404 };
  const joined = segs.join("/");
  if (o.memory && Object.hasOwn(o.memory, joined)) return { kind: "memory", name: joined, body: o.memory[joined]! };
  const mount = o.mounts && Object.hasOwn(o.mounts, segs[0]!) ? o.mounts[segs[0]!] : undefined;
  let base: string;
  let rel: string;
  if (mount !== undefined) {
    if (segs.length < 2) return { kind: "error", status: 404 };
    base = path.resolve(mount);
    rel = segs.slice(1).join("/");
  } else {
    rel = segs.join("/");
    if (!o.allow.some((re) => re.test(rel))) return { kind: "error", status: 403 };
    base = path.resolve(o.root);
  }
  const file = path.resolve(base, rel);
  if (file !== base && !file.startsWith(base + path.sep)) return { kind: "error", status: 403 };
  return { kind: "file", file };
}

export async function createAssetServer(o: AssetServerOptions): Promise<AssetServer> {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, Content-Type",
  };
  const server = http.createServer((req, res) => {
    void (async () => {
      for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);
      if (req.method === "OPTIONS") return void res.writeHead(204).end();
      if (req.method !== "GET" && req.method !== "HEAD") return void res.writeHead(405, { Allow: "GET, HEAD, OPTIONS" }).end();
      const r = resolveRequestPath(req.url ?? "/", o);
      if (r.kind === "error") return void res.writeHead(r.status).end();
      let size: number;
      if (r.kind === "memory") size = r.body.length;
      else {
        try {
          const st = await stat(r.file);
          if (!st.isFile()) return void res.writeHead(404).end();
          size = st.size;
        } catch {
          return void res.writeHead(404).end();
        }
      }
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Type", mimeFor(r.kind === "memory" ? r.name : r.file));
      res.setHeader("Cache-Control", r.kind === "memory" ? "public, max-age=31536000, immutable" : "no-cache");
      const range = parseRange(req.headers.range, size);
      if (range === "unsatisfiable") return void res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
      const { start, end } = range ?? { start: 0, end: size - 1 };
      const len = size === 0 ? 0 : end - start + 1;
      res.writeHead(range ? 206 : 200, range ? { "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(len) } : { "Content-Length": String(len) });
      if (req.method === "HEAD" || len === 0) return void res.end();
      if (r.kind === "memory") return void res.end(r.body.subarray(start, end + 1));
      const stream = createReadStream(r.file, { start, end });
      stream.on("error", () => res.destroy());
      res.on("close", () => stream.destroy());
      stream.pipe(res);
    })().catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  const sockets = new Set<Socket>();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  let closing: Promise<void> | null = null;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      (closing ??= new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
        for (const s of sockets) s.destroy();
      })),
  };
}
