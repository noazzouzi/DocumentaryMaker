// Isomorphic motion-data validation for the scene board JSON editor: MotionData[template] + fact references.
import { MotionData, type FactSheet, type MotionTemplate } from "@docmaker/core";

export interface MotionCheck { ok: boolean; errors: string[]; value: Record<string, unknown> | null }

const REF_KEYS: Record<string, (f: FactSheet) => string[]> = {
  figure_id: (f) => f.figures.map((x) => x.id),
  quote_id: (f) => f.quotes.map((x) => x.id),
  source_id: (f) => f.sources.map((x) => x.id),
  event_id: (f) => f.timeline.map((x) => x.id),
  person_id: (f) => f.people.map((x) => x.id),
};

function walkRefs(v: unknown, facts: FactSheet, path: string, out: string[]): void {
  if (Array.isArray(v)) return v.forEach((x, i) => walkRefs(x, facts, `${path}[${i}]`, out));
  if (typeof v !== "object" || v === null) return;
  for (const [k, x] of Object.entries(v)) {
    const ids = REF_KEYS[k];
    if (ids && typeof x === "string" && x !== "" && !ids(facts).includes(x)) out.push(`${path}${path ? "." : ""}${k}: unknown fact ${x}`);
    else walkRefs(x, facts, `${path}${path ? "." : ""}${k}`, out);
  }
}

export function checkMotionData(template: MotionTemplate, text: string, facts: FactSheet | null): MotionCheck {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : "invalid JSON"], value: null };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ok: false, errors: ["must be a JSON object"], value: null };
  if (template === "none") return { ok: true, errors: [], value: parsed as Record<string, unknown> };
  const schema = MotionData[template];
  const r = schema.safeParse(parsed);
  const errors = r.success ? [] : r.error.issues.map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`);
  if (facts) walkRefs(parsed, facts, "", errors);
  return { ok: errors.length === 0, errors, value: parsed as Record<string, unknown> };
}
