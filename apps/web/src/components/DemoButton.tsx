"use client";
// "Run the offline demo": POST /api/demo then open the project (its overview attaches to the live job).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorText } from "@/lib/api";
import { useT } from "./I18nProvider";
import { Button, ErrorText } from "./ui";

export function DemoButton({ variant = "secondary" }: { variant?: "primary" | "secondary" }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ slug: string; jobId: string | null }>("/api/demo", { method: "POST", json: { fixture: "tulip-mania", langs: ["en"] } });
      router.push(`/p/${r.slug}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant={variant} busy={busy} onClick={run} data-testid="run-demo">
        {busy ? t("home.demoRunning") : t("home.demo")}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}
