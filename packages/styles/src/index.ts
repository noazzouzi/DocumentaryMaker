// @docmaker/styles — public API (packages/styles/src/index.ts). Data-only style directories, auto-discovered.
// P0 API stub (SPEC §4.19): every function throws DocmakerError("INTERNAL", "not implemented: …") until its owner lands it.
import { notImplemented } from "./notImplemented";
import type { CueType, LintIssue, StyleFont, StylePlugin, StyleSuggestion, TopicType } from "@docmaker/core";

export interface StyleSummary {
  id: string; version: string; names: { en: string; fr: string }; description: { en: string; fr: string };
  category: "commentary" | "essay" | "explainer" | "true-crime"; previewColor: string; bestFor: TopicType[];
  source: "builtin" | "user"; dir: string;
}
export interface StyleRegistry {
  readonly hash: string; // hashJson of sorted (id, dataHash) — participates in the style stage inputs
  get(id: string): StylePlugin; // unknown id → DocmakerError("VALIDATION")
  has(id: string): boolean;
  list(): StyleSummary[]; // sorted by id
}
/** <repoRoot>/packages/styles/builtin — never located through import.meta.resolve. */
export function builtinStylesDir(repoRoot: string): string {
  throw notImplemented("styles.builtinStylesDir");
}
/** Reads style.json (StyleData), STYLE.md, GUIDE.md, prompts.json (StylePrompts), optional fonts/font.json; validates. */
export function loadStyleDir(dir: string, source: "builtin" | "user"): Promise<StylePlugin> {
  throw notImplemented("styles.loadStyleDir");
}
/** builtin dirs + <home>/styles/* (user dirs shadow nothing: a duplicate id is a VALIDATION error). */
export function discoverStyles(o: { repoRoot: string; userStylesDir: string | null }): Promise<StyleRegistry> {
  throw notImplemented("styles.discoverStyles");
}
/** Schema, act shares (Σ = 1 ± 1e-6), macro acts present, fonts ∈ BUILTIN_FONT_FAMILIES ∪ style fonts, zones inside the
 *  frame, captionBand ∩ keepOut = ∅, triggers ⊆ DERIVABLE_TRIGGERS, transition keys valid, weights ≥ 0. */
export function validateStyleData(data: unknown, o: { fontFamilies: readonly string[]; styleFonts?: readonly StyleFont[] }): LintIssue[] {
  throw notImplemented("styles.validateStyleData");
}
/** Deterministic keyword classifier: normWord tokens of the idea × manifest.uses (accent-folded) and bestFor. Free, offline. */
export function suggestStyleOffline(idea: string, registry: StyleRegistry): StyleSuggestion {
  throw notImplemented("styles.suggestStyleOffline");
}
export function classifyTopicOffline(idea: string): TopicType {
  throw notImplemented("styles.classifyTopicOffline");
}
/** `docmaker style new <id> --from <base>`: copies the base dir to <home>/styles/<id>, rewrites manifest.id/names. */
export function scaffoldStyle(o: { registry: StyleRegistry; fromId: string; newId: string; destDir: string }): Promise<string> {
  throw notImplemented("styles.scaffoldStyle");
}
export type { CueType };
