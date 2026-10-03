import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger } from "@docmaker/core/node";
import { createHttpClient, guardUrl, isBlockedAddress, parseRetryAfter, redactUrl } from "../src/index";
import { fakeFetch, makeConfig, publicLookup, quietLogger, tmpDir } from "./helpers";

afterEach(() => vi.restoreAllMocks());

describe("offline HttpClient", () => {
  it("throws OFFLINE before any DNS lookup, socket or fetch", async () => {
    const config = makeConfig({ offline: true });
    const spies = [
      vi.spyOn(dns.promises, "lookup"), vi.spyOn(dns, "lookup"), vi.spyOn(net, "connect"), vi.spyOn(net, "createConnection"),
      vi.spyOn(net.Socket.prototype, "connect"), vi.spyOn(tls, "connect"), vi.spyOn(globalThis, "fetch"),
    ];
    const http = createHttpClient({ config, logger: quietLogger() });
    const signal = new AbortController().signal;
    const dest = path.join(tmpDir(), "x.bin");
    for (const call of [
      () => http.getJson("https://api.openverse.org/v1/images/?q=x", { signal }),
      () => http.getText("https://example.org/", { signal }),
      () => http.postJson("https://queue.fal.run/x", {}, { signal }),
      () => http.postForm("https://api.openverse.org/v1/auth_tokens/token/", { a: "b" }, { signal }),
      () => http.download("https://upload.wikimedia.org/x.jpg", dest, { signal }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "OFFLINE" });
    }
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe("SSRF guard", () => {
  it("classifies addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.9", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "::ffff:192.168.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8", "172.32.0.1", "100.128.0.1"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("rejects private DNS answers, schemes, local names and credentials", async () => {
    const env = {};
    const priv = async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.5", family: 4 }];
    await expect(guardUrl("https://evil.example.com/x", { lookup: priv, env })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(guardUrl("http://example.com/x", { lookup: publicLookup, env })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(guardUrl("file:///etc/passwd", { lookup: publicLookup, env })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(guardUrl("https://localhost/x", { lookup: publicLookup, env })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(guardUrl("https://[::1]/x", { lookup: publicLookup, env })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(guardUrl("https://169.254.169.254/latest", { lookup: publicLookup, env })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(guardUrl("https://user:pw@example.com/", { lookup: publicLookup, env })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    await expect(guardUrl("https://example.com/x", { lookup: publicLookup, env })).resolves.toBeInstanceOf(URL);
    await expect(guardUrl("http://ccmixter.org/api/query", { lookup: publicLookup, env })).resolves.toBeInstanceOf(URL);
  });

  it("re-checks every redirect hop", async () => {
    const config = makeConfig({ offline: false });
    const lookup = async (host: string) => [{ address: host === "internal.example.com" ? "192.168.0.10" : "93.184.216.34", family: 4 }];
    const f = fakeFetch((url) => (url.includes("start") ? new Response(null, { status: 302, headers: { location: "https://internal.example.com/secret" } }) : new Response("{}")));
    const http = createHttpClient({ config, logger: quietLogger(), fetchImpl: f.impl, lookup, retries: 0 });
    await expect(http.getJson("https://cdn.example.com/start", { signal: new AbortController().signal })).rejects.toMatchObject({ code: "POLICY_DENIED" });
    expect(f.calls.map((c) => c.url)).toEqual(["https://cdn.example.com/start"]);
  });

  it("follows public redirects (≤ 5)", async () => {
    const config = makeConfig({ offline: false });
    let n = 0;
    const f = fakeFetch(() => (n++ < 6 ? new Response(null, { status: 301, headers: { location: `/r${n}` } }) : new Response('{"ok":true}')));
    const http = createHttpClient({ config, logger: quietLogger(), fetchImpl: f.impl, lookup: publicLookup, retries: 0 });
    await expect(http.getJson("https://a.example.com/r0", { signal: new AbortController().signal })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    n = 2;
    await expect(http.getJson("https://a.example.com/r0", { signal: new AbortController().signal })).resolves.toEqual({ ok: true });
  });
});

describe("User-Agent", () => {
  it("sends the contact only to allowlisted hosts and nothing from the OS or git", async () => {
    const config = makeConfig({ offline: false, contact: "https://example.org/contact" });
    const f = fakeFetch(() => new Response("{}"));
    const http = createHttpClient({ config, logger: quietLogger(), fetchImpl: f.impl, lookup: publicLookup });
    const signal = new AbortController().signal;
    await http.getJson("https://commons.wikimedia.org/w/api.php?x=1", { signal, headers: { "User-Agent": "spoofed" } });
    await http.getJson("https://api.pexels.com/v1/search?query=x", { signal });
    expect(f.calls[0]!.headers["user-agent"]).toBe(`${config.userAgentBase}; contact: https://example.org/contact`);
    expect(f.calls[1]!.headers["user-agent"]).toBe(config.userAgentBase);
    expect(f.calls[1]!.headers["user-agent"]).not.toContain("contact");
    const os = await import("node:os");
    for (const c of f.calls) {
      expect(c.headers["user-agent"]).toMatch(/^DocumentaryMaker\/\S+/);
      expect(c.headers["user-agent"]).not.toContain(os.hostname());
      if (os.userInfo().username.length >= 4) expect(c.headers["user-agent"]).not.toContain(os.userInfo().username);
    }
  });
});

describe("retries, caps, cache, timeouts", () => {
  it("retries 5xx/429 honouring Retry-After, not 4xx", async () => {
    const config = makeConfig({ offline: false });
    let n = 0;
    const f = fakeFetch(() => (++n < 3 ? new Response("busy", { status: n === 1 ? 503 : 429, headers: { "retry-after": "0" } }) : new Response('{"v":1}')));
    const http = createHttpClient({ config, logger: quietLogger(), fetchImpl: f.impl, lookup: publicLookup, retryBaseMs: 1 });
    await expect(http.getJson("https://x.example.com/a", { signal: new AbortController().signal })).resolves.toEqual({ v: 1 });
    expect(n).toBe(3);
    let m = 0;
    const g = fakeFetch(() => { m++; return new Response("nope", { status: 404 }); });
    const http2 = createHttpClient({ config, logger: quietLogger(), fetchImpl: g.impl, lookup: publicLookup, retryBaseMs: 1 });
    await expect(http2.getJson("https://x.example.com/b", { signal: new AbortController().signal })).rejects.toMatchObject({ code: "PROVIDER_ERROR", details: { status: 404 } });
    expect(m).toBe(1);
  });

  it("gives up when Retry-After exceeds the cap", async () => {
    const config = makeConfig({ offline: false });
    let n = 0;
    const f = fakeFetch(() => { n++; return new Response("", { status: 429, headers: { "retry-after": "3600" } }); });
    const http = createHttpClient({ config, logger: quietLogger(), fetchImpl: f.impl, lookup: publicLookup, retryBaseMs: 1 });
    await expect(http.getJson("https://x.example.com/c", { signal: new AbortController().signal })).rejects.toMatchObject({ code: "PROVIDER_RATE_LIMIT" });
    expect(n).toBe(1);
  });

  it("enforces size caps (content-length and streamed)", async () => {
    const config = makeConfig({ offline: false });
    const big = new Uint8Array(4096);
    const f = fakeFetch((url) => new Response(big, { headers: url.includes("len") ? { "content-length": "4096" } : {} }));
    const http = createHttpClient({ config, logger: quietLogger(), fetchImpl: f.impl, lookup: publicLookup, retries: 0 });
    const signal = new AbortController().signal;
    await expect(http.getText("https://x.example.com/len", { signal, maxBytes: 1000 })).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    await expect(http.getText("https://x.example.com/stream", { signal, maxBytes: 1000 })).rejects.toThrow(/exceeds/);
    const dest = path.join(tmpDir(), "f.bin");
    await expect(http.download("https://x.example.com/stream", dest, { signal, maxBytes: 1000 })).rejects.toThrow(/exceeds/);
    const ok = await http.download("https://x.example.com/stream", dest, { signal, maxBytes: 10_000 });
    expect(ok.bytes).toBe(4096);
    expect((await readFile(dest)).byteLength).toBe(4096);
  });

  it("caches responses for cacheTtlSec without storing the URL", async () => {
    const config = makeConfig({ offline: false });
    let n = 0;
    const f = fakeFetch(() => new Response(JSON.stringify({ n: ++n })));
    const http = createHttpClient({ config, logger: quietLogger(), fetchImpl: f.impl, lookup: publicLookup });
    const signal = new AbortController().signal;
    const url = "https://pixabay.com/api/?key=SECRETKEY123&q=tulip";
    expect(await http.getJson(url, { signal, cacheTtlSec: 86_400 })).toEqual({ n: 1 });
    expect(await http.getJson(url, { signal, cacheTtlSec: 86_400 })).toEqual({ n: 1 });
    expect(await http.getJson(url, { signal })).toEqual({ n: 2 });
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = config.paths.httpCache;
    const files = readdirSync(dir, { recursive: true }).map(String).filter((x) => x.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const fl of files) expect(readFileSync(path.join(dir, fl), "utf8")).not.toContain("SECRETKEY123");
  });

  it("times out waiting for headers", async () => {
    const config = makeConfig({ offline: false });
    const impl = ((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(new Error("aborted"))))) as unknown as typeof fetch;
    const http = createHttpClient({ config, logger: createLogger({ level: "error", sink: () => undefined }), fetchImpl: impl, lookup: publicLookup, retries: 0 });
    await expect(http.getJson("https://slow.example.com/", { signal: new AbortController().signal, timeoutMs: 50 })).rejects.toThrow(/no response headers within 50 ms/);
  });

  it("parses Retry-After and redacts query strings", () => {
    expect(parseRetryAfter("20")).toBe(20_000);
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(redactUrl("https://pixabay.com/api/?key=abc&q=x")).toBe("https://pixabay.com/api/");
  });
});
