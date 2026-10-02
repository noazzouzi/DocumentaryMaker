// Small text helpers shared by lint, beat validation and fact-check rules.
import { tokenizeDisplay, type Person } from "@docmaker/core";

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

/**
 * True when `text` names the person: the full name, an alias, or the surname (last name token, ≥ 4 letters).
 * Matching is token-based (accent/case-insensitive), so "Clusius" does not match "Clusiusstraat".
 */
export function mentionsPerson(text: string, p: Pick<Person, "name" | "aliases">): boolean {
  const toks = nameTokens(text);
  if (toks.length === 0) return false;
  const hay = ` ${toks.join(" ")} `;
  const candidates = [p.name, ...p.aliases].map(nameTokens).filter((t) => t.length > 0);
  for (const c of candidates) if (hay.includes(` ${c.join(" ")} `)) return true;
  const full = nameTokens(p.name);
  const surname = full[full.length - 1];
  if (full.length > 1 && surname && surname.length >= 4 && toks.includes(surname)) return true;
  return false;
}

/** All string leaves of a motion-data object (display strings), skipping id/enum keys. */
export function motionStrings(v: unknown, key = ""): string[] {
  const SKIP = /(^|_)(id|ids|kind|variant|region|format|currency|handle|query)$/;
  if (typeof v === "string") return SKIP.test(key) || v.trim() === "" ? [] : [v];
  if (Array.isArray(v)) return v.flatMap((x) => motionStrings(x, key));
  if (v && typeof v === "object") return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => motionStrings(x, k));
  return [];
}

