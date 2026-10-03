"use client";
// Conflict / read-only / error banners shared by document editors.
import { useT } from "./I18nProvider";
import { Banner, Button } from "./ui";

export function DocStatus({ conflict, readOnly, error, onReload }: { conflict: boolean; readOnly: boolean; error: string | null; onReload: () => void }) {
  const t = useT();
  return (
    <>
      {readOnly ? <Banner tone="blue">{t("common.readOnlyJob")}</Banner> : null}
      {conflict ? (
        <Banner tone="red" actions={<Button size="sm" onClick={onReload}>{t("common.reload")}</Button>}>
          {t("common.conflict")}
        </Banner>
      ) : error ? (
        <Banner tone="red">{error}</Banner>
      ) : null}
    </>
  );
}
