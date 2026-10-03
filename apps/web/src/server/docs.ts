// Document allowlist for /api/projects/[slug]/docs/[...rel] and history (SPEC §14.3): the DOC_REGISTRY entries that are
// userEditable, minus project.json (patched through PATCH /api/projects/[slug], which enforces LOCKED_AFTER_START).
import "server-only";
import { DOC_REGISTRY, type DocRegistryEntry } from "@docmaker/core";
import { HttpError } from "./http";

export const WEB_DOC_ENTRIES: readonly DocRegistryEntry[] = DOC_REGISTRY.filter((e) => e.userEditable && e.kind !== "project");

/** Joins and validates catch-all segments into a safe project-relative path (no traversal, no absolute paths). */
export function safeRel(segments: readonly string[]): string {
  if (!segments.length) throw new HttpError(400, "VALIDATION", "missing path");
  for (const s of segments) {
    if (s === "" || s === "." || s === ".." || s.includes("/") || s.includes("\\") || s.includes("\0") || s.length > 200) {
      throw new HttpError(403, "FORBIDDEN", "path not allowed");
    }
  }
  return segments.join("/");
}

/** The registry entry of an allowlisted document, else 403. */
export function editableDoc(segments: readonly string[]): { rel: string; entry: DocRegistryEntry } {
  const rel = safeRel(segments);
  const entry = WEB_DOC_ENTRIES.find((e) => e.pattern.test(rel));
  if (!entry) throw new HttpError(403, "FORBIDDEN", `${rel} is not a user-editable document`);
  return { rel, entry };
}

/** History entries are plain file names inside .history/<rel>/ (no separators). */
export function historyFileParam(v: unknown): string {
  if (typeof v !== "string" || !/^[A-Za-z0-9._:-]{1,200}$/.test(v) || v.includes("..")) {
    throw new HttpError(400, "VALIDATION", "invalid history file");
  }
  return v;
}
