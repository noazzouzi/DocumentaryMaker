import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { checkRequest, isAllowedHost, originMatchesHost, parseHost, portsFromEnv } from "../src/server/guards";
import { proxy } from "../src/proxy";

const base = { method: "GET", pathname: "/api/projects", host: "127.0.0.1:3210", origin: null, secFetchSite: null, contentLength: null };

describe("host allowlist (DNS rebinding)", () => {
  it("accepts loopback names", () => {
    for (const h of ["127.0.0.1:3210", "localhost:3210", "LOCALHOST:3211", "[::1]:3210", "127.0.0.1"]) expect(isAllowedHost(h)).toBe(true);
  });
  it("rejects foreign or malformed hosts", () => {
    for (const h of [null, "", "evil.com:3210", "127.0.0.1.nip.io:3210", "localhost.evil.com", "0.0.0.0:3210", "192.168.1.10:3210", "127.0.0.1:99999", "user@127.0.0.1:3210", "[::1"]) {
      expect(isAllowedHost(h)).toBe(false);
    }
  });
  it("enforces configured ports", () => {
    expect(isAllowedHost("127.0.0.1:3210", [3210])).toBe(true);
    expect(isAllowedHost("127.0.0.1:3215", [3210])).toBe(false);
    expect(isAllowedHost("127.0.0.1", [3210])).toBe(false);
    expect(portsFromEnv({ DOCMAKER_WEB_PORT: "3210, 3211" })).toEqual([3210, 3211]);
    expect(portsFromEnv({})).toBeNull();
  });
  it("parses IPv6 hosts", () => {
    expect(parseHost("[::1]:3210")).toEqual({ hostname: "[::1]", port: 3210 });
    expect(parseHost("a:b:c")).toBeNull();
  });
  it("returns 403 for a foreign Host", () => {
    expect(checkRequest({ ...base, host: "attacker.example:3210" })).toMatchObject({ ok: false, status: 403 });
  });
});

describe("origin check on mutations", () => {
  it("requires a matching Origin", () => {
    const post = { ...base, method: "POST" };
    expect(checkRequest(post)).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...post, origin: "http://evil.com" })).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...post, origin: "http://127.0.0.1:3211" })).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...post, origin: "null" })).toMatchObject({ ok: false, status: 403 });
    expect(checkRequest({ ...post, origin: "http://127.0.0.1:3210" })).toEqual({ ok: true });
    expect(checkRequest({ ...post, method: "DELETE", origin: "http://127.0.0.1:3210" })).toEqual({ ok: true });
  });
  it("compares host and port exactly", () => {
    expect(originMatchesHost("http://localhost:3210", "localhost:3210")).toBe(true);
    expect(originMatchesHost("http://localhost:3210", "127.0.0.1:3210")).toBe(false);
    expect(originMatchesHost("http://localhost", "localhost:80")).toBe(true);
    expect(originMatchesHost("javascript:alert(1)", "localhost:3210")).toBe(false);
  });
});

describe("Sec-Fetch-Site on API reads", () => {
  it("rejects cross-site reads of documents and media", () => {
    for (const p of ["/api/projects/x/docs/outline/outline.json", "/api/projects/x/media/media/a.jpg", "/api/projects/x/timeline/en", "/api/projects/x/history/outline/outline.json"]) {
      expect(checkRequest({ ...base, pathname: p, secFetchSite: "cross-site" })).toMatchObject({ ok: false, status: 403 });
      expect(checkRequest({ ...base, pathname: p, secFetchSite: "same-site" })).toMatchObject({ ok: false, status: 403 });
      expect(checkRequest({ ...base, pathname: p, secFetchSite: "same-origin" })).toEqual({ ok: true });
      expect(checkRequest({ ...base, pathname: p, secFetchSite: "none" })).toEqual({ ok: true });
      expect(checkRequest({ ...base, pathname: p })).toEqual({ ok: true }); // header absent (non-browser)
    }
  });
  it("does not block page navigations", () => {
    expect(checkRequest({ ...base, pathname: "/p/x", secFetchSite: "cross-site" })).toEqual({ ok: true });
  });
});

describe("body cap", () => {
  const post = { ...base, method: "POST", origin: "http://127.0.0.1:3210" };
  it("rejects > 5 MB except uploads", () => {
    expect(checkRequest({ ...post, contentLength: String(5 * 1024 * 1024 + 1) })).toMatchObject({ ok: false, status: 413 });
    expect(checkRequest({ ...post, contentLength: String(5 * 1024 * 1024) })).toEqual({ ok: true });
    expect(checkRequest({ ...post, pathname: "/api/projects/my-film/upload", contentLength: String(1024 ** 3) })).toEqual({ ok: true });
    expect(checkRequest({ ...post, contentLength: "abc" })).toMatchObject({ ok: false, status: 413 });
  });
});

describe("proxy()", () => {
  it("answers 403 to a rebinding attempt and passes local requests", async () => {
    const bad = proxy(new NextRequest("http://evil.example:3210/api/projects", { headers: { host: "evil.example:3210" } }));
    expect(bad.status).toBe(403);
    expect(await bad.json()).toMatchObject({ error: { code: "FORBIDDEN" } });
    const ok = proxy(new NextRequest("http://127.0.0.1:3210/api/projects", { headers: { host: "127.0.0.1:3210" } }));
    expect(ok.headers.get("x-middleware-next")).toBe("1");
    const csrf = proxy(new NextRequest("http://127.0.0.1:3210/api/projects", { method: "POST", headers: { host: "127.0.0.1:3210", origin: "http://evil.example" } }));
    expect(csrf.status).toBe(403);
  });
});

describe("anti-framing headers (clickjacking)", () => {
  it("next.config: X-Frame-Options DENY on every path; CSP frame-ancestors 'none' on pages but never over an API route's own CSP", async () => {
    // non-literal specifier: a static import would pull next's global types (readonly NODE_ENV) into this typecheck
    const configPath = "../next.config";
    type Rule = { source: string; headers: { key: string; value: string }[]; has?: unknown[]; missing?: unknown[] };
    const nextConfig = ((await import(/* @vite-ignore */ configPath)) as { default: { headers?: () => Promise<Rule[]> } }).default;
    const rules = await nextConfig.headers!();
    const valueOf = (r: Rule, k: string) => r.headers.find((x) => x.key.toLowerCase() === k)?.value;
    const all = rules.find((r) => r.source === "/:path*")!;
    expect(valueOf(all, "x-frame-options")).toBe("DENY");
    expect(valueOf(all, "content-security-policy")).toBeUndefined();
    expect(all.has ?? []).toEqual([]);
    expect(all.missing ?? []).toEqual([]);
    const csp = rules.find((r) => valueOf(r, "content-security-policy"))!;
    expect(valueOf(csp, "content-security-policy")).toBe("frame-ancestors 'none'");
    const matches = (p: string) => new RegExp(`^${csp.source}$`).test(p);
    for (const p of ["/", "/settings", "/p/my-film/preview/en", "/apiary"]) expect(matches(p), p).toBe(true);
    for (const p of ["/api", "/api/projects/my-film/media/media/x.svg", "/api/projects/my-film/teleprompter/en"]) expect(matches(p), p).toBe(false);
  });
});
