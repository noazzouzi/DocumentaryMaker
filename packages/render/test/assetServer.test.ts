import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAssetServer, parseRange, resolveRequestPath, type AssetServer } from "../src/assetServer";
import { renderAllowList } from "../src/service";
import { tmpDir } from "./helpers";

let root: { dir: string; cleanup: () => Promise<void> };
let styles: { dir: string; cleanup: () => Promise<void> };
let server: AssetServer;
const bytes = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));

beforeAll(async () => {
  root = await tmpDir();
  styles = await tmpDir();
  await mkdir(path.join(root.dir, "media"), { recursive: true });
  await mkdir(path.join(root.dir, "render/en/draft/snapshot"), { recursive: true });
  await mkdir(path.join(root.dir, "secret"), { recursive: true });
  await writeFile(path.join(root.dir, "media/a.mp4"), bytes);
  await writeFile(path.join(root.dir, "media/name with space.jpg"), "jpg");
  await writeFile(path.join(root.dir, "render/en/draft/snapshot/timeline.json"), '{"ok":true}');
  await writeFile(path.join(root.dir, "secret/key.txt"), "nope");
  await writeFile(path.join(root.dir, "project.json"), "{}");
  await mkdir(path.join(styles.dir, "my-style/fonts"), { recursive: true });
  await writeFile(path.join(styles.dir, "my-style/fonts/a.woff2"), "woff2");
  server = await createAssetServer({ root: root.dir, allow: renderAllowList(), mounts: { styles: styles.dir } });
});
afterAll(async () => {
  await server.close();
  await root.cleanup();
  await styles.cleanup();
});

describe("createAssetServer", () => {
  it("binds 127.0.0.1 on a random port", () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(server.url.endsWith(":0")).toBe(false);
  });

  it("serves allowlisted files with CORS, Accept-Ranges and a content type", async () => {
    const r = await fetch(`${server.url}/media/a.mp4`);
    expect(r.status).toBe(200);
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("content-length")).toBe("1000");
    expect(Buffer.from(await r.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("answers a byte range with 206 and Content-Range", async () => {
    const r = await fetch(`${server.url}/media/a.mp4`, { headers: { Range: "bytes=10-19" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 10-19/1000");
    expect(r.headers.get("content-length")).toBe("10");
    expect(Buffer.from(await r.arrayBuffer()).equals(bytes.subarray(10, 20))).toBe(true);
  });

  it("supports open-ended and suffix ranges, and 416 past the end", async () => {
    const open = await fetch(`${server.url}/media/a.mp4`, { headers: { Range: "bytes=990-" } });
    expect(open.status).toBe(206);
    expect(open.headers.get("content-range")).toBe("bytes 990-999/1000");
    const suffix = await fetch(`${server.url}/media/a.mp4`, { headers: { Range: "bytes=-5" } });
    expect(suffix.headers.get("content-range")).toBe("bytes 995-999/1000");
    expect((await suffix.arrayBuffer()).byteLength).toBe(5);
    const past = await fetch(`${server.url}/media/a.mp4`, { headers: { Range: "bytes=5000-" } });
    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */1000");
  });

  it("ignores the ?v= cache buster and decodes percent-escapes", async () => {
    expect((await fetch(`${server.url}/media/a.mp4?v=0123456789ab`)).status).toBe(200);
    expect((await fetch(`${server.url}/media/name%20with%20space.jpg?v=1`)).status).toBe(200);
  });

  it("refuses ../ traversal with 403 (raw and percent-encoded)", async () => {
    const http = await import("node:http");
    const raw = (p: string) => new Promise<number>((resolve, reject) => {
      const u = new URL(server.url);
      http.get({ host: u.hostname, port: u.port, path: p }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject);
    });
    expect(await raw("/media/../project.json")).toBe(403);
    expect(await raw("/media/%2e%2e/project.json")).toBe(403);
    expect(await raw("/media/..%2f..%2fetc%2fpasswd")).toBe(403);
    expect(await raw("/styles/../secret/key.txt")).toBe(403);
  });

  it("refuses paths outside the allowlist (403) and reports missing files (404)", async () => {
    expect((await fetch(`${server.url}/project.json`)).status).toBe(403);
    expect((await fetch(`${server.url}/secret/key.txt`)).status).toBe(403);
    expect((await fetch(`${server.url}/media/missing.mp4`)).status).toBe(404);
    expect([403, 404]).toContain((await fetch(`${server.url}/media/`)).status); // directories are never listed
  });

  it("serves the render snapshot and mounted style fonts", async () => {
    const t = await fetch(`${server.url}/render/en/draft/snapshot/timeline.json`);
    expect(t.status).toBe(200);
    expect(await t.json()).toEqual({ ok: true });
    const f = await fetch(`${server.url}/styles/my-style/fonts/a.woff2`);
    expect(f.status).toBe(200);
    expect(f.headers.get("content-type")).toBe("font/woff2");
  });

  it("is read-only and answers CORS preflights and HEAD", async () => {
    expect((await fetch(`${server.url}/media/a.mp4`, { method: "PUT", body: "x" })).status).toBe(405);
    expect((await fetch(`${server.url}/media/a.mp4`, { method: "OPTIONS" })).status).toBe(204);
    const head = await fetch(`${server.url}/media/a.mp4`, { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("content-length")).toBe("1000");
  });

  it("close() is idempotent and stops serving", async () => {
    const s = await createAssetServer({ root: root.dir, allow: renderAllowList() });
    await s.close();
    await s.close();
    await expect(fetch(`${s.url}/media/a.mp4`)).rejects.toThrow();
  });
});

describe("parseRange / resolveRequestPath", () => {
  it("parses single ranges and ignores malformed or multi-range headers", () => {
    expect(parseRange(undefined, 100)).toBeNull();
    expect(parseRange("bytes=0-0", 100)).toEqual({ start: 0, end: 0 });
    expect(parseRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
    expect(parseRange("bytes=0-1,5-6", 100)).toBeNull();
    expect(parseRange("items=0-1", 100)).toBeNull();
    expect(parseRange("bytes=-0", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=10-5", 100)).toBe("unsatisfiable");
    expect(parseRange("bytes=0-", 0)).toBe("unsatisfiable");
  });

  it("allows the exact timeline path when it is outside the snapshot dir", () => {
    const o = { root: "/p", allow: renderAllowList("timeline/en.json") };
    expect(resolveRequestPath("/timeline/en.json", o)).toEqual({ kind: "file", file: "/p/timeline/en.json" });
    expect(resolveRequestPath("/timeline/fr.json", o)).toEqual({ kind: "error", status: 403 });
    expect(resolveRequestPath("/media/%E0%A4%A", o)).toEqual({ kind: "error", status: 400 });
    expect(resolveRequestPath("/media\\..\\x", o)).toEqual({ kind: "error", status: 403 });
  });
});
