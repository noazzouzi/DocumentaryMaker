// packages/core/src/node/logger.ts — redacting logger (secrets never reach a log line).
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { Secrets } from "../schema/project";
import type { Logger, RuntimeConfig } from "../interfaces";

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const;
const SECRET_KEY = /(api[-_]?key|token|secret|authorization|cookie)/i;
export const REDACTED = "[REDACTED]";

function redactString(s: string, values: readonly string[]): string {
  let out = s;
  for (const v of values) if (v.length >= 4) out = out.split(v).join(REDACTED);
  return out;
}

function redact(v: unknown, values: readonly string[], depth = 0): unknown {
  if (depth > 8) return "[…]";
  if (typeof v === "string") return redactString(v, values);
  if (Array.isArray(v)) return v.map((x) => redact(x, values, depth + 1));
  if (v instanceof Error) return { name: v.name, message: redactString(v.message, values) };
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = SECRET_KEY.test(k) ? REDACTED : redact(x, values, depth + 1);
    return out;
  }
  return v;
}

/** Redacts every secret value and any value under keys matching /(api[-_]?key|token|secret|authorization|cookie)/i. */
export function createLogger(opts: { level: RuntimeConfig["logLevel"]; sink?: (line: string) => void; secrets?: Secrets; file?: string }): Logger {
  const values = Object.values(opts.secrets ?? {}).filter((x): x is string => typeof x === "string" && x !== "");
  const sink = opts.sink ?? ((line: string) => process.stderr.write(line + "\n"));
  if (opts.file) mkdirSync(path.dirname(opts.file), { recursive: true });
  const make = (bindings: Record<string, unknown>): Logger => {
    const emit = (level: keyof typeof ORDER, msg: string, meta?: Record<string, unknown>) => {
      if (ORDER[level] < ORDER[opts.level]) return;
      const m = { ...bindings, ...(meta ?? {}) };
      const metaStr = Object.keys(m).length > 0 ? " " + JSON.stringify(redact(m, values)) : "";
      const line = `${new Date().toISOString()} ${level.toUpperCase()} ${redactString(msg, values)}${metaStr}`;
      sink(line);
      if (opts.file) {
        try { appendFileSync(opts.file, line + "\n"); } catch { /* logging must never throw */ }
      }
    };
    return {
      debug: (msg, meta) => emit("debug", msg, meta),
      info: (msg, meta) => emit("info", msg, meta),
      warn: (msg, meta) => emit("warn", msg, meta),
      error: (msg, meta) => emit("error", msg, meta),
      child: (b) => make({ ...bindings, ...b }),
    };
  };
  return make({});
}
