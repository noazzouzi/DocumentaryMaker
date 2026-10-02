// Text helpers shared by components: number formatting (Intl + guilders), casing, word splitting, labels. Pure.
import { normWord } from "@docmaker/core";

export type NumberFormatKind = "number" | "currency" | "percent" | "compact";
export interface NumberFormatSpec {
  format: NumberFormatKind;
  currency: "USD" | "EUR" | "GBP" | "NLG" | null;
  decimals: number;
  locale: "en-US" | "fr-FR";
}
export interface NumPart { type: string; value: string }

const fmtCache = new Map<string, Intl.NumberFormat>();
function numberFormat(spec: NumberFormatSpec): Intl.NumberFormat {
  const key = `${spec.format}|${spec.currency}|${spec.decimals}|${spec.locale}`;
  let f = fmtCache.get(key);
  if (!f) {
    const d = Math.max(0, Math.min(3, Math.round(spec.decimals)));
    const base: Intl.NumberFormatOptions = { minimumFractionDigits: d, maximumFractionDigits: d };
    const opts: Intl.NumberFormatOptions =
      spec.format === "currency" && spec.currency
        ? { ...base, style: "currency", currency: spec.currency, currencyDisplay: "narrowSymbol" }
        : spec.format === "percent"
          ? { ...base, style: "percent" }
          : spec.format === "compact"
            ? { notation: "compact", maximumFractionDigits: Math.max(1, d) }
            : base;
    f = new Intl.NumberFormat(spec.locale, opts);
    fmtCache.set(key, f);
  }
  return f;
}

/**
 * Locale-aware parts for a DISPLAY value (percent: 25 means "25 %"). Guilders (NLG, no modern symbol in ICU) get the
 * florin sign ƒ: "ƒ5,500" (en-US), "5 500 ƒ" (fr-FR).
 */
export function formatNumberParts(value: number, spec: NumberFormatSpec): NumPart[] {
  const v = Number.isFinite(value) ? value : 0;
  const raw = numberFormat(spec).formatToParts(spec.format === "percent" ? v / 100 : v);
  const parts: NumPart[] = raw.map((p) => ({ type: p.type, value: p.value }));
  if (spec.format === "currency" && spec.currency === "NLG") {
    const out: NumPart[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p.type === "currency") {
        out.push({ type: "currency", value: "ƒ" });
        // drop the separator literal between a leading symbol and the digits (en-US "NLG 5,500" → "ƒ5,500")
        const next = parts[i + 1];
        if (next && next.type === "literal" && i === firstNonSign(parts)) i++;
        continue;
      }
      out.push(p);
    }
    return out;
  }
  return parts;
}
function firstNonSign(parts: NumPart[]): number {
  let i = 0;
  while (i < parts.length && (parts[i]!.type === "minusSign" || parts[i]!.type === "plusSign")) i++;
  return i;
}
export const formatNumber = (value: number, spec: NumberFormatSpec): string => formatNumberParts(value, spec).map((p) => p.value).join("");

export const upper = (s: string, locale: string): string => s.toLocaleUpperCase(locale);
/** Splits display text into words keeping punctuation attached (for per-word reveals). */
export const splitWords = (s: string): string[] => s.split(/\s+/).filter((w) => w.length > 0);
/** True when `word` matches one of the emphasis entries (accent/case-insensitive, punctuation ignored). */
export function isEmphasis(word: string, emphasis: readonly string[]): boolean {
  const n = normWord(word);
  if (!n) return false;
  return emphasis.some((e) => {
    const parts = splitWords(e).map(normWord).filter(Boolean);
    return parts.includes(n);
  });
}

/** Greedy word wrap to ≤ maxChars per line (a single long word stays whole). */
export function wrapText(s: string, maxChars: number, maxLines = Infinity): string[] {
  const words = splitWords(s);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = truncate(kept[maxLines - 1]! + " " + lines.slice(maxLines).join(" "), maxChars);
    return kept;
  }
  return lines;
}
export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)).trimEnd() + "…";
}

export type UiLang = "en" | "fr";
export const uiLang = (lang: string): UiLang => (lang === "fr" ? "fr" : "en");

/** SourceLabel kinds → on-screen tags (EN/FR). */
export const SOURCE_KIND_LABEL: Record<string, { en: string; fr: string }> = {
  source: { en: "SOURCE", fr: "SOURCE" },
  illustration: { en: "ILLUSTRATION", fr: "ILLUSTRATION" },
  reconstruction: { en: "RECONSTRUCTION", fr: "RECONSTITUTION" },
  translated: { en: "TRANSLATED", fr: "TRADUCTION" },
  "synthetic-voice": { en: "SYNTHETIC VOICE", fr: "VOIX DE SYNTHÈSE" },
  archive: { en: "ARCHIVE", fr: "ARCHIVES" },
  "scratch-voice": { en: "SCRATCH VOICE", fr: "VOIX TÉMOIN" },
  "pickup-tts": { en: "PICKUP · TTS", fr: "RACCORD · TTS" },
};
export const TRANSLATED_LABEL = { en: "TRANSLATED", fr: "TRADUCTION" } as const;
export const DOC_TYPE_LABEL: Record<string, { en: string; fr: string }> = {
  court: { en: "COURT RECORD", fr: "DOCUMENT JUDICIAIRE" },
  letter: { en: "LETTER", fr: "LETTRE" },
  report: { en: "REPORT", fr: "RAPPORT" },
  contract: { en: "CONTRACT", fr: "CONTRAT" },
  pamphlet: { en: "PAMPHLET", fr: "PAMPHLET" },
};
