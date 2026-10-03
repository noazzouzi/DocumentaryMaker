// Root layout: app shell (nav, language toggle) + i18n provider. Self-hosted fonts come from @docmaker/remotion/fonts.
import type React from "react";
import Link from "next/link";
import "@docmaker/remotion/fonts";
import "./globals.css";
import { I18nProvider } from "@/components/I18nProvider";
import { LangToggle } from "@/components/LangToggle";
import { loadEngine, pageI18n } from "@/server/page";

export const dynamic = "force-dynamic";
export const metadata = { title: "DocumentaryMaker", description: "Long-form narrated documentaries from an idea." };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const r = await loadEngine();
  const { lang, t } = await pageI18n(r.ok ? r.engine : null);
  return (
    <html lang={lang}>
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <I18nProvider lang={lang}>
          <header className="sticky top-0 z-30 border-b border-neutral-800 bg-neutral-950/90 backdrop-blur">
            <nav className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
              <Link href="/" className="font-black tracking-tight text-white">
                {t("app.name")}
              </Link>
              <div className="flex items-center gap-4 text-sm text-neutral-400">
                <Link href="/" className="hover:text-white">{t("nav.projects")}</Link>
                <Link href="/styles" className="hover:text-white">{t("nav.styles")}</Link>
                <Link href="/settings" className="hover:text-white">{t("nav.settings")}</Link>
                <Link href="/setup" className="hover:text-white">{t("nav.setup")}</Link>
              </div>
              <div className="ml-auto">
                <LangToggle />
              </div>
            </nav>
          </header>
          <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        </I18nProvider>
      </body>
    </html>
  );
}
