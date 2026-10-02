// Prompt pack checks: STYLE.md's 11 fixed sections, GUIDE.md's required parts, prompts.json content.
import { MotionTemplate, type LintIssue, type PromptPack } from "@docmaker/core";
import { foldTokens } from "./text";

/** STYLE.md sections in order (§4.12). `match` = folded tokens; a heading matches when it contains all of them. */
export const STYLE_MD_SECTIONS: readonly { title: string; match: readonly (readonly string[])[] }[] = [
  { title: "Essence / not", match: [["essence"]] },
  { title: "Materials", match: [["materials"], ["material"]] },
  { title: "Colour logic", match: [["colour"], ["color"]] },
  { title: "Type & subtitles", match: [["type"], ["typography"]] },
  { title: "Motion quality", match: [["motion"]] },
  { title: "Camera grammar table", match: [["camera"]] },
  { title: "Sound palette", match: [["sound"]] },
  { title: "Native moves", match: [["native"]] },
  { title: "Pitfalls", match: [["pitfalls"], ["pitfall"]] },
  { title: "Engine", match: [["engine"]] },
  { title: "Variation space", match: [["variation"]] },
];
/** GUIDE.md parts (Appendix A). */
export const GUIDE_MD_SECTIONS: readonly { title: string; match: readonly (readonly string[])[] }[] = [
  { title: "Goals", match: [["goals"], ["goal"]] },
  { title: "Rules", match: [["rules"]] },
  { title: "Reads timing", match: [["reads"], ["read", "timing"]] },
  { title: "Common failures", match: [["failures"], ["failure"]] },
  { title: "Worked example", match: [["example"]] },
  { title: "Banned", match: [["banned"]] },
];

/** Markdown ATX headings (levels 1–3), folded to tokens. Fenced code blocks are skipped. */
export function markdownHeadings(md: string): { text: string; tokens: string[] }[] {
  const out: { text: string; tokens: string[] }[] = [];
  let fenced = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^#{1,3}\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) out.push({ text: m[1]!, tokens: foldTokens(m[1]!) });
  }
  return out;
}

/** Index of the first heading matching each section (-1 when absent). */
export function findSections(md: string, sections: typeof STYLE_MD_SECTIONS): number[] {
  const hs = markdownHeadings(md);
  return sections.map((s) => hs.findIndex((h) => s.match.some((alt) => alt.every((t) => h.tokens.includes(t)))));
}

/** Motion templates whose motion_data_json carries fact-ref fields (§4.11 MotionData) → the fields. */
export const FACT_REF_FIELDS: Readonly<Partial<Record<MotionTemplate, readonly string[]>>> = {
  counter: ["figure_id"], money_counter: ["figure_id"], bar_chart: ["figure_id", "source_id"], line_chart: ["figure_id", "source_id"],
  timeline: ["event_id"], quote_card: ["quote_id"], tweet_card: ["quote_id"], headline_stack: ["source_id"],
  document_highlight: ["source_id", "quote_id"], evidence_board: ["source_id"], comment_pile: ["quote_id"],
};

/**
 * Lints a loaded prompt pack. Missing STYLE.md sections and GUIDE.md parts are warnings (a user style may be terse);
 * empty texts and a visualGrammar that omits a motion template or its fact-ref fields are errors.
 */
export function lintPromptPack(pack: PromptPack): LintIssue[] {
  const out: LintIssue[] = [];
  const empty = (where: string, s: string) => {
    if (s.trim() === "") out.push({ level: "error", rule: "STYLE_PROMPT_EMPTY", where, msg: `${where} is empty` });
  };
  empty("STYLE.md", pack.styleMd);
  empty("GUIDE.md", pack.guideMd);
  empty("prompts.qualityDirective", pack.qualityDirective);
  empty("prompts.visualGrammar", pack.visualGrammar);
  empty("prompts.narratorPersona.en", pack.narratorPersona.en);
  empty("prompts.narratorPersona.fr", pack.narratorPersona.fr);

  const idx = findSections(pack.styleMd, STYLE_MD_SECTIONS);
  idx.forEach((i, k) => {
    if (i < 0) out.push({ level: "warn", rule: "STYLE_MD_SECTION", where: "STYLE.md", msg: `missing section "${STYLE_MD_SECTIONS[k]!.title}"` });
  });
  const present = idx.filter((i) => i >= 0);
  if (present.some((v, k) => k > 0 && v < present[k - 1]!)) {
    out.push({ level: "warn", rule: "STYLE_MD_ORDER", where: "STYLE.md", msg: "sections are not in the fixed order" });
  }
  findSections(pack.guideMd, GUIDE_MD_SECTIONS).forEach((i, k) => {
    if (i < 0) out.push({ level: "warn", rule: "STYLE_GUIDE_SECTION", where: "GUIDE.md", msg: `missing part "${GUIDE_MD_SECTIONS[k]!.title}"` });
  });

  if (pack.visualGrammar.trim() !== "") {
    for (const t of MotionTemplate.options) {
      if (t === "none") continue;
      if (!new RegExp(`\\b${t}\\b`).test(pack.visualGrammar)) {
        out.push({ level: "error", rule: "STYLE_GRAMMAR_TEMPLATE", where: "prompts.visualGrammar", msg: `motion template ${t} has no motion_data_json format` });
      }
    }
    for (const [t, fields] of Object.entries(FACT_REF_FIELDS)) {
      for (const f of fields ?? []) {
        if (!pack.visualGrammar.includes(`"${f}"`)) {
          out.push({ level: "error", rule: "STYLE_GRAMMAR_FACT_REF", where: "prompts.visualGrammar", msg: `fact-ref field "${f}" (${t}) is not documented` });
        }
      }
    }
  }
  return out;
}
