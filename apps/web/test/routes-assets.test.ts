import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { FrozenAsset, UploadDeclaration } from "@docmaker/core";
import { fakeConfig, fakeEngine, params, req, tempProjects } from "./support/fake-engine";
import { setEngineForTests } from "../src/server/runtime";
import * as freezeRoute from "../src/app/api/projects/[slug]/assets/freeze/route";
import * as uploadRoute from "../src/app/api/projects/[slug]/upload/route";
import * as searchRoute from "../src/app/api/projects/[slug]/assets/search/route";

let dir = "";
beforeAll(async () => {
  dir = await tempProjects();
  await mkdir(path.join(dir, "my-film"), { recursive: true });
});
afterEach(() => setEngineForTests(null));
afterAll(async () => void (await readdir(dir)));

const slug = params({ slug: "my-film" });

describe("freeze", () => {
  it("forwards only the candidate reference; client licence fields are ignored", async () => {
    const calls: unknown[] = [];
    fakeEngine({
      async freeze(_s, i) {
        calls.push(i);
        return { asset: { id: "a".repeat(64) } as FrozenAsset, issues: [] };
      },
    });
    const body = {
      beatId: "CH2-B004", slot: 1, provider: "wikimedia", providerAssetId: "File:Tulip.jpg",
      license: { code: "CC0", commercialOk: true }, author: "me", attributionText: "nobody", candidate: { license: { code: "CC0" } }, declaration: { kind: "own-work" },
    };
    const r = await freezeRoute.POST(req("/x", { method: "POST", body: JSON.stringify(body) }), slug);
    expect(r.status).toBe(200);
    expect(calls).toEqual([{ beatId: "CH2-B004", slot: 1, provider: "wikimedia", providerAssetId: "File:Tulip.jpg" }]);
  });

  it("validates the reference", async () => {
    fakeEngine({});
    for (const b of [{ beatId: "x", slot: 0, provider: "wikimedia", providerAssetId: "a" }, { beatId: "CH1-B001", slot: -1, provider: "wikimedia", providerAssetId: "a" }, { beatId: "CH1-B001", slot: 0, provider: "evil", providerAssetId: "a" }]) {
      expect((await freezeRoute.POST(req("/x", { method: "POST", body: JSON.stringify(b) }), slug)).status).toBe(400);
    }
  });
});

describe("live search", () => {
  it("parses providers/kind/allowPaid", async () => {
    const calls: unknown[] = [];
    fakeEngine({ async liveSearch(_s, i) { calls.push(i); return []; } });
    const r = await searchRoute.GET(req("/x?beat=CH1-B002&q=tulip%20bulb&kind=video&providers=openverse,wikimedia,openverse&allowPaid=1"), slug);
    expect(r.status).toBe(200);
    expect(calls).toEqual([{ beatId: "CH1-B002", query: { text: "tulip bulb", kind: "video" }, providers: ["openverse", "wikimedia"], allowPaid: true }]);
    expect((await searchRoute.GET(req("/x?beat=CH1-B002&q=x&providers=bogus"), slug)).status).toBe(400);
  });
});

