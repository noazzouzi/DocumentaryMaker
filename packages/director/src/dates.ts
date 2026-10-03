// Viewer-facing date labels (§4.11 props are display strings, resolved by the director in the programme language).
// FactSheet and source dates are ISO-like with their precision ("1637", "1637-02", "1637-02-05", or an ISO timestamp);
// on screen they read "5 Feb 1637" / "5 févr. 1637", "Feb 1637" / "févr. 1637", "1637". Fixed month tables (not Intl)
// keep the director deterministic across ICU versions. Anything that is not an ISO date is returned unchanged.
import type { Lang } from "@docmaker/core";

const MONTHS: Record<Lang, { short: readonly string[]; long: readonly string[] }> = {
  en: {
    short: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    long: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  },
  fr: {
    short: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
    long: ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  },
};

const ISO = /^(-?\d{1,4})(?:-(\d{2})(?:-(\d{2})(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?)?)?$/;

export interface IsoDateParts { year: number; month: number | null; day: number | null }

/** Parses an ISO date of any precision (year, year-month, full date, timestamp); null when `s` is not one. */
export function parseIsoDate(s: string): IsoDateParts | null {
  const m = ISO.exec(s.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = m[2] !== undefined ? Number(m[2]) : null;
  const day = m[3] !== undefined ? Number(m[3]) : null;
  if (month !== null && (month < 1 || month > 12)) return null;
  if (day !== null && (day < 1 || day > daysIn(year, month!))) return null;
  if (month === null && m[1]!.replace("-", "").length < 3) return null; // "12" alone is not a year label
  return { year, month, day };
}

function daysIn(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function yearText(y: number, lang: Lang): string {
  if (y > 0) return String(y);
  return lang === "fr" ? `${1 - y} av. J.-C.` : `${1 - y} BC`; // ISO year 0 = 1 BC
}

function render(p: IsoDateParts, lang: Lang, form: "short" | "long"): string {
  const y = yearText(p.year, lang);
  if (p.month === null) return y;
  const mon = MONTHS[lang][form][p.month - 1]!;
  if (p.day === null) return `${mon} ${y}`;
  const d = lang === "fr" && p.day === 1 ? "1er" : String(p.day);
  return `${d} ${mon} ${y}`;
}

/** On-screen label: "1637-02-05" → "5 Feb 1637" (en) / "5 févr. 1637" (fr); keeps the precision; non-ISO text unchanged. */
export function dateLabel(raw: string, lang: Lang): string {
  const p = parseIsoDate(raw);
  return p ? render(p, lang, "short") : raw.trim();
}

/** The date as the narrator would say it (long month names), for VO sync: "5 February 1637" / "5 février 1637". */
export function spokenDate(raw: string, lang: Lang): string {
  const p = parseIsoDate(raw);
  return p ? render(p, lang, "long") : raw.trim();
}
