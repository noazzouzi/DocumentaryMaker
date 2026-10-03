"use client";
// Remotion licence choice (§17.4): the user decides; stored in HomeConfig.remotionLicense (timestamped server-side).
import { useState } from "react";
import type { HomeConfig } from "@docmaker/core";
import { api, errorText } from "@/lib/api";
import { useT } from "./I18nProvider";
import { Banner, Button, ErrorText } from "./ui";

type Status = NonNullable<HomeConfig["remotionLicense"]>["status"];

export function LicenseChoice({ current, onSaved }: { current: HomeConfig["remotionLicense"]; onSaved?: (h: HomeConfig) => void }) {
  const t = useT();
  const [status, setStatus] = useState<Status | null>(current?.status ?? null);
  const [saved, setSaved] = useState<Status | null>(current?.status ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      const h = await api<HomeConfig>("/api/home", { method: "PATCH", json: { remotionLicense: { status } } });
      setSaved(h.remotionLicense?.status ?? status);
      onSaved?.(h);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 text-sm" data-testid="license-choice">
      <p className="text-neutral-300">{t("setup.license.intro")}</p>
      <a href="https://www.remotion.dev/license" target="_blank" rel="noreferrer noopener" className="text-amber-400 hover:underline">
        {t("setup.license.link")} ↗
      </a>
      <fieldset className="space-y-2">
        {(
          [
            ["individual-or-small-org", t("setup.license.individual")],
            ["company-license", t("setup.license.company")],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-start gap-2">
            <input type="radio" name="remotion-license" value={v} checked={status === v} onChange={() => setStatus(v)} className="mt-1 accent-amber-500" />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <div className="flex items-center gap-3">
        <Button variant="primary" busy={busy} disabled={!status || status === saved} onClick={save}>
          {t("common.save")}
        </Button>
        {saved ? <Banner tone="green">{t("setup.license.saved", { status: saved })}</Banner> : null}
      </div>
      <ErrorText error={error} />
    </div>
  );
}
