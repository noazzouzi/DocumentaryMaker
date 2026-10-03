// Person privacy for outgoing searches (§4.3, §6, §7.3): a minor / private victim is never searched; a non-public person
// only after the person-ack gate. Applies to EVERY query text, whether or not the beat lists the person in personIds.
import { normWord } from "@docmaker/core";
import type { FactSheet, Person } from "@docmaker/core";

export function isBlockedPerson(p: Pick<Person, "id" | "isMinorOrPrivateVictim" | "publicFigure">, personAcks: readonly string[]): boolean {
  return p.isMinorOrPrivateVictim || (!p.publicFigure && !personAcks.includes(p.id));
}

/** Every person of the fact sheet whose identity must not leave the machine. */
export function blockedPersons(facts: Pick<FactSheet, "people"> | null | undefined, personAcks: readonly string[]): Person[] {
  return (facts?.people ?? []).filter((p) => isBlockedPerson(p, personAcks));
}

const MIN_TOKEN = 2;
/** Normalised word without a possessive suffix ("Minorly's" → "minorly"). */
const tok = (w: string) => normWord(w).replace(/'s$/, "");
const tokensOf = (s: string) => s.split(/\s+/).map(tok).filter((t) => t.length > 0);

export interface NameStripper {
  /** Removes blocked names (full names/aliases first, then their single tokens). */
  strip(text: string): string;
  /** true when the text mentions a blocked person (any of their name tokens). */
  mentions(text: string): boolean;
  readonly blocked: readonly Person[];
}

/**
 * Builds a stripper for the blocked persons of a fact sheet. Full name/alias sequences are removed first; remaining single
 * tokens of blocked names are removed too, except tokens that also belong to an allowed person's name (a public parent
 * sharing a surname keeps it; the full blocked name is still removed by the phrase pass).
 */
export function nameStripper(facts: Pick<FactSheet, "people"> | null | undefined, personAcks: readonly string[], extraBlocked: readonly Person[] = []): NameStripper {
  const blockedMap = new Map<string, Person>();
  for (const p of [...blockedPersons(facts, personAcks), ...extraBlocked]) blockedMap.set(p.id, p);
  const blocked = [...blockedMap.values()];
  const phrases: string[][] = [];
  const badTokens = new Set<string>();
  for (const p of blocked) {
    for (const n of [p.name, ...p.aliases]) {
      const t = tokensOf(n);
      if (t.length > 0) phrases.push(t);
      for (const x of t) if (x.length >= MIN_TOKEN) badTokens.add(x);
    }
  }
  const allowedTokens = new Set<string>();
  for (const p of facts?.people ?? []) {
    if (blockedMap.has(p.id)) continue;
    for (const n of [p.name, ...p.aliases]) for (const x of tokensOf(n)) allowedTokens.add(x);
  }
  // A single-token name of a blocked person is always removed (it IS the full name).
  const singleNames = new Set(phrases.filter((ph) => ph.length === 1).map((ph) => ph[0]!));
  const looseTokens = new Set([...badTokens].filter((t) => !allowedTokens.has(t) || singleNames.has(t)));
  phrases.sort((a, b) => b.length - a.length);

  function keepMask(words: string[]): boolean[] {
    const norm = words.map(tok);
    const keep = words.map(() => true);
    for (const ph of phrases) {
      if (ph.length < 2) continue;
      for (let i = 0; i + ph.length <= norm.length; i++) {
        if (ph.every((t, k) => norm[i + k] === t)) for (let k = 0; k < ph.length; k++) keep[i + k] = false;
      }
    }
    for (let i = 0; i < norm.length; i++) if (looseTokens.has(norm[i]!)) keep[i] = false;
    return keep;
  }

  return {
    blocked,
    strip(text: string): string {
      if (blocked.length === 0) return text;
      const words = text.split(/\s+/).filter((w) => w.length > 0);
      const keep = keepMask(words);
      return words.filter((_, i) => keep[i]).join(" ").trim();
    },
    mentions(text: string): boolean {
      if (blocked.length === 0) return false;
      const words = text.split(/\s+/).filter((w) => w.length > 0);
      return keepMask(words).some((k) => !k);
    },
  };
}
