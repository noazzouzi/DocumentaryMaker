import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fakeConfig, fakeEngine, params, req, tempProjects, writeProjectFile } from "./support/fake-engine";
import { setEngineForTests } from "../src/server/runtime";
import { parseRange } from "../src/server/media";
import * as mediaRoute from "../src/app/api/projects/[slug]/media/[...path]/route";

let dir = "";
const bytes = new Uint8Array(1000).map((_, i) => i % 256);
beforeAll(async () => {
  dir = await tempProjects();
  await writeProjectFile(dir, "my-film", "media/abc.mp4", bytes);
  await writeProjectFile(dir, "my-film", "project.json", "{}");
  await writeProjectFile(dir, "my-film", "jobs/index.json", "{}");
  await writeFile(path.join(dir, "secret.txt"), "outside");
  await mkdir(path.join(dir, "my-film", "render"), { recursive: true });
  await symlink(path.join(dir, "secret.txt"), path.join(dir, "my-film", "render", "escape.mp4"));
});
afterEach(() => setEngineForTests(null));
afterAll(async () => void (await readdir(dir)));

const get = (p: string[], headers: Record<string, string> = {}, method = "GET") => {
  fakeEngine({ config: fakeConfig(dir) });
  return mediaRoute.GET(req(`/api/projects/my-film/media/${p.join("/")}`, { method, headers }), params({ slug: "my-film", path: p }));
};

describe("parseRange", () => {
  it("handles the RFC forms", () => {
    expect(parseRange(null, 100)).toEqual({ kind: "full" });
    expect(parseRange("bytes=0-9", 100)).toEqual({ kind: "partial", start: 0, end: 9 });
    expect(parseRange("bytes=90-", 100)).toEqual({ kind: "partial", start: 90, end: 99 });
    expect(parseRange("bytes=-10", 100)).toEqual({ kind: "partial", start: 90, end: 99 });
    expect(parseRange("bytes=-500", 100)).toEqual({ kind: "partial", start: 0, end: 99 });
    expect(parseRange("bytes=50-5000", 100)).toEqual({ kind: "partial", start: 50, end: 99 });
    expect(parseRange("bytes=100-", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=-0", 100)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=0-1,5-6", 100)).toEqual({ kind: "full" });
    expect(parseRange("bytes=9-1", 100)).toEqual({ kind: "full" });
    expect(parseRange("items=0-1", 100)).toEqual({ kind: "full" });
    expect(parseRange("bytes=0-0", 0)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("media route", () => {
  it("serves the whole file with Accept-Ranges", async () => {
    const r = await get(["media", "abc.mp4"]);
    expect(r.status).toBe(200);
    expect(r.headers.get("accept-ranges")).toBe("bytes");
    expect(r.headers.get("content-type")).toBe("video/mp4");
    expect(r.headers.get("content-length")).toBe("1000");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes);
  });

  it("answers a Range request with 206 and the exact bytes", async () => {
    const r = await get(["media", "abc.mp4"], { range: "bytes=100-199" });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 100-199/1000");
    expect(r.headers.get("content-length")).toBe("100");
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(bytes.slice(100, 200));
    const tail = await get(["media", "abc.mp4"], { range: "bytes=-24" });
    expect(tail.status).toBe(206);
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.slice(976));
  });

  it("416 for an unsatisfiable range", async () => {
    const r = await get(["media", "abc.mp4"], { range: "bytes=5000-" });
    expect(r.status).toBe(416);
    expect(r.headers.get("content-range")).toBe("bytes */1000");
  });

  it("304 on a matching ETag; HEAD has no body", async () => {
    const r = await get(["media", "abc.mp4"]);
    const etag = r.headers.get("etag")!;
    expect((await get(["media", "abc.mp4"], { "if-none-match": etag })).status).toBe(304);
    const h = await mediaRoute.HEAD(req("/x", { method: "HEAD" }), params({ slug: "my-film", path: ["media", "abc.mp4"] }));
    expect(h.status).toBe(200);
    expect(h.body).toBeNull();
  });

  it("refuses traversal, non-allowlisted roots and symlink escapes with 403", async () => {
    for (const p of [["..", "secret.txt"], ["media", "..", "project.json"], ["project.json"], ["jobs", "index.json"], ["media", "a\\..\\b"], ["media", ""]]) {
      expect((await get(p)).status, p.join("/")).toBe(403);
    }
    expect((await get(["render", "escape.mp4"])).status).toBe(403);
  });

  it("404 when the file is missing", async () => {
    expect((await get(["media", "nope.jpg"])).status).toBe(404);
  });
});
