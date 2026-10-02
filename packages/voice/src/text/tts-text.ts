// spoken text → ttsText (+ display-word → tts-word mapping), §8.2. Only the engine calls buildTtsText
// in production; voice uses the same function internally for clip-narrated segments.
import type { Lang, LexiconEntry } from "@docmaker/core";
import { tokenizeDisplay } from "@docmaker/core";
import { anchorSpans } from "../align/nw";
import {
  LANG_WORDS, cardinalFromDigits, cardinalGroupWords, decadeWords, digitGroups, fractionWords, ordinalWords,
  romanToInt, yearWords,
} from "./numbers";

export interface TtsTextResult { ttsText: string; ttsWords: string[]; displayToTts: [number, number][] }
export interface TtsTextOptions { lexicon: LexiconEntry[]; expandNumbers: boolean; stripTags: boolean }

type Cur = "€" | "$" | "£" | "ƒ";
const CURRENCY: Record<Cur, Record<Lang, readonly [string, string]>> = {
  "€": { en: ["euro", "euros"], fr: ["euro", "euros"] },
  $: { en: ["dollar", "dollars"], fr: ["dollar", "dollars"] },
  "£": { en: ["pound", "pounds"], fr: ["livre", "livres"] },
  ƒ: { en: ["guilder", "guilders"], fr: ["florin", "florins"] },
};
const CUR_RE = "[€$£ƒ]";
const SCALE_WORDS = new Set(["thousand", "million", "millions", "billion", "billions", "trillion", "trillions", "mille", "milliard", "milliards"]);
const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "janvier", "février", "fevrier", "mars", "avril", "mai", "juin", "juillet", "août", "aout", "septembre", "octobre", "novembre", "décembre", "decembre",
];
/** Words after which a 4-digit number is read as a year (§8.2: "in/en/since/depuis/de" and friends). */
const YEAR_CONTEXT = new Set([
  ...MONTHS,
  "in", "since", "from", "until", "till", "by", "of", "circa", "c.", "around", "before", "after", "during", "year", "early", "late", "mid",
  "summer", "winter", "spring", "autumn", "fall", "between",
  "en", "depuis", "de", "dès", "des", "du", "vers", "avant", "après", "jusqu'en", "jusqu’en", "année", "an", "l'an", "l’an", "pendant",
  "durant", "fin", "début", "milieu", "été", "hiver", "printemps", "automne", "entre",
]);

const CONTENT = /[\p{L}\p{N}%€$£]/u;
const CORE_START = /[\p{L}\p{N}€$£%]/u;
const CORE_END = /[\p{L}\p{N}€$£%]/u;

interface Parts { pre: string; core: string; post: string }
/** Splits a display word into leading punctuation, the core (letters/digits/currency/%) and trailing punctuation. */
export function splitCore(t: string): Parts {
  const chars = [...t];
  let a = -1, b = -1;
  for (let k = 0; k < chars.length; k++) if (CORE_START.test(chars[k]!)) { a = k; break; }
  if (a < 0) return { pre: t, core: "", post: "" };
  for (let k = chars.length - 1; k >= a; k--) if (CORE_END.test(chars[k]!)) { b = k; break; }
  return { pre: chars.slice(0, a).join(""), core: chars.slice(a, b + 1).join(""), post: chars.slice(b + 1).join("") };
}

const tokensOf = (s: string) => s.split(/\s+/u).filter((x) => x !== "");

interface NumTok {
  pre: Cur | null; post: Cur | "%" | null; int: string; frac: string | null;
  ordinal: { n: number; feminine: boolean; second: boolean } | null; decade: number | null; range: [string, string] | null;
}

