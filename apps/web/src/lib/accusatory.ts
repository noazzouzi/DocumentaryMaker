// Quick client-side hint for accusatory wording in titles/thumbnails/descriptions (EN/FR). The authoritative check is the
// engine's fact-check (deterministic rule f + LLM), re-run on save; this only warns while typing.
const TERMS = [
  "fraud", "fraudster", "scam", "scammer", "swindler", "con artist", "criminal", "crook", "liar", "lied", "thief", "stole", "rapist",
  "murderer", "killer", "corrupt", "embezzler", "predator", "abuser", "guilty",
  "escroc", "escroquerie", "arnaque", "arnaqueur", "fraude", "fraudeur", "criminel", "criminelle", "menteur", "menteuse", "a menti",
  "voleur", "voleuse", "a volé", "violeur", "meurtrier", "meurtrière", "assassin", "corrompu", "corrompue", "coupable", "prédateur",
];
const ATTRIBUTION = /\b(alleged(ly)?|accused|according to|charged|convicted|claims?|présumée?s?|accusée?s?|selon|condamnée?s?|mise? en examen)\b/i;

export function accusatoryTerms(text: string): string[] {
  const t = text.toLowerCase();
  const hits = TERMS.filter((w) => new RegExp(`(^|[^\\p{L}])${w.replace(/ /g, "\\s+")}($|[^\\p{L}])`, "u").test(t));
  return hits.length && !ATTRIBUTION.test(text) ? hits : [];
}
