// Isomorphic i18n: dictionaries + a tiny translator with {placeholder} interpolation.
import { en, type Dict, type MessageKey } from "./en";
import { fr } from "./fr";

export type UiLang = "en" | "fr";
export type { Dict, MessageKey };
export const DICTS: Readonly<Record<UiLang, Dict>> = { en, fr };
export const UI_LANG_COOKIE = "docmaker-ui-lang";

export type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

export function translator(lang: UiLang): T {
  const d = DICTS[lang] ?? en;
  return (key, vars) => {
    const s = d[key] ?? en[key] ?? key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
  };
}

/** First supported language in an Accept-Language header (q-values honoured), else null. */
export function fromAcceptLanguage(h: string | null): UiLang | null {
  if (!h) return null;
  const ranked = h
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find(Boolean);
      return { tag: (tag ?? "").toLowerCase(), q: q ? Number(q) : 1, i };
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const r of ranked) {
    const base = r.tag.split("-")[0];
    if (base === "fr" || base === "en") return base;
  }
  return null;
}

/** Number/date formatting per UI language. */
export const fmtUsd = (lang: UiLang, usd: number): string =>
  new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US", { style: "currency", currency: "USD", maximumFractionDigits: usd < 1 ? 3 : 2 }).format(usd);
export const fmtDate = (lang: UiLang, iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(lang === "fr" ? "fr-FR" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
};
export const fmtSeconds = (s: number): string => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
};
