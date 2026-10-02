// packages/core/src/util/errors.ts — the one error type every package throws (isomorphic).
import type { ErrorCode } from "../schema/ops";

export class DocmakerError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly hint: string | null;
  readonly details: unknown;
  constructor(code: ErrorCode, message: string, opts?: { retryable?: boolean; hint?: string; cause?: unknown; details?: unknown }) {
    super(message, opts?.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "DocmakerError";
    this.code = code;
    this.retryable = opts?.retryable ?? false;
    this.hint = opts?.hint ?? null;
    this.details = opts?.details;
  }
}

export function isDocmakerError(e: unknown): e is DocmakerError {
  return e instanceof DocmakerError || (typeof e === "object" && e !== null && (e as { name?: unknown }).name === "DocmakerError" && typeof (e as { code?: unknown }).code === "string");
}