function multipart(parts: { name: string; filename?: string; type?: string; data: string | Uint8Array }[], boundary = "----docmakerTestBoundary7MA4YWxk"): { body: Uint8Array<ArrayBuffer>; type: string } {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const p of parts) {
    chunks.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename ? `; filename="${p.filename}"` : ""}\r\n${p.type ? `Content-Type: ${p.type}\r\n` : ""}\r\n`));
    chunks.push(typeof p.data === "string" ? enc.encode(p.data) : p.data);
    chunks.push(enc.encode("\r\n"));
  }
  chunks.push(enc.encode(`--${boundary}--\r\n`));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    body.set(c, o);
    o += c.length;
  }
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

const declaration: UploadDeclaration = { kind: "licensed", license: "CC-BY", author: "Jan", url: "https://example.org/a", note: "" };

describe("upload", () => {
  const png = new Uint8Array(4096).map((_, i) => (i * 7) % 256);

  it("400 without a declaration for an asset, and the staged file is removed", async () => {
    const calls: unknown[] = [];
    fakeEngine({ config: fakeConfig(dir), async getProject() { return {} as never; }, async upload(_s, i) { calls.push(i); return { rel: "x", asset: null }; } });
    const m = multipart([{ name: "file", filename: "photo.png", type: "image/png", data: png }]);
    const r = await uploadRoute.POST(req("/api/projects/my-film/upload?kind=asset", { method: "POST", headers: { "content-type": m.type }, body: m.body }), slug);
    expect(r.status).toBe(400);
    expect((await r.json()).error.code).toBe("DECLARATION_REQUIRED");
    expect(calls).toHaveLength(0);
    expect(await readdir(path.join(dir, "my-film", "uploads"))).toEqual([]);
  });

  it("streams the file to uploads/ and passes the declaration; the staged copy is cleaned after import", async () => {
    let seen: { tmpPath: string; bytes: Uint8Array; declaration: unknown; kind: string } | null = null;
    fakeEngine({
      config: fakeConfig(dir),
      async getProject() { return {} as never; },
      async upload(_s, i) {
        seen = { tmpPath: i.tmpPath, bytes: new Uint8Array(await readFile(i.tmpPath)), declaration: i.declaration, kind: i.kind };
        return { rel: "media/abc.png", asset: null };
      },
    });
    const m = multipart([{ name: "declaration", data: JSON.stringify(declaration) }, { name: "file", filename: "../../evil name.PNG", type: "image/png", data: png }]);
    const r = await uploadRoute.POST(req("/api/projects/my-film/upload?kind=asset", { method: "POST", headers: { "content-type": m.type }, body: m.body }), slug);
    expect(r.status).toBe(201);
    expect(seen!.bytes).toEqual(png);
    expect(seen!.declaration).toEqual(declaration);
    expect(path.dirname(seen!.tmpPath)).toBe(path.join(dir, "my-film", "uploads"));
    expect(path.basename(seen!.tmpPath)).toMatch(/^[a-z0-9]+-[a-f0-9]{8}-evil_name\.png$/);
    expect(existsSync(seen!.tmpPath)).toBe(false);
  });

  it("rejects an invalid declaration, a foreign Origin and unknown kinds", async () => {
    fakeEngine({ config: fakeConfig(dir), async getProject() { return {} as never; } });
    const m = multipart([{ name: "declaration", data: JSON.stringify({ kind: "licensed", license: null, author: "", url: "", note: "" }) }, { name: "file", filename: "a.png", data: png }]);
    expect((await uploadRoute.POST(req("/api/projects/my-film/upload?kind=asset", { method: "POST", headers: { "content-type": m.type }, body: m.body }), slug)).status).toBe(400);
    const csrf = await uploadRoute.POST(req("/api/projects/my-film/upload?kind=asset", { method: "POST", headers: { "content-type": m.type, origin: "http://evil.example" }, body: m.body }), slug);
    expect(csrf.status).toBe(403);
    expect((await uploadRoute.POST(req("/api/projects/my-film/upload?kind=video", { method: "POST", headers: { "content-type": m.type }, body: m.body }), slug)).status).toBe(400);
    const exe = multipart([{ name: "declaration", data: JSON.stringify(declaration) }, { name: "file", filename: "a.exe", data: png }]);
    expect((await uploadRoute.POST(req("/api/projects/my-film/upload?kind=asset", { method: "POST", headers: { "content-type": exe.type }, body: exe.body }), slug)).status).toBe(415);
  });

  it("recordings need a language and need no declaration", async () => {
    const calls: { kind: string; lang: string | null; segmentId: string | null; declaration: unknown }[] = [];
    fakeEngine({ config: fakeConfig(dir), async getProject() { return {} as never; }, async upload(_s, i) { calls.push(i); return { rel: "voice/en/recordings/CH1-S01.wav", asset: null }; } });
    const m = multipart([{ name: "file", filename: "take.wav", data: png }]);
    expect((await uploadRoute.POST(req("/api/projects/my-film/upload?kind=recording", { method: "POST", headers: { "content-type": m.type }, body: m.body }), slug)).status).toBe(400);
    const ok = await uploadRoute.POST(req("/api/projects/my-film/upload?kind=recording&lang=en&segmentId=CH1-S01", { method: "POST", headers: { "content-type": m.type }, body: m.body }), slug);
    expect(ok.status).toBe(201);
    expect(calls[0]).toMatchObject({ kind: "recording", lang: "en", segmentId: "CH1-S01", declaration: null });
  });
});
