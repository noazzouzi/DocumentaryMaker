// AI-image denylist (fal): names, name tokens, aliases and quote speakers never reach an image prompt (§7.4).
import { normWord } from "@docmaker/core";
import type { BeatPlan, EntitiesDoc, FactSheet } from "@docmaker/core";

export const PHOTOREAL_VOCABULARY: readonly string[] = [
  "photo", "photograph", "photorealistic", "realistic", "portrait", "celebrity", "actor", "actress", "real person",
];
export const FAL_PROMPT_SUFFIX = ", flat editorial illustration, painterly, graphic shapes, no real people, no faces";
export const FAL_NEGATIVE_PROMPT = "photo, photorealistic, face, celebrity, text, watermark";

function baseWords(s: string): string[] {
  return s.split(/[\s\-‐–—_/.,;:!?()[\]{}"“”«»]+/u).map(normWord).filter((x) => x !== "");
}

/** normWord tokens; elided forms also yield their parts (l'Écluse → l'ecluse, ecluse; O'Brien → o'brien, brien). */
function words(s: string): string[] {
  const out: string[] = [];
  for (const w of s.split(/[\s\-‐–—_/.,;:!?()[\]{}"“”«»]+/u).map(normWord).filter((x) => x !== "")) {
    out.push(w);
    if (w.includes("'")) for (const part of w.split("'")) if ([...part].length >= 3) out.push(part);
  }
  return out;
}

/** normWord tokens (≥ 3 chars) of every person's full name, each name token, Wikidata aliases and quote speakers;
 *  multi-word names are also kept as normalised phrases. */
export function buildAiDenylist(facts: FactSheet, entities: EntitiesDoc): Set<string> {
  const out = new Set<string>();
  const add = (name: string) => {
    for (const w of words(name)) if ([...w].length >= 3) out.add(w);
    const base = baseWords(name);
    if (base.length > 1) out.add(base.join(" "));
  };
  const speakers = new Set(facts.quotes.map((q) => q.speakerId));
  for (const p of facts.people) {
    add(p.name);
    for (const a of p.aliases) add(a);
    if (speakers.has(p.id)) add(p.name);
  }
  for (const e of entities.entities) {
    add(e.label);
    for (const a of e.aliases) add(a);
  }
  return out;
}

/** Rejects prompts naming a denylisted person or asking for photorealism. */
export function checkFalPrompt(prompt: string, denylist: ReadonlySet<string>): { ok: boolean; reason: string | null } {
  const ws = words(prompt);
  if (ws.length === 0) return { ok: false, reason: "empty prompt" };
  const singular = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
  const joined = ` ${baseWords(prompt).join(" ")} `;
  for (const w of ws) {
    if (denylist.has(w) || denylist.has(singular(w))) return { ok: false, reason: `prompt names a real person ("${w}")` };
  }
  for (const entry of denylist) if (entry.includes(" ") && joined.includes(` ${entry} `)) return { ok: false, reason: `prompt names a real person ("${entry}")` };
  for (const v of PHOTOREAL_VOCABULARY) {
    if (v.includes(" ")) {
      if (joined.includes(` ${v} `)) return { ok: false, reason: `photoreal vocabulary ("${v}")` };
    } else if (ws.some((w) => w === v || singular(w) === v)) {
      return { ok: false, reason: `photoreal vocabulary ("${v}")` };
    }
  }
  return { ok: true, reason: null };
}

/** fal is disabled for beats with people or PERSON_INTRO / SENSITIVE cues. */
export function falAllowedForBeat(plan: Pick<BeatPlan, "personIds" | "cueTags">): boolean {
  return plan.personIds.length === 0 && !plan.cueTags.some((c) => c.type === "PERSON_INTRO" || c.type === "SENSITIVE");
}

/** The prompt actually sent to fal (fixed non-photoreal suffix). */
export function falPrompt(visualQuery: string): string {
  return `${visualQuery.trim()}${FAL_PROMPT_SUFFIX}`;
}
