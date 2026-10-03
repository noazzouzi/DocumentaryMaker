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
/** Sub-unit words, used when the amount is below one unit ("$0.50" → "fifty cents"). */
const SUBUNIT: Record<Cur, Record<Lang, readonly [string, string]>> = {
  "€": { en: ["cent", "cents"], fr: ["centime", "centimes"] },
  $: { en: ["cent", "cents"], fr: ["cent", "cents"] },
  "£": { en: ["penny", "pence"], fr: ["penny", "pence"] },
  ƒ: { en: ["cent", "cents"], fr: ["cent", "cents"] },
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

/**
 * Weaker year context: "1636 and 1637", "from 1636 to 1637", "the 1929 crash", a sentence start ("1637 marked the end"),
 * after a dash. A following plural noun still makes it a cardinal ("the 1500 soldiers", "1500 soldiers marched").
 */
const PAIR_WORDS = new Set(["and", "or", "to", "et", "ou", "à"]);
const WEAK_YEAR_CONTEXT = new Set(["and", "or", "to", "the", "a", "et", "ou", "à", "au", "aux", "la", "le", "l'", "l’"]);
/** Lowercase words ending in s/x that are not plural count nouns (verbs, function words) after a year. */
const NOT_PLURAL = new Set([
  "is", "was", "has", "does", "as", "its", "his", "this", "thus", "plus", "sans", "dans", "sous", "vers", "puis", "alors", "après",
  "depuis", "chez", "mais", "jamais", "toujours", "marks", "sees", "brings", "begins", "ends", "remains", "changes", "becomes",
  "starts", "proves", "follows", "comes", "goes", "gives", "makes", "takes", "opens", "closes", "sets", "ushers", "heralds",
  "signals", "witnesses", "sees", "puts", "leaves", "turns", "lies", "stays", "es", "fus", "vis",
]);
const looksPluralNoun = (w: string | null) =>
  w !== null && /^\p{Ll}[\p{L}'’-]+[sx]$/u.test(w) && !/(?:ss|us)$/u.test(w) && !NOT_PLURAL.has(w.toLocaleLowerCase());

/** EN words after which a Roman numeral is a cardinal ("World War Two", "Apollo eleven", "Chapter two"). */
const ROMAN_CARDINAL_EN = new Set([
  "war", "part", "chapter", "act", "scene", "apollo", "gemini", "mercury", "saturn", "phase", "title", "vatican", "volume", "book",
  "section", "article", "episode", "round", "level", "stage", "class", "type", "mark", "grade", "schedule", "appendix", "annex",
  "canto", "psalm", "rocky", "series", "season", "council", "amendment", "division", "corps", "army", "legion", "fleet", "table",
  "figure", "plate", "case", "tier", "category", "sector", "zone", "block", "unit", "model", "version", "liber", "lot", "op",
]);
/** FR series words: Roman numerals are cardinals in FR anyway; listed so that single letters are read ("Partie I"). */
const ROMAN_CARDINAL_FR = new Set([
  "guerre", "partie", "chapitre", "acte", "scène", "tome", "livre", "volume", "titre", "article", "annexe", "phase", "concile",
  "vatican", "apollo", "saison", "épisode", "série", "classe", "type", "niveau", "stade", "planche", "figure", "tableau", "légion",
]);
/** Titles that make the next capitalised word a ruler's name ("Pope Leo XIII", "Pharaoh Ramesses II", "le roi Louis XVI"). */
const ROMAN_TITLES = new Set([
  "king", "queen", "pope", "emperor", "empress", "tsar", "czar", "tsarina", "tsaritsa", "sultan", "pharaoh", "shah", "kaiser", "duke",
  "duchess", "prince", "princess", "saint", "st", "antipope", "patriarch", "count", "countess", "elector", "margrave", "khan", "caliph",
  "roi", "reine", "pape", "empereur", "impératrice", "tsarine", "sultan", "pharaon", "duc", "duchesse", "comte", "comtesse",
]);
/** Rulers' given names that take a regnal number (EN reading "the eighth"; FR "huit"). Lowercase. */
const REGNAL_NAMES = new Set([
  "henry", "henri", "louis", "charles", "george", "edward", "william", "james", "richard", "john", "jean", "philip", "philippe", "elizabeth",
  "mary", "anne", "victoria", "frederick", "frédéric", "friedrich", "wilhelm", "ludwig", "otto", "rudolf", "rodolphe", "maximilian", "leopold",
  "léopold", "francis", "françois", "franz", "joseph", "peter", "pierre", "pyotr", "paul", "catherine", "ivan", "nicholas", "nicolas",
  "alexander", "alexandre", "alfonso", "alphonse", "ferdinand", "carlos", "juan", "pedro", "felipe", "fernando", "isabella", "isabelle",
  "gustav", "gustave", "gustavus", "christian", "frederik", "olaf", "haakon", "eric", "erik", "magnus", "sancho", "ramesses", "ramses",
  "amenhotep", "thutmose", "seti", "ptolemy", "ptolémée", "antiochus", "seleucus", "mehmed", "mehmet", "selim", "suleiman", "murad",
  "bayezid", "mahmud", "abdulhamid", "constantine", "constantin", "justinian", "justinien", "michael", "michel", "basil", "basile", "leo",
  "léon", "gregory", "grégoire", "benedict", "benoît", "innocent", "clement", "clément", "pius", "pie", "urban", "urbain", "boniface",
  "sixtus", "sixte", "julius", "jules", "martin", "eugene", "eugène", "adrian", "hadrian", "adrien", "celestine", "célestin", "honorius",
  "nicholas", "callixtus", "calixte", "stephen", "étienne", "edmund", "harold", "robert", "david", "malcolm", "margaret", "marguerite",
  "christina", "christine", "sigismund", "sigismond", "casimir", "stanislaus", "stanislas", "vladislaus", "ladislas", "wenceslaus",
  "venceslas", "matthias", "hugh", "hugues", "baldwin", "baudouin", "godfrey", "amadeus", "amédée", "umberto", "humbert",
  "victor", "manuel", "afonso", "joão", "sebastian", "rama", "napoleon", "napoléon", "lothair", "lothaire", "conrad", "heinrich",
  "albert", "albrecht", "charlemagne", "pepin", "pépin", "childeric", "childéric", "clovis", "dagobert", "carloman", "philipp",
]);
const capitalise = (w: string) => (w === "" ? w : w[0]!.toUpperCase() + w.slice(1));

/** Words after which a 4-digit number is a cardinal even when it ends a sentence ("page 2017.", "n° 1234"). */
const CARDINAL_CONTEXT = new Set([
  "page", "pages", "p", "pp", "no", "nos", "n", "nº", "number", "numbers", "numéro", "numéros", "num", "room", "chambre", "article", "art",
  "line", "lines", "ligne", "lignes", "vol", "volume", "tome", "issue", "item", "lot", "code", "folio", "fol", "plate", "planche", "figure",
  "fig", "note", "footnote", "verse", "verset", "box", "carton", "dossier", "file", "inv", "inventory", "inventaire", "cote", "ms",
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

/** Index of the nearest non-empty word before i (-1 at the start). */
function prevIndex(words: string[], i: number): number {
  for (let k = i - 1; k >= 0; k--) if (words[k] !== "") return k;
  return -1;
}
/** Trailing punctuation of the nearest non-empty word before i (null at the start). */
function neighbourPost(words: string[], i: number): string | null {
  const k = prevIndex(words, i);
  return k < 0 ? null : splitCore(words[k]!).post;
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
  /** Display words read as a year (the second number of "1636 and 1637" follows the first). */
  const readAsYear = new Uint8Array(src.length);

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
  /** Plural of the currency word. With cents read after it ("one euro twenty") only the integer part counts. */
  const amountPlural = (t: NumTok, cents: boolean) => {
    const int = Number(t.int);
    if (lang === "fr") return (cents ? int : Number(`${t.int}.${t.frac ?? 0}`)) >= 2;
    return cents ? int !== 1 : !(int === 1 && !t.frac);
  };

  const tryNumber = (i: number): number => {
    const first = splitCore(src[i]!);
    const tok = parseNumber(first.core, lang, neighbourCore(src, i, 1));
    if (!tok) return 0;
    const W = LANG_WORDS[lang];
    // a minus sign glued to a cardinal: "-5", "−12,5 %" → "minus five", "moins douze virgule cinq pour cent"
    const neg = /[-\u2212]$/u.test(first.pre) && !tok.ordinal && tok.decade === null && !tok.range;
    const numberWord = lang === "fr" ? "numéro" : "number";
    const hash = /#$/u.test(first.pre) && !tok.ordinal && tok.decade === null;
    const lead = neg ? `${first.pre.slice(0, -1)}${W.minus} ` : hash ? `${first.pre.slice(0, -1)}${numberWord} ` : first.pre;
    // "No. 12", "n° 12" → "number twelve", "numéro douze" (abbreviations TTS engines misread)
    if (i > 0 && src[i - 1] !== "" && !done[i - 1] && /^(?:no\.|n[°º]\.?)$/iu.test(splitCore(src[i - 1]!).core + splitCore(src[i - 1]!).post)) {
      const pp = splitCore(src[i - 1]!);
      out[i - 1] = `${pp.pre}${pp.core[0] === "N" ? numberWord[0]!.toUpperCase() + numberWord.slice(1) : numberWord}`;
      done[i - 1] = 1;
    }
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
    const bare = span.length === 1 && !unit && frac === null && !neg && isYearValue(intDigits) && /^\d{4}$/.test(first.core);
    if (bare) {
      const prev = neighbourCore(src, i, -1)?.toLocaleLowerCase(lang) ?? null;
      const prevPost = neighbourPost(src, i);
      const next = neighbourCore(src, i, 1);
      const standalone = next === null || first.post !== "" || /^[\p{Lu}\p{N}]/u.test(next);
      const cardinalCtx = first.pre.endsWith("#") || (prev !== null && CARDINAL_CONTEXT.has(prev));
      // sentence start / after a dash or colon ("… rough. 1637 marked the end", "1636 – 1637")
      const opening = prev === null || /[.!?…:;\-–—]["»”’)\]]*\s*$/u.test(prevPost ?? "") || /^[\-–—]/u.test(first.pre);
      const weak = opening || (prev !== null && WEAK_YEAR_CONTEXT.has(prev));
      // the second year of a pair ("1636 and 1637 prices", "from 1636 to 1637") follows the first one
      const pi = prevIndex(src, i);
      const bi = pi >= 0 ? prevIndex(src, pi) : -1;
      const pairYear = prev !== null && PAIR_WORDS.has(prev) && bi >= 0 && readAsYear[bi] === 1;
      const year = !cardinalCtx && ((prev !== null && YEAR_CONTEXT.has(prev)) || standalone || pairYear || (weak && !looksPluralNoun(next)));
      if (year) readAsYear[i] = 1;
      groupWords = [year ? yearWords(Number(intDigits), lang) : cardinalFromDigits(intDigits, lang)];
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
    const isScaleAt = (k: number) => k < src.length && src[k] !== "" && !done[k] && SCALE_WORDS.has(splitCore(src[k]!).core.toLocaleLowerCase(lang));
    if (pre && isScaleAt(nx)) scaleIdx = nx;
    // a currency token after a written scale word: "5 millions €", "5 million $" → "cinq millions d'euros"
    let scaleUnitIdx = -1;
    if (!unit && lastParts.post === "" && isScaleAt(after) && splitCore(src[after]!).post === "" && after + 1 < src.length && src[after + 1] !== "" && !done[after + 1]) {
      const pc = splitCore(src[after + 1]!);
      if (pc.pre === "" && new RegExp(`^${CUR_RE}$`, "u").test(pc.core)) { scaleIdx = after; scaleUnitIdx = after + 1; }
    }
    const curUnit: Cur | null = unit && unit !== "%" ? unit : scaleUnitIdx >= 0 ? (splitCore(src[scaleUnitIdx]!).core as Cur) : null;
    // FR: an amount ending in a round million/milliard takes "de" ("trois millions d'euros", "un milliard de dollars")
    const roundScale = lang === "fr" && curUnit !== null && scaleIdx < 0 && /[1-9]/.test(intDigits) && /0{6}$/.test(intDigits) && (frac === null || /^0+$/.test(frac));
    const deCur = (w: string) => (/^[aeiouyé]/.test(w) ? `d'${w}` : `de ${w}`);
    // cents read after the currency word ("twelve euros fifty", ".00" silent); other fractions are decimals
    const centsMode = isCur && frac !== null && frac.length === 2 && scaleIdx < 0;
    let cents = centsMode && frac !== "00" ? cardinalFromDigits(frac, lang) : "";
    const decimal = frac !== null && !centsMode ? `${W.point} ${fractionWords(frac, lang)}` : "";
    let unitText = "";
    if (unit === "%") unitText = W.percent;
    else if (unit && centsMode && Number(intDigits) === 0 && cents !== "") {
      // below one unit: "$0.50" → "fifty cents", "0,01 €" → "un centime"
      groupWords = [cents];
      unitText = SUBUNIT[unit as Cur][lang][Number(frac) === 1 ? 0 : 1];
      cents = "";
    } else if (curUnit) {
      const w = curWord(curUnit, scaleIdx >= 0 || amountPlural(value, centsMode));
      unitText = (scaleIdx >= 0 || roundScale) && lang === "fr" ? deCur(w) : w;
    }
    span.forEach((k, n) => {
      const parts = splitCore(src[k]!);
      const isLast = n === span.length - 1;
      const words = [groupWords[n] ?? "", isLast ? decimal : "", isLast && !sepUnit && scaleIdx < 0 ? unitText : "", isLast && !sepUnit ? cents : ""]
        .filter((x) => x !== "").join(" ");
      out[k] = words === "" ? "" : `${n === 0 ? lead : ""}${words}${isLast ? parts.post : ""}`;
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
      if (scaleUnitIdx >= 0) {
        // the currency keeps its own display word: "millions" | "d'euros"
        const pc = splitCore(src[scaleUnitIdx]!);
        out[scaleIdx] = src[scaleIdx]!;
        out[scaleUnitIdx] = `${unitText}${pc.post}`;
        done[scaleIdx] = 1;
        done[scaleUnitIdx] = 1;
        consumed = scaleUnitIdx - i + 1;
      } else {
        out[scaleIdx] = `${ps.pre}${ps.core} ${unitText}${ps.post}`;
        done[scaleIdx] = 1;
        consumed = scaleIdx - i + 1;
      }
    }
    return consumed;
  };

  /**
   * Roman numerals after a capitalised word. FR reads them as cardinals ("Louis quatorze", "Chapitre deux"). EN reads a
   * regnal ordinal only after a known ruler's name or a title ("Henry the eighth", "Pope Leo the thirteenth") and a
   * cardinal after series words ("World War Two", "Apollo eleven", "Chapter two"); anything else is left as written.
   */
  const tryRoman = (i: number): number => {
    const parts = splitCore(src[i]!);
    if (!/^[IVX]{1,5}$/.test(parts.core)) return 0;
    const n = romanToInt(parts.core);
    const pk = prevIndex(src, i);
    const prev = pk >= 0 && !done[pk] ? splitCore(src[pk]!) : null;
    if (!n || n > 30 || !prev || prev.post !== "" || !/^\p{Lu}\p{Ll}/u.test(prev.core)) return 0;
    const prevLc = prev.core.toLocaleLowerCase(lang);
    const ppk = prevIndex(src, pk);
    const pp = ppk >= 0 ? splitCore(src[ppk]!) : null;
    const titled = pp !== null && pp.post === "" && ROMAN_TITLES.has(pp.core.toLocaleLowerCase(lang));
    let say: string | null;
    if (lang === "fr") {
      // single letters only after a name/series word ("Charles V", "Partie I"), never the pronoun-like "I" alone
      say = parts.core.length > 1 || REGNAL_NAMES.has(prevLc) || ROMAN_CARDINAL_FR.has(prevLc) || titled ? cardinalFromDigits(String(n), "fr") : null;
    } else if (ROMAN_CARDINAL_EN.has(prevLc)) {
      // "World War I", "Part I" — a lone "I" only after "World War" or a series word not followed by a lowercase verb
      const nextCore = neighbourCore(src, i, 1);
      const loneI = parts.core === "I" && !(prevLc === "war" && pp?.core === "World") && nextCore !== null && /^\p{Ll}/u.test(nextCore) && parts.post === "";
      const card = cardinalFromDigits(String(n), "en");
      say = loneI ? null : prevLc === "war" ? capitalise(card) : card;
    } else if (REGNAL_NAMES.has(prevLc) || titled) {
      say = `the ${ordinalWords(n, "en")}`;
    } else {
      say = null;
    }
    if (say === null) return 0;
    out[i] = parts.pre + say + parts.post;
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
