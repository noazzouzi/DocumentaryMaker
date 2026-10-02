// packages/core/src/util/json.ts — canonical JSON (hashing) and stable pretty JSON (persistence). Isomorphic.
import { DocmakerError } from "./errors";

function serialise(v: unknown, indent: string, level: number, path: string): string | undefined {
  if (v === null) return "null";
  if (typeof v === "object" && typeof (v as { toJSON?: unknown }).toJSON === "function") {
    v = (v as { toJSON: () => unknown }).toJSON();
  }
  switch (typeof v) {
    case "string":
      return JSON.stringify(v);
    case "boolean":
      return v ? "true" : "false";
    case "number":
      if (!Number.isFinite(v)) throw new DocmakerError("VALIDATION", `non-finite number at ${path || "<root>"}`);
      return Object.is(v, -0) ? "0" : JSON.stringify(v);
    case "bigint":
      throw new DocmakerError("VALIDATION", `bigint at ${path || "<root>"} is not JSON`);
    case "undefined":
    case "function":
    case "symbol":
      return undefined;
    default:
      break;
  }
  if (v === null) return "null";
  const nl = indent ? "\n" + indent.repeat(level + 1) : "";
  const close = indent ? "\n" + indent.repeat(level) : "";
  const sep = indent ? ": " : ":";
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const parts = v.map((x, i) => serialise(x, indent, level + 1, `${path}[${i}]`) ?? "null");
    return "[" + nl + parts.join("," + nl) + close + "]";
  }
  if (ArrayBuffer.isView(v)) {
    return serialise(Array.from(v as unknown as ArrayLike<number>), indent, level, path);
  }
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort(); // UTF-16 code unit order
  const parts: string[] = [];
  for (const k of keys) {
    const s = serialise(obj[k], indent, level + 1, path ? `${path}.${k}` : k);
    if (s === undefined) continue;
    parts.push(JSON.stringify(k) + sep + s);
  }
  if (parts.length === 0) return "{}";
  return "{" + nl + parts.join("," + nl) + close + "}";
}

/** Keys sorted recursively (UTF-16 code unit order); undefined props dropped; -0 → 0; NaN/±Infinity → throw VALIDATION. */
export function canonicalJson(v: unknown): string {
  return serialise(v, "", 0, "") ?? "null";
}

/** Canonical key order; indent 2 for human-edited docs, 0 (compact) for timeline/layout. Trailing "\n". */
export function stableStringify(v: unknown, indent = 2): string {
  return (serialise(v, " ".repeat(Math.max(0, Math.floor(indent))), 0, "") ?? "null") + "\n";
}
