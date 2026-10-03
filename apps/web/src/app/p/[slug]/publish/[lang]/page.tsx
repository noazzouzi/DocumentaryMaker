// /p/[slug]/publish/[lang] — title, thumbnail text, description; fact-check re-run; publish kit preview.
import { notFound } from "next/navigation";
import { Lang, P, Script, StyleSuggestion } from "@docmaker/core";
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { LangSwitch } from "@/components/LangSwitch";
import { PublishEditor } from "@/components/PublishEditor";
import { attempt, loadEngine, readDocOrNull } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function PublishPage({ params }: { params: Promise<{ slug: string; lang: string }> }) {
  const { slug, lang: raw } = await params;
  const lp = Lang.safeParse(raw);
  if (!lp.success) notFound();
  const lang = lp.data;
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const e = r.engine;
  const data = await attempt(async () => {
    const [project, suggestion, script] = await Promise.all([e.getProject(slug), readDocOrNull(e, slug, P.styleSuggestion, StyleSuggestion), readDocOrNull(e, slug, P.script(lang), Script)]);
    return { project, suggestion: suggestion?.value ?? null, script: script?.value ?? null };
  });
  if (!data.ok) return <EngineUnavailable error={data.error} />;
  const d = data.value;
  if (!d.project.languages.includes(lang)) notFound();
  return (
    <div className="space-y-3">
      <LangSwitch langs={d.project.languages} current={lang} hrefFor={`/p/${slug}/publish/{lang}`} />
      <PublishEditor key={lang} project={d.project} lang={lang} titleOptions={d.suggestion?.titleOptions ?? []} thumbOptions={d.suggestion?.thumbnailTextOptions ?? []} scriptTitle={d.script?.title ?? null} />
    </div>
  );
}
