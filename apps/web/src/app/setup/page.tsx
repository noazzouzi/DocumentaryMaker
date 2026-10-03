// /setup — first-run onboarding (doctor checks, contact, Remotion licence choice, demo).
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { SetupWizard } from "@/components/SetupWizard";
import { attempt, loadEngine, pageI18n } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const { t } = await pageI18n(r.engine);
  const home = await attempt(() => r.engine.homeConfig());
  if (!home.ok) return <EngineUnavailable error={home.error} />;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-3xl font-black tracking-tight">{t("setup.title")}</h1>
      <p className="text-neutral-400">{t("setup.intro")}</p>
      <SetupWizard home={home.value} />
    </div>
  );
}
