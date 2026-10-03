// Isomorphic fact-check helpers mirroring the engine's gate rules (§5.4): what blocks, what can only be fixed.
import { docHash, hashJson, type FactCheck, type FactCheckItem, type RiskFlag, type Script } from "@docmaker/core";

export const NOTE_MIN = 10;
const GATING_RISK_FLAGS: readonly RiskFlag[] = ["real_person_allegations", "sexual_violence", "ongoing_trial"];

/** quote_mismatch and high-risk unverified quotes can only be fixed in the text. */
export const fixOnly = (it: FactCheckItem): boolean => it.verdict === "quote_mismatch" || (it.verdict === "unverified_quote" && it.risk === "high");

export function gatingItems(fc: FactCheck, riskFlags: readonly RiskFlag[]): FactCheckItem[] {
  const mediums = riskFlags.some((f) => GATING_RISK_FLAGS.includes(f));
  return fc.items.filter((it) => it.risk === "high" || (mediums && it.risk === "medium"));
}

export const itemSatisfied = (it: FactCheckItem): boolean =>
  it.resolution === "rewritten" || (!fixOnly(it) && (it.resolution === "acknowledged" || it.resolution === "dismissed") && it.note.trim().length >= NOTE_MIN);

/** Stale when the checked script / slices / publish info changed since the check. */
export function factcheckStale(fc: FactCheck, script: Script | null, slicesDocHash: string | null, publish: unknown): string[] {
  const reasons: string[] = [];
  if (script && fc.scriptHash !== docHash(script)) reasons.push("script");
  if (slicesDocHash && fc.slicesHash !== slicesDocHash) reasons.push("on-screen text");
  if (publish !== undefined && fc.publishHash !== hashJson(publish ?? null)) reasons.push("publish");
  return reasons;
}

/** Duplicate notes (case-insensitive) among the given item notes → the ids sharing one. */
export function duplicateNotes(notes: Record<string, string>): string[][] {
  const by = new Map<string, string[]>();
  for (const [id, n] of Object.entries(notes)) {
    const k = n.trim().toLowerCase();
    if (!k) continue;
    by.set(k, [...(by.get(k) ?? []), id]);
  }
  return [...by.values()].filter((ids) => ids.length > 1);
}

/** Replaces the first occurrence of `sentence` in `text` (whitespace-tolerant). Null when not found. */
export function applyRewrite(text: string, sentence: string, rewrite: string): string | null {
  if (!sentence.trim()) return null;
  const i = text.indexOf(sentence);
  if (i >= 0) return text.slice(0, i) + rewrite + text.slice(i + sentence.length);
  const esc = sentence.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const m = new RegExp(esc).exec(text);
  if (!m) return null;
  return text.slice(0, m.index) + rewrite + text.slice(m.index + m[0].length);
}
