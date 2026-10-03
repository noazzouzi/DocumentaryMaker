"use client";
// Shows engine.impact() before an edit that stales downstream work (style, minutes, languages, outline, …).
import { useEffect, useState } from "react";
import type { ImpactReport } from "@docmaker/engine";
import { fmtUsd } from "@/i18n";
import { api, errorText } from "@/lib/api";
import { useI18n } from "./I18nProvider";
import { Button, ErrorText, Modal } from "./ui";

export function ImpactDialog({ slug, request, onCancel, onProceed }: { slug: string; request: Record<string, unknown> | null; onCancel: () => void; onProceed: () => void | Promise<void> }) {
  const { t, lang } = useI18n();
  const [report, setReport] = useState<ImpactReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReport(null);
    setError(null);
    if (!request) return;
    let alive = true;
    api<ImpactReport>(`/api/projects/${slug}/impact`, { method: "POST", json: request })
      .then((r) => alive && setReport(r))
      .catch((e) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [slug, request]);
  const nothing = report && report.staleStages.length === 0 && report.lostUserEdits.length === 0;
  return (
    <Modal
      open={request !== null}
      onClose={onCancel}
      title={t("impact.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={report?.lostUserEdits.length ? "danger" : "primary"}
            busy={busy}
            disabled={!report && !error}
            onClick={async () => {
              setBusy(true);
              try {
                await onProceed();
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("impact.proceed")}
          </Button>
        </>
      }
    >
      {!report && !error ? <p className="text-sm text-neutral-400">{t("common.loading")}</p> : null}
      <ErrorText error={error} />
      {nothing ? <p className="text-sm text-neutral-300">{t("impact.none")}</p> : null}
      {report && !nothing ? (
        <div className="space-y-3 text-sm">
          {report.staleStages.length ? (
            <div>
              <p className="text-xs uppercase text-neutral-500">{t("impact.stale")}</p>
              <p className="font-mono text-xs">{report.staleStages.map((s) => `${s.stage}${s.lang ? `[${s.lang}]` : ""}`).join(", ")}</p>
            </div>
          ) : null}
          <p>{t("impact.cost", { usd: fmtUsd(lang, report.estimatedRerunUsd).replace(/[^\d.,]/g, "") })}</p>
          {report.lostUserEdits.length ? (
            <div className="rounded-md border border-red-800 bg-red-950/40 p-2">
              <p className="text-xs uppercase text-red-300">{t("impact.lost")}</p>
              <ul className="list-inside list-disc text-xs">
                {report.lostUserEdits.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
