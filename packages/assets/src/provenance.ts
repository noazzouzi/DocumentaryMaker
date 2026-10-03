// Provenance heuristics (§7.4): uploader-declared licences are only trusted where the archive curates them, and obvious
// commercial film/TV material (franchises, episodes, rips) never enters the candidate list whatever licence it claims.
import type { Candidate } from "@docmaker/core";

/** Internet Archive collections whose items' licence metadata is curated (staff/institutional uploads). */
export const IA_TRUSTED_COLLECTIONS: ReadonlySet<string> = new Set([
  "prelinger", "prelinger_library", "prelingerhomemovies", "publicdomainmovies", "feature_films", "fedflix", "nasa",
  "usnationalarchives", "national_archives", "smithsonian", "library_of_congress", "biodiversity", "flickrcommons",
]);
/** Open-upload collections: anyone can upload anything and pick any licence URL. */
export const IA_COMMUNITY_COLLECTIONS: ReadonlySet<string> = new Set([
  "opensource_movies", "opensource", "opensource_media", "opensource_image", "opensource_audio", "community", "communitymedia",
  "community_media", "test_collection",
]);

/** true when an Internet Archive item's licence URL can be believed: a curated collection and no open-upload collection. */
export function iaLicenceTrusted(collections: readonly string[]): boolean {
  const c = collections.map((x) => x.trim().toLowerCase()).filter(Boolean);
  return c.some((x) => IA_TRUSTED_COLLECTIONS.has(x)) && !c.some((x) => IA_COMMUNITY_COLLECTIONS.has(x));
}

const FRANCHISES = [
  "family guy", "simpsons", "south park", "futurama", "american dad", "bob's burgers", "king of the hill", "spongebob", "rick and morty",
  "game of thrones", "breaking bad", "star wars", "star trek", "marvel studios", "marvel comics", "avengers", "disney", "pixar", "dreamworks", "harry potter",
  "pokemon", "pokémon", "looney tunes", "tom and jerry", "scooby-doo", "seinfeld", "doctor who", "james bond",
  "warner bros", "paramount pictures", "universal pictures", "20th century fox", "fox broadcasting", "hbo", "netflix", "nickelodeon",
  "cartoon network", "adult swim", "comedy central", "bbc one", "itv", "sky atlantic",
];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const FRANCHISE_RE = new RegExp(`(^|[^\\p{L}\\p{N}])(${FRANCHISES.map(esc).join("|")})($|[^\\p{L}\\p{N}])`, "iu");
/** Episode numbering, full-length releases and rip tags. */
const RELEASE_RE = /\bS\d{1,2}\s?E\d{1,3}\b|\bseason\s+\d+\s*,?\s*episode\b|\bepisode\s+\d+\b|\bfull\s+(episode|movie|film)\b|\b(dvd|bd|br|web|hd)rip\b|\bhdtv\b|\bx26[45]\b|\bblu-?ray\b/i;

/** The matched reason when a candidate looks like commercial film/TV material, else null. */
export function commercialMediaHint(c: Pick<Candidate, "title" | "tags" | "description">): string | null {
  for (const text of [c.title, ...c.tags, c.description]) {
    const f = FRANCHISE_RE.exec(text);
    if (f) return f[2]!.toLowerCase();
    const r = RELEASE_RE.exec(text);
    if (r) return r[0].toLowerCase();
  }
  return null;
}

/** Providers whose results come from open uploads or the open web (local imports, generated media and clips are exempt). */
export function needsProvenanceCheck(provider: string): boolean {
  return !["local", "procedural", "fal", "youtube"].includes(provider);
}
