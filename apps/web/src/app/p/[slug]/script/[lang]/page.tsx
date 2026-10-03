// /p/[slug]/script/[lang] — script editor + fact-check panel.
import { notFound } from "next/navigation";
import { BeatSlicesDoc, FactCheck, Lang, P, Script, StyleSuggestion, docHash } from "@docmaker/core";
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { LangSwitch } from "@/components/LangSwitch";
import { ScriptEditor } from "@/components/ScriptEditor";
import { jobWrites } from "@/lib/jobs";
import { attempt, loadEngine, pageI18n, readDocOrNull } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function ScriptPage({ params }: { params: Promise<{ slug: string; lang: string }> }) {
  const { slug, lang: rawLang } = await params;
  const lp = Lang.safeParse(rawLang);
  if (!lp.success) notFound();
  const lang = lp.data;
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const e = r.engine;
  const { t } = await pageI18n(e);
  const data = await attempt(async () => {
    const project = await e.getProject(slug);
    const [script, fc, primary, slices, suggestion, status] = await Promise.all([
      readDocOrNull(e, slug, P.script(lang), Script),
      readDocOrNull(e, slug, P.factcheck(lang), FactCheck),
      lang !== project.primaryLang ? readDocOrNull(e, slug, P.script(project.primaryLang), Script) : Promise.resolve(null),
      readDocOrNull(e, slug, P.beatSlices(lang), BeatSlicesDoc),
      readDocOrNull(e, slug, P.styleSuggestion, StyleSuggestion),
      e.status(slug),
    ]);
    const job = status.activeJobId ? await e.getJob(status.activeJobId) : null;
    return { project, script, fc, primary, slices, suggestion, job };
  });
  if (!data.ok) return <EngineUnavailable error={data.error} />;
  const d = data.value;
  if (!d.project.languages.includes(lang)) notFound();
  return (
    <div className="space-y-3">
      <LangSwitch langs={d.project.languages} current={lang} hrefFor={`/p/${slug}/script/{lang}`} />
      {!d.script ? (
        <p className="text-neutral-500">{t("script.noScript")}</p>
      ) : (
        <ScriptEditor
          key={`${lang}-${d.script.etag}`}
          slug={slug}
          lang={lang}
          primaryLang={d.project.primaryLang}
          script={d.script.value}
          etag={d.script.etag}
          factcheck={d.fc?.value ?? null}
          factcheckEtag={d.fc?.etag ?? null}
          primaryScript={d.primary?.value ?? null}
          slicesDocHash={d.slices ? docHash(d.slices.value) : null}
          riskFlags={d.suggestion?.value.riskFlags ?? []}
          readOnly={jobWrites(d.job, ["script", "beatslice", "factcheck"])}
        />
      )}
    </div>
  );
}
