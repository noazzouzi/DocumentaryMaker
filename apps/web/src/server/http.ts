// Route-handler helpers: JSON responses, error mapping (DocmakerError → HTTP), capped body reading, param validation.
import "server-only";
import { isDocmakerError, Lang, Slug, type ErrorCode } from "@docmaker/core";

export const JSON_LIMIT_BYTES = 5 * 1024 * 1024; // §14.3: bodies > 5 MB rejected (except uploads)

/** An error that already knows its HTTP status. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface ErrorBody {
  error: { code: string; message: string; hint: string | null; retryable: boolean; notImplemented: boolean; details?: unknown };
}

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  VALIDATION: 400, LANG_PARITY: 400, CONFIG_MISSING_KEY: 400, ANCHOR_MISSING: 400, TIMELINE_LINT: 400,
  POLICY_DENIED: 403, UPSTREAM_MISSING: 404, FIXTURE_MISSING: 404, CONFLICT: 409, LOCKED: 409, GATE_REQUIRED: 409,
  BUDGET_EXCEEDED: 402, MIGRATION_FAILED: 500, OFFLINE: 503, TOOL_MISSING: 424, MODEL_MISSING: 424,
  PROVIDER_RATE_LIMIT: 429, YT_RATE_LIMIT: 429, PROVIDER_ERROR: 502, LLM_API: 502, LLM_REFUSAL: 502, LLM_SCHEMA: 502,
  YT_BOT_CHECK: 502, YT_FORBIDDEN: 502, YT_UNAVAILABLE: 502, CANCELED: 409, INTERRUPTED: 409,
};

export const isNotImplemented = (e: unknown): boolean =>
  e instanceof Error && /not implemented/i.test(e.message) && (!isDocmakerError(e) || e.code === "INTERNAL");

export function errorBody(e: unknown): { status: number; body: ErrorBody; headers?: Record<string, string> } {
  if (e instanceof HttpError) {
    return {
      status: e.status,
      body: { error: { code: e.code, message: e.message, hint: null, retryable: false, notImplemented: false, ...(e.details === undefined ? {} : { details: e.details }) } },
      headers: e.headers,
    };
  }
  if (isNotImplemented(e)) {
    const message = (e as Error).message;
    return { status: 501, body: { error: { code: "NOT_IMPLEMENTED", message, hint: "this part of the engine has not landed yet", retryable: true, notImplemented: true } } };
  }
  if (isDocmakerError(e)) {
    const details = isPlainData(e.details) ? e.details : undefined;
    return {
      status: STATUS_BY_CODE[e.code] ?? 500,
      body: { error: { code: e.code, message: e.message, hint: e.hint, retryable: e.retryable, notImplemented: false, ...(details === undefined ? {} : { details }) } },
    };
  }
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "ENOENT") return { status: 404, body: { error: { code: "UPSTREAM_MISSING", message: "not found", hint: null, retryable: false, notImplemented: false } } };
  console.error("[docmaker-web] unhandled route error", e);
  return { status: 500, body: { error: { code: "INTERNAL", message: e instanceof Error ? e.message : String(e), hint: null, retryable: false, notImplemented: false } } };
}

function isPlainData(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  try {
    return JSON.stringify(v).length < 64_000;
  } catch {
    return false;
  }
}

export function json(data: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...init.headers },
  });
}

export const noContent = (): Response => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

export function errorResponse(e: unknown): Response {
  const { status, body, headers } = errorBody(e);
  return json(body, { status, headers });
}

/** Wraps a handler: every thrown error becomes a JSON error response. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Reads a request body as UTF-8 with a hard cap (streams; works without Content-Length). */
export async function readTextCapped(req: Request, limit = JSON_LIMIT_BYTES): Promise<string> {
  const declared = Number(req.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, "PAYLOAD_TOO_LARGE", `body larger than ${limit} bytes`);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", `body larger than ${limit} bytes`);
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(concat(chunks, total));
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

export async function readJson(req: Request, limit = JSON_LIMIT_BYTES): Promise<unknown> {
  const text = await readTextCapped(req, limit);
  if (text.trim() === "") throw new HttpError(400, "VALIDATION", "a JSON body is required");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "VALIDATION", "the body is not valid JSON");
  }
}

export async function readJsonObject(req: Request, limit = JSON_LIMIT_BYTES): Promise<Record<string, unknown>> {
  const v = await readJson(req, limit);
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new HttpError(400, "VALIDATION", "the body must be a JSON object");
  return v as Record<string, unknown>;
}

/** zod-like safeParse → value or 400 with the issues. */
export function parseOr400<T>(schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: readonly unknown[] } } }, v: unknown, what: string): T {
  const r = schema.safeParse(v);
  if (!r.success) {
    const issues = r.error.issues.slice(0, 20).map((i) => {
      const x = i as { path?: readonly PropertyKey[]; message?: string };
      return { path: (x.path ?? []).map(String).join("."), message: x.message ?? "invalid" };
    });
    throw new HttpError(400, "VALIDATION", `invalid ${what}`, issues);
  }
  return r.data;
}

export function slugParam(s: string): string {
  if (!Slug.safeParse(s).success) throw new HttpError(400, "VALIDATION", "invalid project slug");
  return s;
}

export function langParam(s: string | null | undefined): Lang {
  const r = Lang.safeParse(s);
  if (!r.success) throw new HttpError(400, "VALIDATION", "invalid language (en | fr)");
  return r.data;
}

export function optionalLang(s: string | null | undefined): Lang | null {
  return s === null || s === undefined || s === "" ? null : langParam(s);
}

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export function jobIdParam(s: string): string {
  if (!JOB_ID.test(s)) throw new HttpError(400, "VALIDATION", "invalid job id");
  return s;
}

/** Quoted strong ETag header value for an opaque engine etag. */
export const quoteEtag = (etag: string): string => `"${etag.replace(/"/g, "")}"`;
/** Parses an If-Match / If-None-Match header into opaque etags ("*" kept). */
export function parseEtagList(h: string | null): string[] {
  if (!h) return [];
  return h
    .split(",")
    .map((s) => s.trim().replace(/^W\//, ""))
    .filter(Boolean)
    .map((s) => (s === "*" ? "*" : s.replace(/^"(.*)"$/, "$1")));
}
