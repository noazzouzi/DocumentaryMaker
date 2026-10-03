"use client";
// Explicit placeholder when the engine is not implemented yet or failed to answer.
import { useRouter } from "next/navigation";
import { useT } from "./I18nProvider";
import { Banner, Button } from "./ui";

export function EngineUnavailable({ error }: { error: { message: string; code: string; notImplemented: boolean } }) {
  const t = useT();
  const router = useRouter();
  return (
    <div className="space-y-3" data-testid="engine-unavailable">
      <Banner tone={error.notImplemented ? "blue" : "red"} actions={<Button size="sm" onClick={() => router.refresh()}>{t("common.retry")}</Button>}>
        <p className="font-semibold">{t("engine.unavailable.title")}</p>
        <p className="mt-1">{error.notImplemented ? t("engine.unavailable.notImplemented") : t("engine.unavailable.other")}</p>
        <p className="mt-1 font-mono text-xs opacity-70">
          {error.code}: {error.message}
        </p>
      </Banner>
    </div>
  );
}
