// motion_data_json validation: MotionData[template] + FACT REFS checked against the FactSheet (§6.3 step 5).
import { MotionData, type FactSheet, type MotionTemplate } from "@docmaker/core";
import { normRef } from "../wire/ids";
import { normText, similarity } from "../text";

export interface MotionCheck {
  ok: boolean;
  /** Parsed data (wire keys, defaults applied, ids normalised) when the schema parsed; else the raw input. */
  data: Record<string, unknown>;
  problems: string[];
}

const ID_KEYS: Record<string, string> = { quote_id: "Q", source_id: "S", figure_id: "N", event_id: "E", person_id: "P" };

/** Normalises id-like keys in place ("q1" → "Q1"); unparseable ids are left as-is (the ref check reports them). */
function normIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normIds);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const prefix = ID_KEYS[k];
      if (prefix && typeof x === "string") {
        try {
          out[k] = normRef(x, k, prefix) ?? "";
        } catch {
          out[k] = x;
        }
      } else out[k] = normIds(x);
    }
    return out;
  }
  return v;
}

const sameNumber = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));
const sameText = (a: string, b: string) => normText(a) === normText(b);

/**
 * Validates a beat's motion data. `primary=false` (secondary language): display strings may be transcreated —
 * a quote/post/headline/passage text that differs from the original is accepted and flagged `translated: true`.
 */
