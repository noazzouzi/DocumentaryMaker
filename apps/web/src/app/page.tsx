// "/" — project list, New project, Run demo. First run (no Remotion licence choice / onboarding) → /setup.
import Link from "next/link";
import { redirect } from "next/navigation";
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { DemoButton } from "@/components/DemoButton";
import { attempt, loadEngine, pageI18n } from "@/server/page";
import { fmtDate } from "@/i18n";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const { engine } = r;
  const { lang, t } = await pageI18n(engine);
  const home = await attempt(() => engine.homeConfig());
  if (home.ok && (!home.value.remotionLicense || !home.value.onboardingDone)) redirect("/setup");
  const list = await attempt(() => engine.listProjects());
  if (!list.ok) return <EngineUnavailable error={list.error} />;
  const projects = [...list.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-black tracking-tight">{t("home.title")}</h1>
          <p className="text-sm text-neutral-400">{t("app.tagline")}</p>
        </div>
        <div className="flex gap-2">
          <DemoButton />
          <Link href="/new" className="rounded-md bg-amber-500 px-3.5 py-2 text-sm font-medium text-neutral-950 hover:bg-amber-400">
            {t("home.new")}
          </Link>
        </div>
      </div>
      {projects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-neutral-800 p-8 text-center text-neutral-400">{t("home.empty")}</p>
      ) : (
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="py-2">{t("home.col.title")}</th>
              <th>{t("home.col.langs")}</th>
              <th>{t("home.col.updated")}</th>
              <th>{t("home.col.job")}</th>
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {projects.map((p) => (
              <tr key={p.slug} className="hover:bg-neutral-900/60">
                <td className="py-2.5">
                  <Link href={`/p/${p.slug}`} className="font-medium text-white hover:underline">
                    {p.title || p.slug}
                  </Link>
                  <div className="font-mono text-xs text-neutral-500">{p.slug}</div>
                </td>
                <td className="uppercase">{p.languages.join(" · ")}</td>
                <td className="text-neutral-400">{fmtDate(lang, p.updatedAt)}</td>
                <td>{p.activeJobId ? <span className="text-amber-400">● {t("home.jobRunning")}</span> : <span className="text-neutral-600">—</span>}</td>
                <td className="text-right">
                  <Link href={`/p/${p.slug}`} className="text-amber-400 hover:underline">
                    {t("home.open")}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
