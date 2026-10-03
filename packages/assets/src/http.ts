// HttpClient (§7.5): offline refusal before any DNS/socket, SSRF guard (every hop), per-host User-Agent, header timeout,
// p-retry (honours Retry-After), TTL response cache, streaming size caps. All network I/O of the product goes through here.
import dns from "node:dns";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import pRetry from "p-retry";
import { DocmakerError, isDocmakerError } from "@docmaker/core";
import type { HttpClient, HttpGetOptions, Logger, RuntimeConfig } from "@docmaker/core";
import { sha256Bytes, userAgentFor } from "@docmaker/core/node";
import { writeFileAtomic } from "./util";

export const MiB = 1024 * 1024;
export const DEFAULT_MAX_BYTES = 256 * MiB; // images, audio, JSON, HTML
export const VIDEO_MAX_BYTES = 2048 * MiB;
export const HEADER_TIMEOUT_MS = 10_000;
const BODY_IDLE_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
/** How often the persisted host cooldowns (other jobs' 429s) are re-read. */
const COOLDOWN_REREAD_MS = 5_000;
/** Hosts allowed over plain http (ccMixter has no https API). */
export const HTTP_ALLOWED_HOSTS: readonly string[] = ["ccmixter.org"];

export type LookupFn = (host: string) => Promise<{ address: string; family: number }[]>;
export interface HttpClientInternals {
  fetchImpl?: typeof fetch; // tests inject a fake transport
  lookup?: LookupFn; // tests inject DNS answers
  retries?: number; // default 3
  retryBaseMs?: number; // default 1000
  maxRetryAfterMs?: number; // default 60 000
  env?: NodeJS.ProcessEnv; // proxy detection
  now?: () => number; // tests drive the host cooldown clock
}

// ------------------------------------------------------------------------------------------------ SSRF guard
const BLOCK_V4: [string, number][] = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
const BLOCK_V6: [string, number][] = [
  ["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8], ["2001:db8::", 32], ["100::", 64],
];
const blockList = new net.BlockList();
for (const [a, p] of BLOCK_V4) blockList.addSubnet(a, p, "ipv4");
for (const [a, p] of BLOCK_V6) blockList.addSubnet(a, p, "ipv6");

/** Expands an IPv6 literal to 8 hextets (numbers); null when malformed. */
function expandV6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0]!;
  let tailV4: number[] = [];
  const m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (m) {
    const parts = m[2]!.split(".").map(Number);
    if (parts.some((x) => !(x >= 0 && x <= 255))) return null;
    tailV4 = [(parts[0]! << 8) | parts[1]!, (parts[2]! << 8) | parts[3]!];
    s = m[1]!.endsWith("::") ? m[1]! : m[1]!.slice(0, -1);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const parse = (h: string) => (h === "" ? [] : h.split(":").map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN)));
  const head = parse(halves[0]!);
  const tail = halves.length === 2 ? parse(halves[1]!) : [];
  const total = head.length + tail.length + tailV4.length;
  if (halves.length === 1 && total !== 8) return null;
  if (total > 8) return null;
  const out = [...head, ...Array(8 - total).fill(0), ...tail, ...tailV4];
  return out.some((x) => Number.isNaN(x)) ? null : out;
}

