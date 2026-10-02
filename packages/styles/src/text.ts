// Accent-folded tokenisation shared by suggestion, topic classification and manifest checks. Pure, isomorphic.
import { normWord } from "@docmaker/core";

/**
 * Idea text → folded tokens. Each whitespace token goes through core `normWord` (NFKD, marks stripped, lowercase),
 * then is split on the punctuation normWord keeps inside words (' . , -) so French elisions ("l'affaire") and
 * hyphenated compounds ("rise-and-fall") yield their parts.
 */
export function foldTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\s+/u)) {
    const w = normWord(raw);
    if (w === "") continue;
    for (const part of w.split(/['.,\-]+/u)) if (part !== "") out.push(part);
  }
  return out;
}

/** A keyword (possibly multi-word) folded the same way as idea text, words joined by one space. */
export function foldKeyword(k: string): string {
  return foldTokens(k).join(" ");
}

/** Plural/feminine/inflection tolerant equality of one folded token against one folded keyword word. */
export function tokenMatches(token: string, kw: string): boolean {
  if (token === kw) return true;
  if (kw.length < 3) return false; // short keywords match exactly only
  if (token.startsWith(kw)) {
    const rest = token.slice(kw.length);
    // a keyword already ending in s takes no extra s ("proces" must not match "process")
    if (kw.endsWith("s") && rest.startsWith("s")) return false;
    if (rest === "d") return kw.endsWith("e"); // rise → rised, never war → ward
    if (rest === "x") return kw.endsWith("u"); // FR plural in -x
    // EN: s, es, ed, ing, cy (bankrupt → bankruptcy), er(s), ly; FR: e, es, s
    return ["s", "es", "e", "ed", "ing", "cy", "er", "ers", "ly"].includes(rest);
  }
  if (kw.endsWith("y") && token === kw.slice(0, -1) + "ies") return true; // controversy → controversies
  if (kw.endsWith("e") && token.startsWith(kw.slice(0, -1))) {
    const rest = token.slice(kw.length - 1);
    return ["ed", "ing", "es", "s"].includes(rest); // collapse → collapsed, collapsing
  }
  return false;
}

/** Positions where the folded multi-word keyword occurs as a contiguous token run in `tokens`. */
export function findKeyword(tokens: readonly string[], keyword: string): number[] {
  const words = keyword.split(" ").filter((w) => w !== "");
  if (words.length === 0) return [];
  const hits: number[] = [];
  outer: for (let i = 0; i + words.length <= tokens.length; i++) {
    for (let j = 0; j < words.length; j++) {
      if (!tokenMatches(tokens[i + j]!, words[j]!)) continue outer;
    }
    hits.push(i);
  }
  return hits;
}
