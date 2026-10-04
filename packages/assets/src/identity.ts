// Identity evidence (§7.4): does a candidate actually show a named person? Used before an image becomes someone's portrait
// and to stop a lone surname token ("Mackay" → "Mackay Island Wildlife Refuge") from counting as a text match.
import type { Candidate, Person } from "@docmaker/core";
import { tokensOf } from "./util";

/** Name particles that may be dropped or written differently ("Charles de l'Écluse", "Vincent van Gogh"). */
const PARTICLES = new Set(["de", "da", "di", "du", "des", "del", "della", "van", "von", "der", "den", "la", "le", "of", "the", "y", "al", "bin", "ibn"]);

/** Token sets that identify a person: the full name and multi-word aliases (single-token aliases only for one-word names). */
export function personNameTokenSets(p: Pick<Person, "name" | "aliases">): string[][] {
  const sets: string[][] = [];
  const add = (s: string, allowSingle: boolean) => {
    const t = [...new Set(tokensOf(s).filter((x) => !PARTICLES.has(x)))];
    if (t.length === 0 || (t.length === 1 && !allowSingle)) return;
    if (!sets.some((x) => x.length === t.length && x.every((y) => t.includes(y)))) sets.push(t);
  };
  const single = tokensOf(p.name).filter((x) => !PARTICLES.has(x)).length <= 1;
  add(p.name, true);
  for (const a of p.aliases) add(a, single);
  return sets;
}

/** true when the candidate's title, description or tags carry one of the person's full names (every token of it). */
export function candidateNamesPerson(c: Pick<Candidate, "title" | "tags" | "description">, p: Pick<Person, "name" | "aliases">): boolean {
  const have = new Set([...tokensOf(c.title), ...tokensOf(c.description), ...c.tags.flatMap((t) => tokensOf(t))]);
  return personNameTokenSets(p).some((set) => set.every((t) => have.has(t)));
}

// ------------------------------------------------------------------------------------------------ portrait subjects
/** Things named after a person that are not their likeness (EN/FR/DE/NL, singular and plural; Commons category names such
 *  as "Graves of …", "Statues of …", "Coats of arms of …" match too). */
const NOT_A_LIKENESS: readonly [string, RegExp][] = [
  ["grave", /\b(?:graves?|gravestones?|grave ?markers?|headstones?|tombs?|tombstones?|sepulchres?|sepulchers?|mausoleums?|mausolea|cenotaphs?|cemetery|cemeteries|graveyards?|burial (?:place|site|plot)s?|epitaphs?|funerary monuments?|tombes?|tombeaux|sepultures?|pierres? tombales?|cimetieres?|mausolees?|epitaphes?|grab|grabs?tein\w*|grabmal\w*|grabstatte\w*|grabstelle\w*|grabplatte\w*|grabdenkmal\w*|gruft|friedhof\w*|grafstenen?|grafsteen|grafmonument\w*|grafzerk\w*|begraafplaats\w*|kerkhof\w*)\b/],
  ["statue", /\b(?:statues?|statuettes?|sculptures?|sculpted|busts?(?![- ]?(?:length|portraits?))|monuments?|memorials?|standbeeld\w*|borstbeeld\w*|beeldhouwwerk\w*|bustes?|denkmal\w*|skulptur\w*)\b/],
  ["plaque", /\b(?:plaques?|gedenktafel\w*|gedenkplaat\w*|gedenksteen\w*|plaquettes?)\b/],
  ["house", /\b(?:houses?|birthplace|birth ?house|residence|home of|maisons?|maison natale|haus|hauser|geburtshaus|wohnhaus|sterbehaus|huis|huizen|geboortehuis|woonhuis)\b/],
  ["signature", /\b(?:signatures?|autographs?|unterschrift\w*|signatur|handtekening\w*)\b/],
  ["coat of arms", /\b(?:coats? of arms|arms of|heraldry|heraldic|escutcheons?|armoiries|blasons?|wappen\w*|wapens?|wapenschild\w*|familiewapen\w*)\b/],
];
const GRAVE_RE = NOT_A_LIKENESS[0]![1];
/** Publications and papers named after a person (a book's pages, a letter, a stamp): only from a title that does not
 *  announce a likeness (a "frontispiece portrait" is one). */
const DOCUMENT_TITLE = /\b(?:books?|title ?pages?|pages?|covers?|volumes?|vol|editions?|collected|works|songs|poems|memoirs|letters?|manuscripts?|handwriting|newspapers?|magazines?|articles?|pamphlets?|posters?|stamps?|banknotes?|coins?|maps?|deeds?|contracts?|livres?|lettres?|manuscrits?|buch|bucher|brief|briefe|handschrift|boek|boeken|brieven|postzegels?|briefmarken?|timbres?)\b/;
/** A title that announces a likeness ("Portrait of…", "Bildnis…", an engraving or a photograph of the person). */
const LIKENESS_TITLE = /\b(?:portraits?|portret\w*|portrat\w*|bildnis\w*|photo|photos|photograph\w*|engraving|gravure|lithograph\w*|miniature|daguerreotype|carte de visite)\b/;

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/_+/g, " ");

/**
 * What a candidate shows instead of a person's likeness ("grave", "statue", "plaque", "house", "signature", "coat of arms",
 * "document" — a book page, letter, stamp…), or
 * null when nothing says so. The title decides first; tags (Commons categories) and the description only add evidence when
 * the title does not announce a likeness — and then only funerary words count in the free description ("bust-length
 * portrait", "signed lower right" do not). Such images may illustrate a beat about the person but never stand as their
 * portrait (quote, lower-third and social-post portrait slots, picks.portraits).
 */
export function nonLikenessSubject(c: Pick<Candidate, "title" | "tags" | "description">): string | null {
  const title = fold(c.title);
  for (const [label, re] of NOT_A_LIKENESS) if (re.test(title)) return label;
  if (LIKENESS_TITLE.test(title)) return GRAVE_RE.test(fold(c.tags.join(" | "))) ? "grave" : null;
  if (DOCUMENT_TITLE.test(title)) return "document";
  const tags = fold(c.tags.join(" | "));
  for (const [label, re] of NOT_A_LIKENESS) if (re.test(tags)) return label;
  return GRAVE_RE.test(fold(c.description)) ? "grave" : null;
}
