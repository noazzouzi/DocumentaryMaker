// /new — idea, languages, minutes, instant offline style ranking + confirmation, pipeline estimate, create.
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { NewProjectForm } from "@/components/NewProjectForm";
import { attempt, loadEngine, pageI18n } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function NewPage() {
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const { t } = await pageI18n(r.engine);
  const [home, styles] = await Promise.all([attempt(() => r.engine.homeConfig()), attempt(() => r.engine.listStyles())]);
  if (!home.ok) return <EngineUnavailable error={home.error} />;
  if (!styles.ok) return <EngineUnavailable error={styles.error} />;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight">{t("new.title")}</h1>
      <NewProjectForm home={home.value} styles={styles.value} />
    </div>
  );
}
