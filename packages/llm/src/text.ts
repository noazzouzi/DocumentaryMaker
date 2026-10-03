// Small text helpers shared by lint, beat validation and fact-check rules.
import { normWord, tokenizeDisplay, type Person } from "@docmaker/core";

/** Whitespace-normalised comparison form. */
export const normWs = (s: string): string => s.replace(/\s+/gu, " ").trim();

/** Token-normalised form (tokenizeDisplay norms joined by a space): quotes, case, accents and punctuation ignored. */
export const normText = (s: string): string => tokenizeDisplay(s).map((w) => w.norm).join(" ");

/** Levenshtein similarity in [0, 1] on token-normalised strings. */
export function similarity(a: string, b: string): number {
  const x = normText(a);
  const y = normText(b);
  if (x === y) return 1;
  if (x.length === 0 || y.length === 0) return 0;
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - prev[y.length]! / Math.max(x.length, y.length);
}

function nameTokens(s: string): string[] {
  return tokenizeDisplay(s).map((w) => w.norm).filter((n) => n !== "");
}

/** Letter runs of a text (hyphens, apostrophes and punctuation split words: "Emily's" → Emily, s). */
const LETTER_RUN = /[\p{L}\p{M}]+/gu;
/** Single name tokens of a blocked person that count on their own (first names and short surnames included). */
const MIN_BLOCKED_TOKEN = 2;

export interface MentionOptions {
  /**
   * Blocked person (minor, private victim, non-public person without a person-ack): any CAPITALISED word equal to one
   * of their name tokens (≥ 2 letters) counts — "Emily, then 14, …" names Emily Ross; "Lee was 12." names Mia Lee.
   */
  strict?: boolean;
  /** Normalised name tokens shared with people who are NOT blocked: never matched on their own. */
  ignoreTokens?: ReadonlySet<string>;
}

/** Normalised single name tokens (≥ 2 letters) of a person's name and aliases. */
export function personNameTokens(p: Pick<Person, "name" | "aliases">): string[] {
  const out = new Set<string>();
  for (const n of [p.name, ...p.aliases]) for (const m of n.matchAll(LETTER_RUN)) {
    const t = normWord(m[0]);
    if ([...t].length >= MIN_BLOCKED_TOKEN) out.add(t);
  }
  return [...out];
}

/** Name tokens of the people outside `blocked` (a shared surname of a public relative is not matched alone). */
export function sharedNameTokens(people: readonly Pick<Person, "id" | "name" | "aliases">[], blocked: readonly Pick<Person, "id">[]): Set<string> {
  const ids = new Set(blocked.map((p) => p.id));
  return new Set(people.filter((p) => !ids.has(p.id)).flatMap((p) => personNameTokens(p)));
}

/**
 * True when `text` names the person: the full name, an alias, or the surname (last name token, ≥ 4 letters); with
 * `strict` (blocked persons) also any capitalised name token of ≥ 2 letters, first names included.
 * Matching is token-based (accent/case-insensitive), so "Clusius" does not match "Clusiusstraat".
 */
export function mentionsPerson(text: string, p: Pick<Person, "name" | "aliases">, o: MentionOptions = {}): boolean {
  const toks = nameTokens(text);
  if (toks.length === 0) return false;
  const hay = ` ${toks.join(" ")} `;
  const candidates = [p.name, ...p.aliases].map(nameTokens).filter((t) => t.length > 0);
  for (const c of candidates) if (hay.includes(` ${c.join(" ")} `)) return true;
  const full = nameTokens(p.name);
  const surname = full[full.length - 1];
  if (full.length > 1 && surname && surname.length >= 4 && !o.ignoreTokens?.has(surname) && toks.includes(surname)) return true;
  if (o.strict) {
    const own = new Set(personNameTokens(p).filter((t) => !o.ignoreTokens?.has(t)));
    if (own.size === 0) return false;
    for (const m of text.matchAll(LETTER_RUN)) {
      if (/^\p{Lu}/u.test(m[0]) && own.has(normWord(m[0]))) return true;
    }
  }
  return false;
}

/**
 * Replaces every mention of the given persons in `text` with `[private person <id>]`: capitalised name tokens
 * (≥ 2 letters, not shared with other people) in prose; any case inside URLs. Used to keep the names of minors and
 * private victims out of every prompt.
 */
export function maskPersons(text: string, blocked: readonly Pick<Person, "id" | "name" | "aliases">[], ignoreTokens: ReadonlySet<string> = new Set()): string {
  if (text === "" || blocked.length === 0) return text;
  const byToken = new Map<string, string>();
  for (const p of blocked) for (const t of personNameTokens(p)) if (!ignoreTokens.has(t) && !byToken.has(t)) byToken.set(t, p.id);
  if (byToken.size === 0) return text;
  const url = /^[a-z][a-z0-9+.-]*:\/\//i.test(text.trim());
  const replaced = text.replace(LETTER_RUN, (w) => {
    const id = byToken.get(normWord(w));
    return id && (url || /^\p{Lu}/u.test(w)) ? `\u0000${id}\u0000` : w;
  });
  // "Emily Ross" → one placeholder, not two
  return replaced
    .replace(/\u0000(P\d+)\u0000(?:[\s\-]+\u0000\1\u0000)+/gu, "\u0000$1\u0000")
    .replace(/\u0000(P\d+)\u0000/gu, (_m, id: string) => (url ? `private-person-${id}` : `[private person ${id}]`));
}

/** All string leaves of a motion-data object (display strings), skipping id/enum keys. */
export function motionStrings(v: unknown, key = ""): string[] {
  const SKIP = /(^|_)(id|ids|kind|variant|region|format|currency|handle|query)$/;
  if (typeof v === "string") return SKIP.test(key) || v.trim() === "" ? [] : [v];
  if (Array.isArray(v)) return v.flatMap((x) => motionStrings(x, key));
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => motionStrings(x, k));
  return [];
}

