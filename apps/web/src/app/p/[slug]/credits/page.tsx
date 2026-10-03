// /p/[slug]/credits — ledger joined with usage, voice licences, credits.<lang>.md preview, rights warnings.
import { ActiveTake, Ledger, P, UsageDoc, VoiceTrack, type LedgerEntry } from "@docmaker/core";
import { CopyButton } from "@/components/CopyButton";
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { readProjectText } from "@/server/files";
import { projectDirOf } from "@/server/runtime";
import { attempt, loadEngine, pageI18n, readDocOrNull } from "@/server/page";

export const dynamic = "force-dynamic";

function warningsOf(e: LedgerEntry): string[] {
  const w: string[] = [];
  const l = e.license;
  if (l.code === "CC-BY-SA" || l.restrictions.includes("sa")) w.push("BY-SA: derivatives share alike");
  if (l.restrictions.includes("personality")) w.push("personality rights");
  if (l.code === "YOUTUBE-FAIR-USE" || l.restrictions.includes("fair-use-user-risk")) w.push("fair use / citation (your responsibility)");
  if (l.code === "AI-GENERATED") w.push("AI-generated (disclose)");
  if (l.restrictions.includes("synthetic")) w.push("synthetic voice (disclose)");
  if (l.code === "UNKNOWN" || l.restrictions.includes("unknown-rights")) w.push("unknown rights");
  if (!l.commercialOk) w.push("non-commercial");
  return w;
}

export default async function CreditsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const e = r.engine;
  const { t } = await pageI18n(e);
  const data = await attempt(async () => {
    const project = await e.getProject(slug);
    const ledger = await readDocOrNull(e, slug, P.ledger, Ledger);
    const dir = projectDirOf(e, slug);
    const perLang = await Promise.all(
      project.languages.map(async (lang) => {
        const [usage, active, md] = await Promise.all([readDocOrNull(e, slug, P.usage(lang), UsageDoc), readDocOrNull(e, slug, P.activeTake(lang), ActiveTake), readProjectText(dir, P.credits(lang))]);
        const take = active ? await readDocOrNull(e, slug, P.take(lang, active.value.takeId), VoiceTrack) : null;
        return { lang, usage: usage?.value ?? null, take: take?.value ?? null, md };
      }),
    );
    return { project, ledger: ledger?.value ?? null, perLang };
  });
  if (!data.ok) return <EngineUnavailable error={data.error} />;
  const d = data.value;
  const usedIn = (assetId: string) =>
    d.perLang.flatMap((l) => (l.usage?.usage.find((u) => u.assetId === assetId)?.itemIds ?? []).map((id) => `${l.lang}:${id}`));
  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-neutral-800">
        <h2 className="border-b border-neutral-800 px-4 py-2.5 text-sm font-semibold">{t("credits.ledger")}</h2>
        {!d.ledger ? (
          <p className="p-4 text-sm text-neutral-500">{t("common.missingDoc")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-neutral-500">
                <tr>
                  <th className="px-3 py-2">{t("credits.asset")}</th>
                  <th>{t("credits.provider")}</th>
                  <th>{t("credits.license")}</th>
                  <th>{t("credits.author")}</th>
                  <th>{t("credits.usedIn")}</th>
                  <th>{t("credits.warnings")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800">
                {d.ledger.entries.map((en) => {
                  const used = usedIn(en.assetId);
                  const warn = warningsOf(en);
                  return (
                    <tr key={en.assetId} className="align-top">
                      <td className="px-3 py-1.5">
                        <a href={en.sourcePageUrl || undefined} target="_blank" rel="noreferrer noopener" className="text-sky-400 hover:underline">
                          {en.title || en.assetId.slice(0, 12)}
                        </a>
                        {en.youtube ? <div className="text-neutral-500">{en.youtube.channel} · {en.youtube.url}</div> : null}
                      </td>
                      <td>{en.provider}</td>
                      <td title={en.attributionText}>{en.license.code}</td>
                      <td>{en.author ?? "—"}</td>
                      <td className="max-w-48 truncate text-neutral-500" title={used.join(", ")}>
                        {used.length ? `${used.length} × ${used.slice(0, 2).join(", ")}` : "—"}
                      </td>
                      <td className="text-amber-300">{warn.join(" · ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {d.perLang.map((l) => (
          <section key={l.lang} className="space-y-2 rounded-lg border border-neutral-800 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t("credits.markdown", { lang: l.lang })}</h2>
              {l.md ? <CopyButton text={l.md} /> : null}
            </div>
            {l.take ? (
              <p className="text-xs text-neutral-400">
                {t("credits.voice")}: {l.take.provider} · {l.take.voiceId} · {l.take.license.code}
                {l.take.license.attributionText ? ` — ${l.take.license.attributionText}` : ""}
                {l.take.license.restrictions.includes("synthetic") || l.take.provider !== "recording" ? " · synthetic voice (disclose)" : ""}
              </p>
            ) : null}
            {l.md ? <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-neutral-950 p-3 text-xs text-neutral-300">{l.md}</pre> : <p className="text-sm text-neutral-500">{t("common.missingDoc")}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
