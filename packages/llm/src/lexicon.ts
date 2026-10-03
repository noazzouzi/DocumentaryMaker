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
      "|stole|stolen|steal(?:s|ing)?|thie(?:f|ves)|rob(?:bed|ber|bers|bery|bing)|criminals?|murder(?:ed|er|ers|s)?|embezzl\\w*|beat (?:her|him|them)" +
      "|beat (?:his|her|their) \\w+|swindl\\w*|extort\\w*|groom(?:ed|er|ing)|defraud\\w*|harass\\w*|kill(?:ed|er|ers|ing)?|launder\\w*|brib\\w*" +
      "|corrupt\\w*|li(?:ed|ar|ars)|cheat(?:ed|er|ers|ing|s)?|con(?:ned|ning)|con (?:artist|man|men)",
  ),
  fr: wordRegex(
    "viol(?:é|ée|és|ées|eur|eurs|er|ait)?|abus(?:é|ée|eur|eurs)|agress(?:é|ée|eur|eurs|ion|ions|ait)|p[ée]dophile\\w*|fraud\\p{L}*" +
      "|escro(?:c|cs|querie|queries)|escroqu\\p{L}*|arnaqu\\p{L}*|(?:a|ont|avait|avaient|aurait|auraient) vol[ée]|vol(?:ait|aient)|voleur|voleuse|voleurs" +
      "|criminel(?:le|s|les)?|meurtr(?:e|ier|iers|ière)|assassin\\p{L}*|d[ée]tourn(?:é|ée|ement|ements|ait)|battu(?:e|s|es)?|frapp(?:é|ée|ait)" +
      "|extorqu\\p{L}*|harc[eè]l\\p{L}*|tu[ée]e?s?|corromp\\p{L}*|corruption|soudoy\\p{L}*|pots?-de-vin|blanchi\\p{L}*|menteu(?:r|rs|se|ses)" +
      "|ment(?:i|ait|aient|ir)|trich(?:é|ait|eur|eurs|euse)",
  ),
};

/**
 * Attribution / legal-status CONSTRUCTIONS (make an accusatory sentence acceptable). Incidental words that merely
 * appear near an accusation — said, judge, court, trial, tried, pending, cour, juge, procès — do not count on their own:
 * "He embezzled two million and lied to the judge." is not attributed; "Prosecutors said he embezzled…" is.
 */
export const ATTRIBUTION: Readonly<Record<Lang, RegExp>> = {
  en: wordRegex(
    "alleg\\w*|accus\\w*|according to|claim(?:s|ed|ing)?|reportedly|reported (?:that|he|she|they)|(?:is|are|was|were) (?:reported|said|believed|suspected) to" +
      "|deni(?:ed|es|al|als)|deny|found (?:him|her|them|that)|convicted|charged|pleaded|indicted|acquitted|sued|settled|lawsuits?|prosecutors?" +
      "|(?:awaiting|awaits|stand|stands|standing|stood|went on|goes on|on) trial|(?:case|charges|appeal|trial|investigation) (?:is |are |remains? )?pending|pending (?:trial|appeal)" +
      "|testified|testimony|investigat\\w*|suspected|suspects?|insist\\w*|(?:faces|facing|faced) (?:\\w+ )?charges|charges (?:of|against)" +
      "|(?:court|jury|judge|judges|tribunal|panel|regulators?) (?:found|ruled|held|concluded|determined|decided|ordered)" +
      "|(?:said|says|told \\p{L}+(?: \\p{L}+)?|stated|wrote|writes|argued|argues|maintain(?:s|ed)?) (?:that|he|she|they|it|his|her|their|him)" +
      "|(?:he|she|they|we|i) (?:said|says|claimed|claims|wrote|writes|told \\p{L}+)",
  ),
  fr: wordRegex(
    `aurait|auraient|serait|seraient|pr[ée]sum[ée]e?s?|accus\\p{L}*|selon|d${APOS}apr[eè]s|affirm\\p{L}*|d[ée]nonc\\p{L}*|reproch\\p{L}*|condamn[ée]e?s?` +
      "|mise? en examen|inculp\\p{L}*|plaintes?|nie|nient|ni[ée]e?s?|d[ée]ment\\p{L}*|soup[cç]onn\\p{L}*|enqu[eê]te\\p{L}*|relax[ée]e?s?|acquitt[ée]e?s?" +
      "|t[ée]moign\\p{L}*|jug[ée]e?s? (?:coupables?|responsables?|pour)|proc[eè]s en cours|(?:sera|seront|doit [êe]tre|doivent [êe]tre|va [êe]tre|vont [êe]tre) jug[ée]e?s?" +
      "|(?:tribunal|tribunaux|cour|juge|juges|justice|jury) (?:a |l[’']a |les a |ont )?(?:estim[ée]|jug[ée]|condamn[ée]|reconnu|conclu|consid[ée]r[ée]|[ée]tabli|retenu)" +
      `|(?:dit|disent|d[ée]clar[ée]|racont[ée]|expliqu[ée]|[ée]crit|soutenu|assur[ée]) (?:que|qu${APOS})` +
      "|(?:a-t-(?:il|elle)|ont-(?:ils|elles)) (?:dit|d[ée]clar[ée]|racont[ée]|expliqu[ée])|(?:dit|raconte|explique|d[ée]clare)-(?:t-)?(?:il|elle|ils|elles)",
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
