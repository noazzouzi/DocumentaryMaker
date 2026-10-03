// UI-language cookie (set by the toggle and the settings page; read server-side first).
import { UI_LANG_COOKIE, type UiLang } from "@/i18n";

export function setUiLangCookie(lang: UiLang | null): void {
  if (typeof document === "undefined") return;
  document.cookie = lang ? `${UI_LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=strict` : `${UI_LANG_COOKIE}=; path=/; max-age=0; samesite=strict`;
}
