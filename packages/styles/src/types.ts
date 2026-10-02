// Public types of @docmaker/styles (re-exported by index.ts; shapes are the §4.19 contract).
import type { LintIssue, StylePlugin, TopicType } from "@docmaker/core";

export interface StyleSummary {
  id: string; version: string; names: { en: string; fr: string }; description: { en: string; fr: string };
  category: "commentary" | "essay" | "explainer" | "true-crime"; previewColor: string; bestFor: TopicType[];
  source: "builtin" | "user"; dir: string;
}
/** A user style directory that failed validation; discovery skips it instead of failing the whole registry. */
export interface RejectedStyle { dir: string; issues: LintIssue[] }
export interface StyleRegistry {
  readonly hash: string; // hashJson of sorted (id, dataHash) — participates in the style stage inputs
  get(id: string): StylePlugin; // unknown id → DocmakerError("VALIDATION")
  has(id: string): boolean;
  list(): StyleSummary[]; // sorted by id
  /** Additive (W1): invalid user style dirs skipped by discoverStyles (shown by the gallery / `style validate`). */
  readonly rejected?: readonly RejectedStyle[];
}
