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

/** true when one field carries every token of `set` side by side, in any order ("Charles Mackay", "Mackay, Charles"; name
 *  particles skipped) — not scattered words ("the Charles Kuralt Overlook on Mackay Island"). */
function fieldNames(field: string, set: readonly string[]): boolean {
  const t = tokensOf(field).filter((x) => !PARTICLES.has(x));
  for (let i = 0; i + set.length <= t.length; i++) {
    const win = t.slice(i, i + set.length);
    if (set.every((x) => win.includes(x))) return true;
  }
  return false;
}

/** true when the candidate's title, description or one of its tags carries one of the person's full names (its tokens side
 *  by side within one field). */
export function candidateNamesPerson(c: Pick<Candidate, "title" | "tags" | "description">, p: Pick<Person, "name" | "aliases">): boolean {
  const fields = [c.title, c.description, ...c.tags];
  return personNameTokenSets(p).some((set) => fields.some((f) => fieldNames(f, set)));
}

/**
 * How strongly a candidate that names a person shows their likeness: 2 = a "Portraits of <name>" category or a "Depicted
 * person: <name>" statement; 1 = a title announcing a likeness (portrait, engraving, photograph…); 0 = only the name. A
 * Commons category qualifying a namesake ("<name> (mayor)", "<name> (Scottish actor)") whose words are not in the person's
 * role in the story costs 2 (a homonym), as does a place the story never mentions (`foreignPlace`, from the caller).
 */
export function likenessEvidence(c: Pick<Candidate, "title" | "tags" | "description">, p: Pick<Person, "name" | "aliases"> & { roleInStory?: string }): number {
  const sets = personNameTokenSets(p);
  const named = (s: string) => sets.some((set) => fieldNames(s, set));
  let score = 0;
  if (c.tags.some((t) => /^(?:portraits?|portrait photographs?|photographs?|paintings?|engravings?|portretten|portraits de|bildnisse) of\b/i.test(t) && named(t))
    || /depicted person\s*:/i.test(c.description) && named(c.description.split(/depicted person\s*:/i)[1]!.slice(0, 80))) score = 2;
  else if (LIKENESS_TITLE.test(fold(c.title))) score = 1;
  const role = new Set(tokensOf(p.roleInStory ?? ""));
  if (role.size > 0) {
    for (const t of c.tags) {
      const m = /^(.*)\(([^)]+)\)\s*$/.exec(t);
      if (!m || !named(m[1]!)) continue;
      const q = tokensOf(m[2]!).filter((x) => x.length > 2 && !role.has(x) && !QUALIFIER_IGNORE.has(x));
      if (q.length > 0 && !tokensOf(m[2]!).some((x) => role.has(x) && !QUALIFIER_IGNORE.has(x))) score -= 2;
    }
  }
  return score;
}
/** Nationality words in a namesake's qualifier say nothing about who they are ("Scottish actor" vs "Scottish journalist"). */
const QUALIFIER_IGNORE = new Set(["scottish", "english", "british", "irish", "welsh", "american", "french", "german", "dutch", "flemish", "italian", "spanish", "born", "the", "and"]);

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
