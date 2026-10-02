// @docmaker/styles — public API (packages/styles/src/index.ts). Data-only style directories, auto-discovered.
// Signatures are the §4.19 contract; extra exports are additive helpers (inspection, lint codes, scoring tables).
import type { CueType, LintIssue, StyleFont } from "@docmaker/core";
import { lintStyleData } from "./validate";

export type { StyleSummary, StyleRegistry, RejectedStyle } from "./types";
export { builtinStylesDir, discoverStyles, createRegistry, listStyleDirs, registryHash, summarize } from "./registry";
export { loadStyleDir, inspectStyleDir, formatIssues, STYLE_FILES, STYLE_FONT_EXTENSIONS, type StyleDirReport } from "./load";
export { suggestStyleOffline, classifyTopicOffline, riskFlagsOffline, scoreStyle, TOPIC_LEXICON, RISK_LEXICON, CATEGORY_AFFINITY, RECOMMENDED_MINUTES, TOPIC_PRIORITY } from "./suggest";
export { scaffoldStyle, humanizeStyleId } from "./scaffold";
export { lintPromptPack, markdownHeadings, findSections, STYLE_MD_SECTIONS, GUIDE_MD_SECTIONS, FACT_REF_FIELDS } from "./promptPack";
export { STYLE_RULES, ACT_SHARE_TOLERANCE, FRAME_W, FRAME_H, rectsIntersect } from "./validate";
export { styleFontAssets, type StyleFontAsset } from "./fonts";
export { foldTokens, foldKeyword } from "./text";

/** Schema, act shares (Σ = 1 ± 1e-6), macro acts present, fonts ∈ BUILTIN_FONT_FAMILIES ∪ style fonts, zones inside the
 *  frame, captionBand ∩ keepOut = ∅, triggers ⊆ DERIVABLE_TRIGGERS, transition keys valid, weights ≥ 0. */
export function validateStyleData(data: unknown, o: { fontFamilies: readonly string[]; styleFonts?: readonly StyleFont[] }): LintIssue[] {
  return lintStyleData(data, { fontFamilies: o.fontFamilies, styleFonts: o.styleFonts ?? [] });
}
export type { CueType };
