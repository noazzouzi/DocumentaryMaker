// Request guards (SPEC §14.3 "Guards", §17.2). Pure functions shared by src/proxy.ts and the upload route (which the
// proxy skips so Next does not buffer multi-GB bodies). The web app is a LOCAL single-user tool bound to 127.0.0.1.

export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const LOCAL_HOSTNAMES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);
const FETCH_SITE_OK: ReadonlySet<string> = new Set(["same-origin", "none"]);
/** Upload endpoint (streamed, ≤ 2 GiB): exempt from the 5 MB cap. */
export const UPLOAD_PATH = /^\/api\/projects\/[a-z0-9-]+\/upload\/?$/;

export interface GuardInput {
  method: string;
  pathname: string;
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
  contentLength: string | null;
}
export type GuardResult = { ok: true } | { ok: false; status: 403 | 413; reason: string };
export interface GuardOptions {
  /** When set, the Host port must be one of these (DOCMAKER_WEB_PORT / PORT); otherwise any port on a local hostname. */
  ports?: readonly number[] | null;
  maxBodyBytes?: number;
}

/** Splits "host[:port]" (IPv6 in brackets). Null when malformed. */
export function parseHost(host: string): { hostname: string; port: number | null } | null {
  const h = host.trim().toLowerCase();
  if (!h || /[\s/@\\?#]/.test(h)) return null;
  let hostname: string;
  let portStr: string | null = null;
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    if (end < 0) return null;
    hostname = h.slice(0, end + 1);
    const rest = h.slice(end + 1);
    if (rest) {
      if (!rest.startsWith(":")) return null;
      portStr = rest.slice(1);
    }
  } else {
    const parts = h.split(":");
    if (parts.length > 2) return null;
    hostname = parts[0]!;
    portStr = parts[1] ?? null;
  }
  if (portStr !== null) {
    if (!/^\d{1,5}$/.test(portStr)) return null;
    const port = Number(portStr);
    if (port < 1 || port > 65535) return null;
    return { hostname, port };
  }
  return { hostname, port: null };
}

/** DNS-rebinding protection: only 127.0.0.1 / localhost / [::1] (optionally on the configured port). */
export function isAllowedHost(host: string | null, ports: readonly number[] | null = null): boolean {
  if (!host) return false;
  const p = parseHost(host);
  if (!p || !LOCAL_HOSTNAMES.has(p.hostname)) return false;
  if (ports && ports.length) return p.port !== null && ports.includes(p.port);
  return true;
}

/** Origin must be http(s)://<the same host:port as the Host header>. "null" origins are rejected. */
export function originMatchesHost(origin: string | null, host: string | null): boolean {
  if (!origin || !host || origin === "null") return false;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (u.pathname !== "/" && u.pathname !== "") return false;
  const a = parseHost(u.host);
  const b = parseHost(host);
  if (!a || !b) return false;
  const defPort = u.protocol === "https:" ? 443 : 80;
  return a.hostname === b.hostname && (a.port ?? defPort) === (b.port ?? 80);
}

export const isMutation = (method: string): boolean => !SAFE_METHODS.has(method.toUpperCase());

export function checkRequest(i: GuardInput, o: GuardOptions = {}): GuardResult {
  if (!isAllowedHost(i.host, o.ports ?? null)) return { ok: false, status: 403, reason: "forbidden host" };
  const isApi = i.pathname === "/api" || i.pathname.startsWith("/api/");
  if (isMutation(i.method)) {
    if (!originMatchesHost(i.origin, i.host)) return { ok: false, status: 403, reason: "cross-origin or missing Origin on a mutation" };
  } else if (isApi && i.secFetchSite !== null && !FETCH_SITE_OK.has(i.secFetchSite.toLowerCase())) {
    // documents, media, timelines and history (and every other API read) are same-origin only
    return { ok: false, status: 403, reason: `cross-site read (${i.secFetchSite})` };
  }
  const max = o.maxBodyBytes ?? MAX_BODY_BYTES;
  if (i.contentLength !== null && !UPLOAD_PATH.test(i.pathname)) {
    const n = Number(i.contentLength);
    if (!Number.isFinite(n) || n < 0) return { ok: false, status: 413, reason: "invalid Content-Length" };
    if (n > max) return { ok: false, status: 413, reason: `body larger than ${max} bytes` };
  }
  return { ok: true };
}

/** Ports from the environment (DOCMAKER_WEB_PORT takes a comma list; PORT is what `next start -p` may export). */
export function portsFromEnv(env: Record<string, string | undefined>): number[] | null {
  const raw = env.DOCMAKER_WEB_PORT ?? null;
  if (!raw) return null;
  const ports = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
  return ports.length ? ports : null;
}

export function guardInputOf(req: Request, pathname: string): GuardInput {
  return {
    method: req.method,
    pathname,
    host: req.headers.get("host"),
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    contentLength: req.headers.get("content-length"),
  };
}
