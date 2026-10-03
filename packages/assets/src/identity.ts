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
