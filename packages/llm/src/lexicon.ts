// Deterministic vocabularies shared by lintScript, validateBeats and deterministicFactChecks (EN + FR).
// Word boundaries are Unicode-aware (JS `\b` ignores accented letters such as "é").
import type { Lang } from "@docmaker/core";

const L = "\\p{L}\\p{N}_";
/** Case-insensitive, Unicode-aware whole-word regex around an alternation pattern. */
export function wordRegex(pattern: string, flags = "iu"): RegExp {
  return new RegExp(`(?<![${L}])(?:${pattern})(?![${L}])`, flags);
}
const APOS = "['’]";

/** Accusatory vocabulary that must be attributed or carry a legal status. */
export const ACCUSATORY: Readonly<Record<Lang, RegExp>> = {
  en: wordRegex(
    "rap(?:e|ed|ist|ists)|abus(?:e|ed|er|ers|ive)|assault(?:ed|s)?|molest\\w*|pedophil\\w*|paedophil\\w*|fraud(?:ster|sters|ulent)?|scam(?:med|mer|mers)?" +
      "|stole|steals?|thie(?:f|ves)|criminals?|murder(?:ed|er|ers|s)?|embezzl\\w*|beat (?:her|him|them)|swindl\\w*|extort\\w*|groom(?:ed|er|ing)",
  ),
  fr: wordRegex(
    "viol(?:é|ée|és|ées|eur|eurs|er|ait)?|abus(?:é|ée|eur|eurs)|agress(?:é|ée|eur|eurs|ion|ions|ait)|p[ée]dophile\\w*|fraud(?:e|es|eur|eurs|uleux|uleuse)" +
      "|escro(?:c|cs|querie|queries)|a vol[ée]|voleur|voleurs|criminel(?:le|s|les)?|meurtr(?:e|ier|iers|ière)|d[ée]tourn(?:é|ée|ement|ements)" +
      "|battu(?:e|s|es)?|frapp(?:é|ée|ait)|extorqu\\w*",
  ),
};

/** Attribution / legal-status vocabulary (makes an accusatory sentence acceptable). */
export const ATTRIBUTION: Readonly<Record<Lang, RegExp>> = {
  en: wordRegex(
    "alleg\\w*|accus\\w*|according to|claim\\w*|reported(?:ly)?|deni\\w*|found (?:him|her|them|that)|convicted|charged|pleaded|jury|judge|judges|court|courts" +
      "|lawsuit|sued|settled|prosecutors?|testified|indicted|acquitted|says|said|insist\\w*|suspected|investigat\\w*|charges|pending|tried|trial",
  ),
  fr: wordRegex(
    `aurait|auraient|pr[ée]sum[ée]e?s?|accus\\w*|selon|d${APOS}apr[eè]s|affirm\\w*|d[ée]nonc\\w*|reproch\\w*|condamn[ée]e?s?|mis en examen|mise en examen|inculp\\w*` +
      "|jug[ée]e?s?|tribunal|tribunaux|cour|plainte|plaintes|proc[eè]s|nie|nient|ni[ée]|d[ée]ment\\w*|soup[cç]onn\\w*|enqu[eê]te\\w*|relax[ée]e?|acquitt[ée]e?",
  ),
};

/** Generic intro / CTA openers (forbidden in the first 60 s). */
export const BANNED_OPENERS: Readonly<Record<Lang, RegExp>> = {
  en: wordRegex(
    `in this video|today we${APOS}?(?:re| are) going to|before we (?:start|begin)|without further ado|don${APOS}?t forget to (?:like|subscribe)|smash that|let${APOS}?s dive in`,
  ),
  fr: wordRegex(
    `dans cette vid[ée]o|aujourd${APOS}hui on va|avant de commencer|sans plus attendre|n${APOS}oubliez pas de (?:liker|vous abonner)|abonnez-vous`,
  ),
};

/** Sentence-initial "and then" chain markers. */
export const AND_THEN: Readonly<Record<Lang, RegExp>> = {
  en: /^(?:and then|then|after that|next)(?![\p{L}])/iu,
  fr: /^(?:et puis|puis|ensuite|apr[eè]s [cç]a)(?![\p{L}])/iu,
};

/** Mentions of a subject's response or denial (fact-check rule d). */
export const DENIAL: Readonly<Record<Lang, RegExp>> = {
  en: wordRegex("deni\\w*|deny|reject\\w*|disput\\w*|contest\\w*|respond\\w*|response|statement|maintain\\w* (?:his|her|their) innocence|innocen\\w*"),
  fr: wordRegex("ni[ée]e?s?|nie|nient|d[ée]ment\\w*|contest\\w*|r[ée]fut\\w*|r[ée]pon\\w*|d[ée]clar\\w*|innocen\\w*"),
};

/** Claim statuses that MUST be worded with attribution (lint rule status-wording). */
export const ATTRIBUTION_REQUIRED_STATUSES = [
  "allegation", "denied_allegation", "charged_pending", "under_investigation", "civil_claim_pending", "appeal_pending", "rumor_unverified",
] as const;

/** Splits narration into sentences (keeps the punctuation with the sentence). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…](?:[  ]?[»”’")\]])?)\s+(?=[^\s»”’")\]])/u)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

export function countWords(text: string): number {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.,%€$£-]*/gu);
  return m ? m.length : 0;
}
