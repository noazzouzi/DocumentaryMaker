"use client";
// Versions of a user-editable document (.history, last 20) with revert.
import { useState } from "react";
import { fmtDate } from "@/i18n";
import { api, errorText } from "@/lib/api";
import { useI18n } from "./I18nProvider";
import { Button, ErrorText, Modal } from "./ui";

export function HistoryMenu({ slug, rel, onReverted, disabled }: { slug: string; rel: string; onReverted: () => void; disabled?: boolean }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ file: string; at: string; etag: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/projects/${slug}/history/${rel}`;
  const show = async () => {
    setOpen(true);
    setError(null);
    try {
      setItems(await api(url));
    } catch (e) {
      setError(errorText(e));
    }
  };
  const revert = async (file: string) => {
    try {
      await api(url, { method: "POST", json: { file } });
      setOpen(false);
      onReverted();
    } catch (e) {
      setError(errorText(e));
    }
  };
  return (
    <>
      <Button size="sm" variant="ghost" onClick={show} disabled={disabled}>
        {t("common.history")}
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`${t("common.history")} — ${rel}`}>
        <ErrorText error={error} />
        {items === null ? <p className="text-sm text-neutral-500">{t("common.loading")}</p> : null}
        <ul className="divide-y divide-neutral-800 text-sm">
          {(items ?? []).map((h) => (
            <li key={h.file} className="flex items-center gap-2 py-1.5">
              <span>{fmtDate(lang, h.at)}</span>
              <span className="font-mono text-xs text-neutral-500">{h.etag.slice(0, 8)}</span>
              <Button size="sm" className="ml-auto" onClick={() => void revert(h.file)}>
                {t("common.revert")}
              </Button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
