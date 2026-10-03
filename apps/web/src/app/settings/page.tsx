// /settings — keys, contact, defaults, UI language, Remotion licence, paths, doctor, setup actions. Secrets never shown.
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { SettingsPanel } from "@/components/SettingsPanel";
import { attempt, loadEngine, pageI18n } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const { engine } = r;
  const { t } = await pageI18n(engine);
  const home = await attempt(() => engine.homeConfig());
  if (!home.ok) return <EngineUnavailable error={home.error} />;
  const styles = await attempt(() => engine.listStyles());
  const c = engine.config;
  const paths = [
    { label: "home", value: c.paths.home },
    { label: "projects", value: c.projectsDir },
    { label: "repo", value: c.repoRoot },
    { label: "cache", value: c.paths.cache },
    { label: "models", value: c.paths.models },
    { label: "styles", value: c.paths.styles },
    { label: "browser", value: c.browserExecutable ?? "—" },
    { label: "ffmpeg", value: c.ffmpeg },
    { label: "offline", value: String(c.offline) },
  ];
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-black tracking-tight">{t("nav.settings")}</h1>
      <SettingsPanel home={home.value} styles={styles.ok ? styles.value : []} paths={paths} />
    </div>
  );
}
