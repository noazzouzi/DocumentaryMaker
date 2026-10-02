import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { run } from "@docmaker/core/node";
import { MODEL_MANIFEST, ensureModel } from "../src/index";
import { downloadResumable, installModel, modelDirFor, type ModelEntry } from "../src/models";
import { makeCtx, tmpDir } from "./helpers";

let server: http.Server;
let base = "";
let archive: Buffer;
let requests: { range: string | undefined }[] = [];
let truncateFirst = true;

beforeAll(async () => {
  const src = tmpDir("model-src-");
  const d = path.join(src, "vits-piper-fr_FR-gilles-low");
  mkdirSync(path.join(d, "espeak-ng-data"), { recursive: true });
  writeFileSync(path.join(d, "fr_FR-gilles-low.onnx"), Buffer.alloc(300_000, 7));
  writeFileSync(path.join(d, "tokens.txt"), "a 1\n");
  const r = await run("tar", ["-cjf", path.join(src, "m.tar.bz2"), "-C", src, "vits-piper-fr_FR-gilles-low"], { signal: new AbortController().signal });
  expect(r.code).toBe(0);
  archive = readFileSync(path.join(src, "m.tar.bz2"));
  server = http.createServer((req, res) => {
    requests.push({ range: req.headers.range });
    const m = /bytes=(\d+)-/.exec(req.headers.range ?? "");
    const from = m ? Number(m[1]) : 0;
    if (m) res.writeHead(206, { "content-length": archive.length - from, "content-range": `bytes ${from}-${archive.length - 1}/${archive.length}` });
    else res.writeHead(200, { "content-length": archive.length });
    const body = archive.subarray(from);
    if (truncateFirst && !m) {
      // a proxy cutting the transfer: half the bytes, then the socket dies
      res.write(body.subarray(0, Math.floor(body.length / 2)), () => setTimeout(() => res.destroy(), 100));
      return;
    }
    res.end(body);
  });
  await new Promise<void>((r2) => server.listen(0, "127.0.0.1", () => r2()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const entry = (sha: string | null): ModelEntry => ({ id: "piper:fr_FR-gilles-low", url: `${base}/vits-piper-fr_FR-gilles-low.tar.bz2`, approxBytes: 0, sha256: sha, extractTo: "piper" });

describe("model downloads", () => {
  it("resumes a truncated download with a Range request, verifies size + sha256, extracts to <models>/piper/<voice>", async () => {
    requests = [];
    truncateFirst = true;
    const models = tmpDir("models-");
    const sha = createHash("sha256").update(archive).digest("hex");
    const progress: number[] = [];
    const dir = await installModel(entry(sha), models, { offline: false }, { signal: new AbortController().signal, onProgress: (b) => progress.push(b) });
    expect(dir).toBe(path.join(models, "piper", "fr_FR-gilles-low"));
    expect(existsSync(path.join(dir, "fr_FR-gilles-low.onnx"))).toBe(true);
    expect(existsSync(path.join(dir, ".complete"))).toBe(true);
    expect(requests.length).toBeGreaterThanOrEqual(2);
    expect(requests[0]!.range).toBeUndefined();
    expect(requests[1]!.range).toMatch(/^bytes=\d+-$/);
    expect(Math.max(...progress)).toBe(archive.length);
    expect(existsSync(path.join(models, ".downloads"))).toBe(true);
    // idempotent: no new request once complete
    const n = requests.length;
    expect(await installModel(entry(sha), models, { offline: false }, { signal: new AbortController().signal })).toBe(dir);
    expect(requests.length).toBe(n);
  });

  it("rejects a checksum mismatch and refuses to download offline", async () => {
    truncateFirst = false;
    const models = tmpDir("models-");
    await expect(installModel(entry("0".repeat(64)), models, { offline: false }, { signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "PROVIDER_ERROR", message: expect.stringContaining("checksum") });
    await expect(downloadResumable(`${base}/x`, path.join(models, "x"), { signal: new AbortController().signal, offline: true }))
      .rejects.toMatchObject({ code: "OFFLINE" });
  });

  it("fails after too many truncated attempts instead of accepting a partial file", async () => {
    truncateFirst = true;
    const models = tmpDir("models-");
    let calls = 0;
    const alwaysCut: typeof fetch = async (url, init) => {
      calls++;
      const res = await fetch(url, { ...init, headers: {} }); // never sends Range → always truncated
      return res;
    };
    await expect(downloadResumable(entry(null).url, path.join(models, "a.tar.bz2"), { signal: new AbortController().signal, offline: false, fetchImpl: alwaysCut, maxAttempts: 3 }))
      .rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(calls).toBe(3);
  });

  it("manifest: Kokoro + curated Piper voices only; ensureModel validates ids and reuses a complete install", async () => {
    expect(MODEL_MANIFEST[0]).toMatchObject({ id: "kokoro", url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2" });
    expect(MODEL_MANIFEST.every((m) => !/ryan|lessac|hfc|semaine|l2arctic/.test(m.id))).toBe(true);
    expect(MODEL_MANIFEST.find((m) => m.id === "piper:fr_FR-siwis-medium")!.url).toBe("https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-fr_FR-siwis-medium.tar.bz2");
    const ctx = makeCtx();
    await expect(ensureModel("nope", ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    const kokoro = MODEL_MANIFEST.find((m) => m.id === "kokoro")!;
    const dir = modelDirFor(kokoro, ctx.config.paths.models);
    await expect(ensureModel("kokoro", ctx)).rejects.toMatchObject({ code: "OFFLINE" });
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, ".complete"), "ok");
    expect(await ensureModel("kokoro", ctx)).toBe(dir);
  });
});
