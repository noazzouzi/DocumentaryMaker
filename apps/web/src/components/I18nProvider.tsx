"use client";
// Client-side i18n context: the server resolves the language; client components call useT().
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { translator, type T, type UiLang } from "@/i18n";

const Ctx = createContext<{ lang: UiLang; t: T }>({ lang: "en", t: translator("en") });

export function I18nProvider({ lang, children }: { lang: UiLang; children: ReactNode }) {
  const v = useMemo(() => ({ lang, t: translator(lang) }), [lang]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;
