// packages/core/src/util/migrate.ts — per-document migration chains (§4.18). Isomorphic; never writes back.
import { DOC_VERSIONS, type DocKind } from "../schema/common";
import { DocmakerError } from "./errors";

export type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;
const REGISTRY = new Map<DocKind, Map<number, Migration>>();

/** Registers one step from → from+1 for a document kind (re-registering the same step replaces it). */
export function registerMigration(kind: DocKind, from: number, fn: Migration): void {
  if (!Number.isInteger(from) || from < 0 || from >= DOC_VERSIONS[kind]) {
    throw new DocmakerError("INTERNAL", `migration ${kind} ${from}→${from + 1} is outside the version range (current ${DOC_VERSIONS[kind]})`);
  }
  let m = REGISTRY.get(kind);
  if (!m) REGISTRY.set(kind, (m = new Map()));
  m.set(from, fn);
}

/** Runs the chain from raw.schemaVersion up to DOC_VERSIONS[kind]. Never writes back. Missing step → MIGRATION_FAILED. */
export function migrateDoc(kind: DocKind, raw: unknown): { value: unknown; migratedFrom: number | null } {
  const target = DOC_VERSIONS[kind];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DocmakerError("MIGRATION_FAILED", `${kind}: document is not an object`);
  }
  const v = (raw as Record<string, unknown>).schemaVersion;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
    throw new DocmakerError("MIGRATION_FAILED", `${kind}: missing or invalid schemaVersion`);
  }
  if (v === target) return { value: raw, migratedFrom: null };
  if (v > target) {
    throw new DocmakerError("MIGRATION_FAILED", `${kind}: schemaVersion ${v} is newer than this build (${target})`, { hint: "update DocumentaryMaker" });
  }
  let cur: Record<string, unknown> = structuredClone(raw as Record<string, unknown>);
  for (let f = v; f < target; f++) {
    const fn = REGISTRY.get(kind)?.get(f);
    if (!fn) throw new DocmakerError("MIGRATION_FAILED", `${kind}: no migration registered for ${f}→${f + 1}`);
    try {
      cur = fn(cur);
    } catch (e) {
      throw new DocmakerError("MIGRATION_FAILED", `${kind}: migration ${f}→${f + 1} threw`, { cause: e });
    }
    cur.schemaVersion = f + 1;
  }
  return { value: cur, migratedFrom: v };
}
