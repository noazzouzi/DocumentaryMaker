// Browser-side API client (no node:*). Errors carry the server's {error:{code,message,hint,details}}.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint: string | null = null,
    readonly details: unknown = undefined,
    readonly etag: string | null = null,
  ) {
    super(message);
    this.name = "ApiError";
  }
  get notImplemented(): boolean {
    return this.status === 501;
  }
}

const unquote = (e: string | null): string | null => (e ? e.replace(/^W\//, "").replace(/^"(.*)"$/, "$1") : null);

async function failure(res: Response): Promise<ApiError> {
  let body: { error?: { code?: string; message?: string; hint?: string | null; details?: unknown } } = {};
  try {
    body = (await res.json()) as typeof body;
  } catch {
    /* not JSON */
  }
  const e = body.error ?? {};
  return new ApiError(res.status, e.code ?? `HTTP_${res.status}`, e.message ?? res.statusText ?? "request failed", e.hint ?? null, e.details, unquote(res.headers.get("etag")));
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(path, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), Accept: "application/json", ...(rest.headers as Record<string, string> | undefined) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    cache: "no-store",
  });
  if (!res.ok) throw await failure(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const docUrl = (slug: string, rel: string) => `/api/projects/${encodeURIComponent(slug)}/docs/${rel.split("/").map(encodeURIComponent).join("/")}`;

export async function getDoc<T>(slug: string, rel: string): Promise<{ value: T; etag: string | null } | null> {
  const res = await fetch(docUrl(slug, rel), { cache: "no-store", headers: { Accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res);
  return { value: (await res.json()) as T, etag: unquote(res.headers.get("etag")) };
}

export interface LintIssueLike { level: "error" | "warn"; rule: string; where: string; msg: string }

/** PUT with If-Match (or If-None-Match: * to create). 412 → ApiError{code:"CONFLICT", etag: current}. */
export async function putDoc(slug: string, rel: string, value: unknown, etag: string | null): Promise<{ etag: string; issues: LintIssueLike[] }> {
  const res = await fetch(docUrl(slug, rel), {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json", ...(etag ? { "If-Match": `"${etag}"` } : { "If-None-Match": "*" }) },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as { etag: string; issues: LintIssueLike[] };
}

export const errorText = (e: unknown): string => {
  if (e instanceof ApiError) return e.hint ? `${e.message} — ${e.hint}` : e.message;
  return e instanceof Error ? e.message : String(e);
};

export async function submitJob(slug: string, req: Record<string, unknown>): Promise<{ jobId: string; coalesced: boolean }> {
  return api(`/api/projects/${encodeURIComponent(slug)}/jobs`, { method: "POST", json: req });
}