/** true for loopback, private, link-local, CGNAT, multicast, reserved and documentation ranges (v4 and v6, incl. v4-mapped). */
export function isBlockedAddress(ip: string): boolean {
  const fam = net.isIP(ip.replace(/^\[|\]$/g, "").split("%")[0]!);
  if (fam === 4) return blockList.check(ip, "ipv4");
  if (fam !== 6) return true; // not an IP literal → refuse (callers resolve names first)
  const h = expandV6(ip);
  if (!h) return true;
  // IPv4-mapped (::ffff:a.b.c.d), IPv4-compatible (::a.b.c.d) and NAT64 (64:ff9b::/96) carry a v4 address in the low 32 bits.
  const v4 = `${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`;
  const mapped = h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff;
  const compat = h.slice(0, 6).every((x) => x === 0) && !(h[6] === 0 && h[7]! <= 1);
  const nat64 = h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0);
  if (mapped || compat || nat64) return blockList.check(v4, "ipv4");
  // 6to4 (2002::/16) carries a v4 address in hextets 1–2; Teredo (2001:0::/32) carries the client's v4 bit-inverted in 6–7.
  if (h[0] === 0x2002) return blockList.check(`${h[1]! >> 8}.${h[1]! & 255}.${h[2]! >> 8}.${h[2]! & 255}`, "ipv4");
  if (h[0] === 0x2001 && h[1] === 0) {
    const a = h[6]! ^ 0xffff;
    const b = h[7]! ^ 0xffff;
    return blockList.check(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`, "ipv4");
  }
  const norm = h.map((x) => x.toString(16)).join(":");
  return blockList.check(norm, "ipv6");
}

/** Hosts whose 429 without a wait hint gets a fixed back-off (§7.2: Wikimedia 20 s). */
export const FIXED_429_BACKOFF_MS: readonly [RegExp, number][] = [[/(^|\.)(wikimedia|wikipedia|wikidata)\.org$/, 20_000]];
function fixedBackoffMs(url: string): number | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return FIXED_429_BACKOFF_MS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

function hasProxy(env: NodeJS.ProcessEnv): boolean {
  return ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"].some((k) => (env[k] ?? "") !== "");
}

/** Origin + path only (query strings may carry API keys). */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "<invalid url>";
  }
}

function ssrfError(msg: string, url: string): DocmakerError {
  return new DocmakerError("POLICY_DENIED", `blocked request: ${msg}`, { details: { url: redactUrl(url) } });
}

/** Scheme + host checks, then DNS: every resolved address must be public. Called for the first URL and every redirect. */
export async function guardUrl(url: string, o: { lookup: LookupFn; env: NodeJS.ProcessEnv; logger?: Logger }): Promise<URL> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new DocmakerError("VALIDATION", "invalid URL");
  }
  // "localhost." and "foo.localhost." are the same names as without the root dot.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  if (u.username || u.password) throw ssrfError("credentials in URL", url);
  if (u.protocol === "http:") {
    if (!HTTP_ALLOWED_HOSTS.includes(host)) throw ssrfError("plain http is not allowed", url);
  } else if (u.protocol !== "https:") {
    throw ssrfError(`scheme ${u.protocol} is not allowed`, url);
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw ssrfError("local host name", url);
  }
  if (net.isIP(host) !== 0) {
    if (isBlockedAddress(host)) throw ssrfError("private or reserved address", url);
    return u;
  }
  let addrs: { address: string; family: number }[];
  try {
    addrs = await o.lookup(host);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // Behind an egress proxy the local resolver may not know public names: the proxy resolves them (and the name checks above hold).
    if (hasProxy(o.env) && (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ESERVFAIL")) {
      o.logger?.debug("dns lookup failed; deferring resolution to the proxy", { host });
      return u;
    }
    throw new DocmakerError("PROVIDER_ERROR", `cannot resolve ${host}`, { retryable: code === "EAI_AGAIN", cause: e });
  }
  if (addrs.length === 0) throw new DocmakerError("PROVIDER_ERROR", `cannot resolve ${host}`);
  for (const a of addrs) if (isBlockedAddress(a.address)) throw ssrfError(`${host} resolves to a private or reserved address`, url);
  return u;
}

const defaultLookup: LookupFn = async (host) => dns.promises.lookup(host, { all: true, verbatim: true });

/** Retry-After: delta-seconds or an HTTP date → ms (null when absent). */
export function parseRetryAfter(v: string | null, now = Date.now()): number | null {
  if (!v) return null;
  const s = v.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s) * 1000);
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

// ------------------------------------------------------------------------------------------------ client
interface Req { method: "GET" | "POST"; url: string; body: string | null; contentType: string | null; accept: string }

/** Failures that happen before the request can reach the server (safe to retry even for a non-idempotent POST). */
const CONNECT_ERRORS = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH", "UND_ERR_CONNECT_TIMEOUT"]);
const errCode = (e: unknown): string => {
  const x = e as { code?: unknown; cause?: { code?: unknown } } | null;
  return String(x?.code ?? x?.cause?.code ?? "");
};

export function createHttpClient(o: { config: RuntimeConfig; logger: Logger } & HttpClientInternals): HttpClient {
  const { config, logger } = o;
  const fetchImpl = o.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const lookup = o.lookup ?? defaultLookup;
  const env = o.env ?? process.env;
  const retries = o.retries ?? 3;
  const retryBaseMs = o.retryBaseMs ?? 1000;
  const maxRetryAfterMs = o.maxRetryAfterMs ?? 60_000;
  /** Errors raised before the request left the machine (DNS, SSRF guard, connection refused). */
  const notSent = new WeakSet<Error>();
  const now = o.now ?? (() => Date.now());

  // ---- per-host circuit breaker: a 429 with a wait hint closes the host until then, for every request of every job (the
  // state is persisted next to the response cache). Within the cap we wait; beyond it we fail fast without a request.
  const cooldownFile = path.join(config.paths.httpCache, "host-cooldown.json");
  const cooldown = new Map<string, number>();
  let cooldownReadAt = -Infinity;
  const readCooldowns = async (): Promise<Record<string, number>> => {
    try {
      const j = JSON.parse(await readFile(cooldownFile, "utf8")) as unknown;
      return j && typeof j === "object" ? (j as Record<string, number>) : {};
    } catch {
      return {};
    }
  };
  async function cooldownUntil(host: string): Promise<number> {
    if (now() - cooldownReadAt > COOLDOWN_REREAD_MS) {
      cooldownReadAt = now();
      for (const [h, t] of Object.entries(await readCooldowns())) if (typeof t === "number" && t > (cooldown.get(h) ?? 0)) cooldown.set(h, t);
    }
    return cooldown.get(host) ?? 0;
  }
  async function tripHost(host: string, retryAfterMs: number): Promise<void> {
    const until = now() + retryAfterMs;
    if (until <= (cooldown.get(host) ?? 0)) return;
    cooldown.set(host, until);
    logger.warn("host rate-limited us; pausing requests to it", { host, seconds: Math.round(retryAfterMs / 1000) });
    try {
      const all = await readCooldowns();
      const t = now();
      const next: Record<string, number> = {};
      for (const [h, u] of Object.entries(all)) if (typeof u === "number" && u > t) next[h] = u;
      next[host] = Math.max(next[host] ?? 0, until);
      await writeFileAtomic(cooldownFile, JSON.stringify(next));
    } catch (e) {
      logger.debug("host cooldown write failed", { error: (e as Error).message });
    }
  }
  async function honourCooldown(url: string, signal: AbortSignal): Promise<void> {
    const host = new URL(url).hostname.toLowerCase();
    const rem = (await cooldownUntil(host)) - now();
    if (rem <= 0) return;
    if (rem > maxRetryAfterMs) {
      const err = new DocmakerError("PROVIDER_RATE_LIMIT", `${host} is rate-limiting this machine; no request for ${Math.ceil(rem / 1000)} s`, {
        retryable: false, details: { status: 429, retryAfterMs: rem, hostCooldown: true },
      });
      notSent.add(err);
      throw err;
    }
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, rem);
      signal.addEventListener("abort", () => { clearTimeout(t); reject(new DocmakerError("CANCELED", "request canceled")); }, { once: true });
    });
  }

  const assertOnline = () => {
    if (config.offline) throw new DocmakerError("OFFLINE", "offline mode: network access is disabled", { hint: "unset DOCMAKER_OFFLINE / project.assets.offline to use online providers" });
  };

  /** One attempt: guarded redirect loop; resolves with the final 2xx response (body unread). */
  async function attempt(req: Req, opts: HttpGetOptions): Promise<{ res: Response; finalUrl: string; idle: AbortController }> {
    let url = req.url;
    let method = req.method;
    let body = req.body;
    const origin0 = new URL(req.url).origin;
    let crossed = false; // once a redirect leaves the first origin, caller headers (API keys, tokens) are never sent again
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (opts.signal.aborted) throw new DocmakerError("CANCELED", "request canceled");
      try {
        await guardUrl(url, { lookup, env, logger });
      } catch (e) {
        if (e instanceof Error) notSent.add(e);
        throw e;
      }
      await honourCooldown(url, opts.signal);
      if (new URL(url).origin !== origin0) crossed = true;
      const headers: Record<string, string> = { accept: req.accept, ...(crossed ? {} : opts.headers ?? {}) };
      // The User-Agent is ours, per host (contact only for CONTACT_UA_HOSTS); callers cannot override it.
      for (const k of Object.keys(headers)) if (k.toLowerCase() === "user-agent") delete headers[k];
      headers["user-agent"] = userAgentFor(url, config);
      if (body !== null && req.contentType) headers["content-type"] = req.contentType;
      const headerCtl = new AbortController();
      const idle = new AbortController();
      const timeoutMs = opts.timeoutMs ?? HEADER_TIMEOUT_MS;
      const timer = setTimeout(() => headerCtl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method, headers, body: body ?? undefined, redirect: "manual",
          signal: AbortSignal.any([opts.signal, headerCtl.signal, idle.signal]),
        });
      } catch (e) {
        if (opts.signal.aborted) throw new DocmakerError("CANCELED", "request canceled", { cause: e });
        if (headerCtl.signal.aborted) throw new DocmakerError("PROVIDER_ERROR", `no response headers within ${timeoutMs} ms from ${redactUrl(url)}`, { retryable: true });
        const err = new DocmakerError("PROVIDER_ERROR", `network error for ${redactUrl(url)}: ${(e as Error).message}`, { retryable: true, cause: e });
        if (CONNECT_ERRORS.has(errCode(e))) notSent.add(err);
        throw err;
      } finally {
        clearTimeout(timer);
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get("location");
        await res.body?.cancel().catch(() => undefined);
        if (!loc) throw new DocmakerError("PROVIDER_ERROR", `redirect without location from ${redactUrl(url)}`);
        url = new URL(loc, url).toString();
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST")) {
          method = "GET";
          body = null;
        }
        continue;
      }
      if (res.status < 200 || res.status >= 300) {
        // Retry-After, else (429 only) the RateLimit reset hint some APIs send instead (Wikimedia: x-ratelimit-reset, seconds).
        const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"))
          ?? (res.status === 429 ? parseRetryAfter(res.headers.get("x-ratelimit-reset") ?? res.headers.get("ratelimit-reset")) ?? fixedBackoffMs(url) : null);
        let snippet = "";
        try {
          snippet = (await res.text()).slice(0, 300);
        } catch { /* ignore */ }
        const rate = res.status === 429;
        if (rate && typeof retryAfterMs === "number" && retryAfterMs > 0) await tripHost(new URL(url).hostname.toLowerCase(), retryAfterMs);
        const retryable = rate || res.status >= 500 || res.status === 408;
        throw new DocmakerError(rate ? "PROVIDER_RATE_LIMIT" : "PROVIDER_ERROR", `HTTP ${res.status} from ${redactUrl(url)}`, {
          retryable, details: { status: res.status, retryAfterMs, snippet },
        });
      }
      return { res, finalUrl: url, idle };
    }
    throw new DocmakerError("PROVIDER_ERROR", `too many redirects (> ${MAX_REDIRECTS}) from ${redactUrl(req.url)}`);
  }

  async function readCapped(res: Response, maxBytes: number, idle: AbortController, url: string): Promise<Uint8Array> {
    const len = Number(res.headers.get("content-length") ?? "NaN");
    if (Number.isFinite(len) && len > maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      throw new DocmakerError("PROVIDER_ERROR", `response too large (${len} > ${maxBytes} bytes) from ${redactUrl(url)}`);
    }
    if (!res.body) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    let timer = setTimeout(() => idle.abort(), BODY_IDLE_TIMEOUT_MS);
    try {
      for (;;) {
        const { done, value } = await reader.read();
        clearTimeout(timer);
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new DocmakerError("PROVIDER_ERROR", `response exceeds ${maxBytes} bytes from ${redactUrl(url)}`);
        }
        chunks.push(value);
        timer = setTimeout(() => idle.abort(), BODY_IDLE_TIMEOUT_MS);
      }
    } catch (e) {
      if (isDocmakerError(e)) throw e;
      throw new DocmakerError("PROVIDER_ERROR", `body read failed for ${redactUrl(url)}: ${(e as Error).message}`, { retryable: true, cause: e });
    } finally {
      clearTimeout(timer);
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }

  /** POSTs are not idempotent (a fal submission is billed): they are retried only when the server never saw the request
   *  (connection-level failures) or explicitly refused it (429). A header timeout or a 5xx may already have been processed. */
  const mayRetry = (error: Error, idempotent: boolean) => {
    if (!isDocmakerError(error) || !error.retryable) return false;
    return idempotent || notSent.has(error) || error.code === "PROVIDER_RATE_LIMIT";
  };
  function withRetry<T>(label: string, opts: HttpGetOptions, fn: () => Promise<T>, idempotent = true): Promise<T> {
    return pRetry(fn, {
      retries,
      minTimeout: retryBaseMs,
      factor: 2,
      signal: opts.signal,
      shouldRetry: ({ error }) => (isDocmakerError(error) ? mayRetry(error, idempotent) : !opts.signal.aborted && idempotent),
      onFailedAttempt: async ({ error, retriesLeft }) => {
        if (retriesLeft <= 0 || !isDocmakerError(error) || !mayRetry(error, idempotent)) return;
        logger.debug("http retry", { label, error: error.message, retriesLeft });
        const ra = (error.details as { retryAfterMs?: number | null } | undefined)?.retryAfterMs;
        if (typeof ra === "number" && ra > 0) {
          if (ra > maxRetryAfterMs) throw error; // the provider asks us to wait too long: give up now
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, ra);
            opts.signal.addEventListener("abort", () => { clearTimeout(t); reject(new DocmakerError("CANCELED", "request canceled")); }, { once: true });
          });
        }
      },
    });
  }

  // ---- response cache (<home>/cache/http/<aa>/<key>.json); never stores URLs or headers (they may carry keys)
  const cacheFile = (key: string) => path.join(config.paths.httpCache, key.slice(0, 2), `${key}.json`);
  const cacheKey = (req: Req, opts: HttpGetOptions) => {
    const h = Object.entries(opts.headers ?? {}).map(([k, v]) => `${k.toLowerCase()}:${v}`).sort().join("\n");
    return sha256Bytes(`${req.method} ${req.url}\n${req.accept}\n${h}\n${req.body ?? ""}`);
  };
  async function cacheGet(key: string, ttlSec: number): Promise<string | null> {
    try {
      const j = JSON.parse(await readFile(cacheFile(key), "utf8")) as { storedAt: number; body: string };
      if (typeof j.storedAt === "number" && Date.now() - j.storedAt < ttlSec * 1000 && typeof j.body === "string") return j.body;
    } catch { /* miss */ }
    return null;
  }
  async function cachePut(key: string, body: string): Promise<void> {
    try {
      await writeFileAtomic(cacheFile(key), JSON.stringify({ storedAt: Date.now(), body }));
    } catch (e) {
      logger.debug("http cache write failed", { error: (e as Error).message });
    }
  }

  async function text(req: Req, opts: HttpGetOptions): Promise<string> {
    assertOnline();
    const ttl = opts.cacheTtlSec ?? 0;
    const key = ttl > 0 ? cacheKey(req, opts) : "";
    if (ttl > 0) {
      const hit = await cacheGet(key, ttl);
      if (hit !== null) return hit;
    }
    const body = await withRetry(redactUrl(req.url), opts, async () => {
      const { res, idle, finalUrl } = await attempt(req, opts);
      logger.debug("http", { method: req.method, url: redactUrl(finalUrl), status: res.status });
      const bytes = await readCapped(res, opts.maxBytes ?? DEFAULT_MAX_BYTES, idle, finalUrl);
      return new TextDecoder("utf-8").decode(bytes);
    }, req.method !== "POST");
    if (ttl > 0) await cachePut(key, body);
    return body;
  }

  function parseJson<T>(s: string, url: string): T {
    try {
      return JSON.parse(s) as T;
    } catch (e) {
      throw new DocmakerError("PROVIDER_ERROR", `invalid JSON from ${redactUrl(url)}`, { cause: e });
    }
  }

  return {
    async getJson<T>(url: string, opts: HttpGetOptions): Promise<T> {
      return parseJson<T>(await text({ method: "GET", url, body: null, contentType: null, accept: "application/json" }, opts), url);
    },
    async getText(url: string, opts: HttpGetOptions): Promise<string> {
      return text({ method: "GET", url, body: null, contentType: null, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5" }, opts);
    },
    async postForm<T>(url: string, form: Record<string, string>, opts: HttpGetOptions): Promise<T> {
      const body = new URLSearchParams(form).toString();
      return parseJson<T>(await text({ method: "POST", url, body, contentType: "application/x-www-form-urlencoded", accept: "application/json" }, { ...opts, cacheTtlSec: 0 }), url);
    },
    async postJson<T>(url: string, payload: unknown, opts: HttpGetOptions): Promise<T> {
      return parseJson<T>(await text({ method: "POST", url, body: JSON.stringify(payload), contentType: "application/json", accept: "application/json" }, { ...opts, cacheTtlSec: 0 }), url);
    },
    async download(url: string, destPath: string, opts: HttpGetOptions): Promise<{ bytes: number; mime: string; finalUrl: string }> {
      assertOnline();
      const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
      await mkdir(path.dirname(destPath), { recursive: true });
      const part = `${destPath}.part`;
      return withRetry(redactUrl(url), opts, async () => {
        const { res, finalUrl, idle } = await attempt({ method: "GET", url, body: null, contentType: null, accept: "*/*" }, opts);
        const len = Number(res.headers.get("content-length") ?? "NaN");
        if (Number.isFinite(len) && len > maxBytes) {
          await res.body?.cancel().catch(() => undefined);
          throw new DocmakerError("PROVIDER_ERROR", `file too large (${len} > ${maxBytes} bytes) at ${redactUrl(finalUrl)}`);
        }
        const out = createWriteStream(part);
        let total = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          if (res.body) {
            const reader = res.body.getReader();
            timer = setTimeout(() => idle.abort(), BODY_IDLE_TIMEOUT_MS);
            for (;;) {
              const { done, value } = await reader.read();
              clearTimeout(timer);
              if (done) break;
              total += value.byteLength;
              if (total > maxBytes) {
                await reader.cancel().catch(() => undefined);
                throw new DocmakerError("PROVIDER_ERROR", `download exceeds ${maxBytes} bytes at ${redactUrl(finalUrl)}`);
              }
              if (!out.write(value)) await new Promise<void>((r) => out.once("drain", () => r()));
              timer = setTimeout(() => idle.abort(), BODY_IDLE_TIMEOUT_MS);
            }
          }
          await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
          await rename(part, destPath);
        } catch (e) {
          if (timer) clearTimeout(timer);
          out.destroy();
          await rm(part, { force: true });
          if (isDocmakerError(e)) throw e;
          if (opts.signal.aborted) throw new DocmakerError("CANCELED", "download canceled");
          throw new DocmakerError("PROVIDER_ERROR", `download failed for ${redactUrl(finalUrl)}: ${(e as Error).message}`, { retryable: true, cause: e });
        }
        logger.debug("http download", { url: redactUrl(finalUrl), bytes: total });
        return { bytes: total, mime: (res.headers.get("content-type") ?? "application/octet-stream").split(";")[0]!.trim(), finalUrl };
      });
    },
  };
}
