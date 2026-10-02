// Id normalisation for wire → core mapping (§6.4): trim, uppercase prefix, zero-pad segment numbers.
// Only unrecoverable ids raise LLM_SCHEMA (with the JSON path).
import { DocmakerError, ids } from "@docmaker/core";

export function schemaError(path: string, msg: string, details?: unknown): DocmakerError {
  return new DocmakerError("LLM_SCHEMA", `${path}: ${msg}`, { details, hint: "the model returned an unusable value; retry or edit the step manually" });
}

const REF = /^([SPENCQ])[\s_-]*0*(\d{1,4})$/;

/** "s 01" → "S1", "q-3" → "Q3". Returns null for "" ; throws LLM_SCHEMA for garbage (or a wrong prefix). */
export function normRef(raw: string, path: string, prefixes = "SPENCQ"): string | null {
  const t = raw.trim().toUpperCase();
  if (t === "") return null;
  const m = REF.exec(t);
  if (!m || !prefixes.includes(m[1]!)) throw schemaError(path, `invalid id "${raw}" (expected ${prefixes.split("").join("/")}<n>)`);
  return `${m[1]}${Number(m[2])}`;
}

/** Normalises a list of fact refs; empty strings are dropped, garbage throws. */
export function normRefs(raw: readonly string[], path: string, prefixes = "SPENCQ"): string[] {
  const out: string[] = [];
  raw.forEach((r, i) => {
    const v = normRef(r, `${path}[${i}]`, prefixes);
    if (v !== null && !out.includes(v)) out.push(v);
  });
  return out;
}

/** Same as normRefs but drops (instead of throwing on) malformed ids; returns the dropped raw values. */
export function normRefsLenient(raw: readonly string[], prefixes = "SPENCQ"): { ids: string[]; dropped: string[] } {
  const out: string[] = [];
  const dropped: string[] = [];
  for (const r of raw) {
    try {
      const v = normRef(r, "", prefixes);
      if (v !== null && !out.includes(v)) out.push(v);
    } catch {
      dropped.push(r);
    }
  }
  return { ids: out, dropped };
}

/** "ch 3" | "Chapter 3" | "CH03" → "CH3"; null when unrecognisable. */
export function normChapterId(raw: string): string | null {
  const m = /^(?:CH|CHAPTER|CHAPITRE|C)[\s_-]*0*(\d{1,2})$/i.exec(raw.trim());
  if (!m || Number(m[1]) < 1) return null;
  return ids.chapter(Number(m[1]));
}

/** "CH3-S7" → "CH3-S07"; null when unrecognisable. */
export function normSegmentId(raw: string): string | null {
  const m = /^(?:CH)?[\s_-]*0*(\d{1,2})[\s_-]*S[\s_-]*0*(\d{1,3})$/i.exec(raw.trim());
  if (!m || Number(m[1]) < 1 || Number(m[2]) < 1) return null;
  return ids.segment(ids.chapter(Number(m[1])), Number(m[2]));
}

/** "CH3-B14" → "CH3-B014"; synthetic "-CLIP"/"-BR" ids kept; null when unrecognisable. */
export function normBeatId(raw: string): string | null {
  const t = raw.trim().toUpperCase();
  const syn = /^CH0*(\d{1,2})-S0*(\d{1,3})-(CLIP|BR)$/.exec(t);
  if (syn) return `${ids.segment(ids.chapter(Number(syn[1])), Number(syn[2]))}-${syn[3]}`;
  const m = /^(?:CH)?[\s_-]*0*(\d{1,2})[\s_-]*B[\s_-]*0*(\d{1,3})$/.exec(t);
  if (!m || Number(m[1]) < 1 || Number(m[2]) < 1) return null;
  return ids.beat(ids.chapter(Number(m[1])), Number(m[2]));
}

/** "l 2" → "L2"; null when unrecognisable. */
export function normLoopId(raw: string): string | null {
  const m = /^L(?:OOP)?[\s_-]*0*(\d{1,3})$/i.exec(raw.trim());
  return m ? `L${Number(m[1])}` : null;
}
