"use client";
// EN/FR toggle: sets the cookie immediately and persists HomeConfig.uiLang (best effort).
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { UI_LANG_COOKIE, type UiLang } from "@/i18n";
import { api } from "@/lib/api";
import { useI18n } from "./I18nProvider";
import { cx } from "./ui";

export function LangToggle() {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [pending, start] = useTransition();
  const set = (l: UiLang) => {
    if (l === lang) return;
    document.cookie = `${UI_LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=strict`;
    void api("/api/home", { method: "PATCH", json: { uiLang: l } }).catch(() => undefined);
    start(() => router.refresh());
  };
  return (
    <div role="group" aria-label={t("nav.lang")} className={cx("flex overflow-hidden rounded-md border border-neutral-700 text-xs", pending && "opacity-60")}>
      {(["en", "fr"] as const).map((l) => (
        <button key={l} type="button" onClick={() => set(l)} aria-pressed={l === lang} className={cx("px-2 py-1 uppercase", l === lang ? "bg-neutral-700 text-white" : "text-neutral-400 hover:text-white")}>
          {l}
        </button>
      ))}
    </div>
  );
}