function parseNumber(core: string, lang: Lang, next: string | null = null): NumTok | null {
  let c = core;
  let pre: Cur | null = null, post: Cur | "%" | null = null;
  const pm = new RegExp(`^(${CUR_RE})(?=\\d)`, "u").exec(c);
  if (pm) { pre = pm[1] as Cur; c = c.slice(pm[1]!.length); }
  const sm = new RegExp(`(?<=\\d)(${CUR_RE}|%)$`, "u").exec(c);
  if (sm) { post = sm[1] as Cur | "%"; c = c.slice(0, -sm[1]!.length); }
  const base: NumTok = { pre, post, int: "", frac: null, ordinal: null, decade: null, range: null };
  if (!pre && !post) {
    const om = lang === "en" ? /^(\d+)(st|nd|rd|th)$/i.exec(c) : /^(\d+)(er|re|ère|e|ème|è|nde|nd|d)$/.exec(c);
    if (om) {
      const n = Number(om[1]);
      const suf = om[2]!.toLowerCase();
      return { ...base, int: om[1]!, ordinal: { n, feminine: suf === "re" || suf === "ère" || suf === "nde", second: lang === "fr" && /^n?d/.test(suf) && n === 2 } };
    }
    if (lang === "fr") {
      // "XVIIe", "Ier", "Xe siècle" — never "Le"/"Ce"/"Ve" (single letters only before "siècle", except I + er/re)
      const rm = /^([IVXLC]+)(er|re|ère|e|ème)$/.exec(c);
      const single = rm !== null && rm[1]!.length === 1;
      const okSingle = single && ((rm[1] === "I" && rm[2] !== "e" && rm[2] !== "ème") || (/^[VX]$/.test(rm[1]!) && /^si[eè]cles?$/i.test(next ?? "")));
      const rn = rm && (!single || okSingle) ? romanToInt(rm[1]!) : null;
      if (rm && rn) return { ...base, int: String(rn), ordinal: { n: rn, feminine: rm[2] === "re" || rm[2] === "ère", second: false } };
    }
    const dm = lang === "en" ? /^(\d{3}0)['’]?s$/.exec(c) : null;
    if (dm) return { ...base, int: dm[1]!, decade: Number(dm[1]) };
    const rg = /^(\d{1,4})[-–](\d{1,4})$/.exec(c);
    if (rg) return { ...base, int: rg[1]!, range: [rg[1]!, rg[2]!] };
  }
  const grouped = lang === "en" ? /^(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?$/.exec(c) : /^(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?$/.exec(c);
  if (grouped) return { ...base, int: grouped[1]!.replace(/[.,]/g, ""), frac: grouped[2] ?? null };
  const plain = lang === "en" ? /^(\d+)(?:\.(\d+))?$/.exec(c) : /^(\d+)(?:[,.](\d+))?$/.exec(c);
  if (plain) return { ...base, int: plain[1]!, frac: plain[2] ?? null };
  return null;
}

const isYearValue = (s: string) => /^\d{4}$/.test(s) && Number(s) >= 1000 && Number(s) <= 2099;

/** Core text of the nearest non-empty word in a direction (lowercased). */
function neighbourCore(words: string[], i: number, dir: -1 | 1): string | null {
  for (let k = i + dir; k >= 0 && k < words.length; k += dir) if (words[k] !== "") return splitCore(words[k]!).core;
  return null;
}

export function buildTtsText(spoken: string, lang: Lang, opts: TtsTextOptions): TtsTextResult {
  const display = tokenizeDisplay(spoken);
  // 1. tags ([whispers], [sighs]) are removed from the tts text when stripTags
  const removed = new Uint8Array(spoken.length);
  if (opts.stripTags) for (const m of spoken.matchAll(/\[[^[\]\n]{1,80}\]/gu)) removed.fill(1, m.index, m.index + m[0].length);
  const src: string[] = display.map((w) => {
    let t = "";
    for (let k = w.start; k < w.end; k++) if (!removed[k]) t += spoken[k];
    t = t.replace(/\s+/gu, " ").trim();
    return CONTENT.test(t) ? t : "";
  });
  const out = src.slice();
  const done = new Uint8Array(src.length);

  const lexicon = [...opts.lexicon]
    .map((e) => ({ e, toks: tokensOf(e.match).map((t) => splitCore(t).core || t) }))
    .filter((x) => x.toks.length > 0)
    .sort((a, b) => b.toks.length - a.toks.length || b.e.match.length - a.e.match.length);
  const eq = (a: string, b: string, cs: boolean) => (cs ? a === b : a.toLocaleLowerCase(lang) === b.toLocaleLowerCase(lang));

  const tryLexicon = (i: number): number => {
    for (const { e, toks } of lexicon) {
      if (i + toks.length > src.length) continue;
      let ok = true;
      for (let j = 0; j < toks.length && ok; j++) ok = src[i + j] !== "" && !done[i + j] && eq(splitCore(src[i + j]!).core, toks[j]!, e.caseSensitive);
      if (!ok) continue;
      const say = tokensOf(e.say);
      const k = toks.length;
      // identical words anchor the split ("Semper Augustus" → "Semper" | "Ow goos tus")
      const spans = anchorSpans(toks, say);
      for (let j = 0; j < k; j++) {
        const piece = say.slice(spans[j]![0], spans[j]![1]).join(" ");
        const parts = splitCore(src[i + j]!);
        out[i + j] = piece === "" ? "" : `${j === 0 ? parts.pre : ""}${piece}${j === k - 1 ? parts.post : ""}`;
        done[i + j] = 1;
      }
      return k;
    }
    return 0;
  };

  const curWord = (c: Cur, plural: boolean) => CURRENCY[c][lang][plural ? 1 : 0];
  const amountPlural = (t: NumTok) => (lang === "fr" ? Number(`${t.int}.${t.frac ?? 0}`) >= 2 : !(t.int.replace(/^0+/, "") === "1" && !t.frac));

  const tryNumber = (i: number): number => {
    const first = splitCore(src[i]!);
    const tok = parseNumber(first.core, lang, neighbourCore(src, i, 1));
    if (!tok) return 0;
    const W = LANG_WORDS[lang];
    // ordinals, decades, ranges: single token
    if (tok.ordinal) {
      out[i] = first.pre + ordinalWords(tok.ordinal.n, lang, tok.ordinal) + first.post;
      done[i] = 1;
      return 1;
    }
    if (tok.decade !== null) {
      out[i] = first.pre + decadeWords(tok.decade, lang) + first.post;
      done[i] = 1;
      return 1;
    }
    if (tok.range) {
      const [a, b] = tok.range;
      const read = (s: string) => (isYearValue(a) && isYearValue(b) ? yearWords(Number(s), lang) : cardinalFromDigits(s, lang));
      out[i] = `${first.pre}${read(a)} ${W.to} ${read(b)}${first.post}`;
      done[i] = 1;
      return 1;
    }
    // space-grouped thousands across display words: "5 500", "1 200 000"
    const span = [i];
    let last = tok;
    let lastParts = first;
    if (/^\d{1,3}$/.test(tok.int) && tok.frac === null && !tok.post && first.post === "") {
      for (let j = i + 1; j < src.length; j++) {
        if (src[j] === "" || done[j]) break;
        const pj = splitCore(src[j]!);
        if (pj.pre !== "") break;
        const tj = parseNumber(pj.core, lang);
        if (!tj || tj.pre || !/^\d{3}$/.test(tj.int) || tj.ordinal || tj.decade !== null || tj.range) break;
        span.push(j);
        last = tj;
        lastParts = pj;
        if (tj.frac !== null || tj.post || pj.post !== "") break;
      }
    }
    const intDigits = span.length > 1 ? span.map((k) => parseNumber(splitCore(src[k]!).core, lang)!.int).join("") : tok.int;
    const frac = last.frac;
    const post: Cur | "%" | null = last.post;
    const pre: Cur | null = tok.pre;
    const value: NumTok = { ...tok, int: intDigits, frac, post, pre };
    let consumed = span.length;
    // separate currency / percent token right after the number ("5 €", "12,5 %")
    let sepUnit: Cur | "%" | null = null;
    const after = span[span.length - 1]! + 1;
    if (!post && lastParts.post === "" && after < src.length && src[after] !== "" && !done[after]) {
      const pa = splitCore(src[after]!);
      if (pa.pre === "" && new RegExp(`^(${CUR_RE}|%)$`, "u").test(pa.core)) { sepUnit = pa.core as Cur | "%"; consumed++; }
    }
    const unit: Cur | "%" | null = pre ?? post ?? sepUnit;
    // year vs cardinal for a bare 4-digit integer
    let groupWords: string[];
    const bare = span.length === 1 && !unit && frac === null && isYearValue(intDigits) && /^\d{4}$/.test(first.core);
    if (bare) {
      const prev = neighbourCore(src, i, -1)?.toLocaleLowerCase(lang) ?? null;
      const next = neighbourCore(src, i, 1);
      const standalone = next === null || first.post !== "" || /^[\p{Lu}\p{N}]/u.test(next);
      groupWords = [(prev !== null && YEAR_CONTEXT.has(prev)) || standalone ? yearWords(Number(intDigits), lang) : cardinalFromDigits(intDigits, lang)];
    } else if (span.length > 1) {
      groupWords = cardinalGroupWords(digitGroups(intDigits), lang);
      // groups beyond the written ones (cannot happen: each written group is one display word)
      if (groupWords.length !== span.length) groupWords = [groupWords.filter(Boolean).join(" "), ...span.slice(1).map(() => "")];
    } else {
      groupWords = [cardinalFromDigits(intDigits, lang)];
    }
    // unit words; a currency before a scale word moves after it ("$5 million" → "five million dollars")
    const isCur = unit !== null && unit !== "%";
    let scaleIdx = -1;
    const nx = after + (sepUnit ? 1 : 0);
    if (pre && nx < src.length && src[nx] !== "" && !done[nx] && SCALE_WORDS.has(splitCore(src[nx]!).core.toLocaleLowerCase(lang))) scaleIdx = nx;
    let unitText = "";
    if (unit === "%") unitText = W.percent;
    else if (unit) {
      const w = curWord(unit, scaleIdx >= 0 || amountPlural(value));
      unitText = scaleIdx >= 0 && lang === "fr" ? (/^[aeiouyé]/.test(w) ? `d'${w}` : `de ${w}`) : w;
    }
    // cents read after the currency word ("twelve euros fifty"); other fractions are decimals
    const cents = isCur && frac !== null && frac.length === 2 && scaleIdx < 0 ? cardinalFromDigits(frac, lang) : "";
    const decimal = frac !== null && cents === "" ? `${W.point} ${fractionWords(frac, lang)}` : "";
    span.forEach((k, n) => {
      const parts = splitCore(src[k]!);
      const isLast = n === span.length - 1;
      const words = [groupWords[n] ?? "", isLast ? decimal : "", isLast && !sepUnit && scaleIdx < 0 ? unitText : "", isLast && !sepUnit ? cents : ""]
        .filter((x) => x !== "").join(" ");
      out[k] = words === "" ? "" : `${n === 0 ? parts.pre : ""}${words}${isLast ? parts.post : ""}`;
      done[k] = 1;
    });
    if (sepUnit) {
      const pa = splitCore(src[after]!);
      const words = [scaleIdx >= 0 ? "" : unitText, cents].filter((x) => x !== "").join(" ");
      out[after] = words === "" ? "" : `${words}${pa.post}`;
      done[after] = 1;
    }
    if (scaleIdx >= 0) {
      const ps = splitCore(src[scaleIdx]!);
      out[scaleIdx] = `${ps.pre}${ps.core} ${unitText}${ps.post}`;
      done[scaleIdx] = 1;
      consumed = scaleIdx - i + 1;
    }
    return consumed;
  };

  /** Regnal Roman numerals after a capitalised name: "Louis XIV" → "Louis quatorze" / "Louis the fourteenth". */
  const tryRoman = (i: number): number => {
    const parts = splitCore(src[i]!);
    if (!/^[IVX]{2,5}$/.test(parts.core)) return 0;
    const n = romanToInt(parts.core);
    const prev = i > 0 ? splitCore(src[i - 1]!).core : "";
    if (!n || n > 30 || !/^\p{Lu}\p{Ll}/u.test(prev)) return 0;
    out[i] = parts.pre + (lang === "fr" ? cardinalFromDigits(String(n), "fr") : `the ${ordinalWords(n, "en")}`) + parts.post;
    done[i] = 1;
    return 1;
  };

  for (let i = 0; i < src.length; ) {
    if (src[i] === "" || done[i]) { i++; continue; }
    const k = tryLexicon(i) || (opts.expandNumbers ? tryNumber(i) || tryRoman(i) : 0);
    i += k || 1;
  }

  const ttsWords: string[] = [];
  const displayToTts: [number, number][] = [];
  for (const piece of out) {
    const toks = tokensOf(piece);
    displayToTts.push([ttsWords.length, ttsWords.length + toks.length]);
    ttsWords.push(...toks);
  }
  return { ttsText: ttsWords.join(" "), ttsWords, displayToTts };
}
