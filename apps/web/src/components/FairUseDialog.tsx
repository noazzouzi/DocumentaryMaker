"use client";
// §17.3 fair-use notice, shown before the first YouTube download; the acknowledgement is stored by the caller.
import { useState } from "react";
import { useT } from "./I18nProvider";
import { Button, Modal } from "./ui";

export function FairUseDialog({ open, onClose, onAccept }: { open: boolean; onClose: () => void; onAccept: () => void | Promise<void> }) {
  const t = useT();
  const [checked, setChecked] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("fairuse.title")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={!checked} onClick={() => void onAccept()}>
            {t("common.confirm")}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-neutral-300">
        <p>{t("fairuse.body1")}</p>
        <p>{t("fairuse.body2")}</p>
        <label className="flex items-center gap-2 font-medium text-white">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="accent-amber-500" />
          {t("fairuse.ack")}
        </label>
      </div>
    </Modal>
  );
}
