"use client";
import { useState } from "react";
import { useT } from "./I18nProvider";
import { Button } from "./ui";

export function CopyButton({ text }: { text: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      onClick={() =>
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        })
      }
    >
      {done ? t("common.copied") : t("common.copy")}
    </Button>
  );
}