export function checkMotion(template: MotionTemplate, raw: Record<string, unknown>, fs: FactSheet, o: { primary: boolean }): MotionCheck {
  if (template === "none") return { ok: true, data: {}, problems: [] };
  const schema = MotionData[template];
  const parsed = schema.safeParse(normIds(raw));
  if (!parsed.success) {
    return { ok: false, data: raw, problems: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const d = parsed.data as Record<string, unknown>;
  const problems: string[] = [];
  let translated = false;
  const quotes = new Map(fs.quotes.map((q) => [q.id, q]));
  const sources = new Map(fs.sources.map((s) => [s.id, s]));
  const figures = new Map(fs.figures.map((f) => [f.id, f]));
  const events = new Map(fs.timeline.map((e) => [e.id, e]));
  const people = new Set(fs.people.map((p) => p.id));
  const verbatimOk = (shown: string, quoteId: string, what: string) => {
    const q = quotes.get(quoteId);
    if (!q) return problems.push(`${what}: unknown quote ${quoteId || "(empty)"}`);
    if (sameText(shown, q.verbatim)) return;
    if (!o.primary && shown.trim() !== "") translated = true;
    else problems.push(`${what}: text differs from the verbatim of ${q.id}`);
  };
  const figureOk = (figureId: string, value: number, what: string) => {
    const f = figures.get(figureId);
    if (!f) return problems.push(`${what}: unknown figure ${figureId || "(empty)"}`);
    if (!sameNumber(value, f.value)) problems.push(`${what}: value ${value} ≠ figure ${f.id} value ${f.value}`);
  };
  const sourceOk = (sourceId: string, what: string) => {
    if (!sources.has(sourceId)) problems.push(`${what}: unknown source ${sourceId || "(empty)"}`);
  };

  switch (template) {
    case "quote_card":
      verbatimOk(d.text as string, d.quote_id as string, "quote_card");
      break;
    case "tweet_card":
      verbatimOk(d.body as string, d.quote_id as string, "tweet_card");
      break;
    case "comment_pile":
      for (const [k, it] of (d.items as { quote_id: string }[]).entries()) if (!quotes.has(it.quote_id)) problems.push(`comment_pile.items[${k}]: unknown quote ${it.quote_id}`);
      break;
    case "headline_stack":
      for (const [k, it] of (d.items as { source_id: string; outlet: string; headline: string }[]).entries()) {
        const s = sources.get(it.source_id);
        if (!s) {
          problems.push(`headline_stack.items[${k}]: unknown source ${it.source_id || "(empty)"}`);
          continue;
        }
        if (!sameText(it.outlet, s.publisher) && similarity(it.outlet, s.publisher) < 0.9) problems.push(`headline_stack.items[${k}]: outlet "${it.outlet}" ≠ publisher "${s.publisher}"`);
        if (similarity(it.headline, s.title) < 0.9) {
          if (!o.primary) translated = true;
          else problems.push(`headline_stack.items[${k}]: headline is not the title of ${s.id}`);
        }
      }
      break;
    case "document_highlight": {
      sourceOk(d.source_id as string, "document_highlight");
      const qid = d.quote_id as string;
      if (qid !== "") {
        if (!quotes.has(qid)) problems.push(`document_highlight: unknown quote ${qid}`);
        else if ((d.highlight as string).trim() !== "") verbatimOk(d.highlight as string, qid, "document_highlight.highlight");
      }
      break;
    }
    case "counter":
    case "money_counter":
      figureOk(d.figure_id as string, d.value as number, template);
      break;
    case "bar_chart":
    case "line_chart":
      if ((d.source_id as string) !== "") sourceOk(d.source_id as string, template);
      for (const [k, b] of (d.bars as { figure_id: string; value: number }[]).entries()) figureOk(b.figure_id, b.value, `${template}.bars[${k}]`);
      break;
    case "timeline":
      for (const [k, e] of (d.events as { date: string; event_id: string }[]).entries()) {
        if (e.event_id === "") continue;
        const ev = events.get(e.event_id);
        if (!ev) problems.push(`timeline.events[${k}]: unknown event ${e.event_id}`);
        else if (e.date.trim() !== ev.date.trim()) problems.push(`timeline.events[${k}]: date "${e.date}" ≠ event ${ev.id} date "${ev.date}"`);
      }
      break;
    case "evidence_board":
      for (const [k, it] of (d.items as { person_id: string; source_id: string }[]).entries()) {
        if (it.person_id !== "" && !people.has(it.person_id)) problems.push(`evidence_board.items[${k}]: unknown person ${it.person_id}`);
        if (it.source_id !== "" && !sources.has(it.source_id)) problems.push(`evidence_board.items[${k}]: unknown source ${it.source_id}`);
      }
      break;
    case "map_route":
      for (const [k, p] of (d.places as { lon: number; lat: number }[]).entries()) {
        if (Math.abs(p.lon) > 180 || Math.abs(p.lat) > 90) problems.push(`map_route.places[${k}]: invalid coordinates`);
      }
      break;
    default:
      break;
  }
  if (translated) d.translated = true;
  return { ok: problems.length === 0, data: d, problems };
}

/** kinetic_text replacement for a downgraded beat: lines from onScreenText, else the first words of the beat text. */
export function kineticFrom(onScreenText: string, beatText: string): Record<string, unknown> {
  const src = onScreenText.trim() !== "" ? onScreenText : beatText.split(/\s+/).slice(0, 6).join(" ");
  const lines = src
    .split(/\n|\s\/\s/)
    .map((l) => l.trim())
    .filter((l) => l !== "")
    .slice(0, 4);
  return { lines: lines.length > 0 ? lines : ["…"], emphasis: [] };
}

/** Numeric motion fields copied from the primary language into a secondary language's data (in place, recursive). */
export const NUMERIC_KEYS = new Set(["value", "from", "lon", "lat", "decimals", "count", "likes", "reposts", "replies", "active_index"]);
export const ID_FIELDS = new Set([...Object.keys(ID_KEYS), "currency", "format", "kind", "variant", "region", "route", "compact", "highlight_bar", "links"]);

/** Copies numbers, ids and enums from `primary` into `secondary` (same template); array items are matched by index. */
export function copyInvariantFields(primary: unknown, secondary: unknown): unknown {
  if (Array.isArray(primary)) {
    const sec = Array.isArray(secondary) ? secondary : [];
    return primary.map((p, i) => copyInvariantFields(p, sec[i]));
  }
  if (primary && typeof primary === "object") {
    const sec = secondary && typeof secondary === "object" && !Array.isArray(secondary) ? (secondary as Record<string, unknown>) : {};
    const out: Record<string, unknown> = { ...sec };
    for (const [k, v] of Object.entries(primary as Record<string, unknown>)) {
      if (NUMERIC_KEYS.has(k) || ID_FIELDS.has(k) || typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
      else if (typeof v === "object") out[k] = copyInvariantFields(v, sec[k]);
      else if (!(k in sec) || typeof sec[k] !== "string") out[k] = v;
    }
    return out;
  }
  return secondary ?? primary;
}
