// /styles — style gallery (built-in + user styles), scaffolding and specimen commands.
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { attempt, loadEngine, pageI18n } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function StylesPage() {
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const { lang, t } = await pageI18n(r.engine);
  const styles = await attempt(() => r.engine.listStyles());
  if (!styles.ok) return <EngineUnavailable error={styles.error} />;
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-black tracking-tight">{t("styles.title")}</h1>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {styles.value.map((s) => (
          <article key={s.id} className="overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900/60" data-testid={`style-${s.id}`}>
            <div className="flex h-24 items-end p-4" style={{ background: `linear-gradient(135deg, ${s.previewColor}, #0a0a0a)` }}>
              <h2 className="text-xl font-black tracking-tight text-white drop-shadow">{s.names[lang]}</h2>
            </div>
            <div className="space-y-2 p-4 text-sm">
              <div className="flex flex-wrap gap-1.5 text-[11px] uppercase tracking-wide">
                <span className="rounded bg-neutral-800 px-1.5 py-0.5">{s.category}</span>
                <span className="rounded bg-neutral-800 px-1.5 py-0.5">{s.source === "builtin" ? t("styles.builtin") : t("styles.user")}</span>
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 font-mono normal-case">
                  {s.id}@{s.version}
                </span>
              </div>
              <p className="text-neutral-300">{s.description[lang]}</p>
              <p className="text-xs text-neutral-500">
                {t("styles.bestFor")}: {s.bestFor.join(", ").replace(/_/g, " ")}
              </p>
              <div className="space-y-1 pt-2">
                <p className="text-xs text-neutral-500">{t("styles.newHint")}</p>
                <code className="block rounded bg-neutral-950 px-2 py-1 font-mono text-xs text-amber-300">pnpm docmaker style new my-{s.id} --from {s.id}</code>
                <code className="block rounded bg-neutral-950 px-2 py-1 font-mono text-xs text-amber-300">pnpm docmaker style preview {s.id}</code>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
