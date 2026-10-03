"use client";
// §17.4: shown instead of the Player until the user has chosen their Remotion licence situation (never decided for them).
import Link from "next/link";
import { useT } from "./I18nProvider";

export function RemotionLicenseCard() {
  const t = useT();
  return (
    <div className="flex aspect-video w-full flex-col items-center justify-center gap-3 rounded-lg border border-amber-700/60 bg-neutral-900 p-8 text-center" data-testid="remotion-license-card">
      <h2 className="text-lg font-bold">{t("license.card.title")}</h2>
      <p className="max-w-xl text-sm text-neutral-300">{t("license.card.body")}</p>
      <Link href="/setup" className="rounded-md bg-amber-500 px-3.5 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400">
        {t("license.card.cta")}
      </Link>
    </div>
  );
}
