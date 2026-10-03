// /p/[slug]/voice/[lang] — takes, voice settings, estimate, generation, recordings, teleprompter recorder.
import { notFound } from "next/navigation";
import { ActiveTake, Lang, P, Script, VoiceTrack } from "@docmaker/core";
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { LangSwitch } from "@/components/LangSwitch";
import { VoicePanel } from "@/components/VoicePanel";
import { jobWrites } from "@/lib/jobs";
import { listTakeIds } from "@/server/files";
import { projectDirOf } from "@/server/runtime";
import { attempt, loadEngine, readDocOrNull } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function VoicePage({ params }: { params: Promise<{ slug: string; lang: string }> }) {
  const { slug, lang: raw } = await params;
  const lp = Lang.safeParse(raw);
  if (!lp.success) notFound();
  const lang = lp.data;
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const e = r.engine;
  const data = await attempt(async () => {
    const project = await e.getProject(slug);
    const ids = await listTakeIds(projectDirOf(e, slug), lang);
    const [active, script, status, ...takes] = await Promise.all([
      readDocOrNull(e, slug, P.activeTake(lang), ActiveTake),
      readDocOrNull(e, slug, P.script(lang), Script),
      e.status(slug),
      ...ids.map((id) => readDocOrNull(e, slug, P.take(lang, id), VoiceTrack).catch(() => null)),
    ]);
    const job = status.activeJobId ? await e.getJob(status.activeJobId) : null;
    return { project, active, script, takes: takes.filter((x): x is NonNullable<typeof x> => x !== null).map((x) => x.value), job };
  });
  if (!data.ok) return <EngineUnavailable error={data.error} />;
  const d = data.value;
  if (!d.project.languages.includes(lang)) notFound();
  return (
    <div className="space-y-3">
      <LangSwitch langs={d.project.languages} current={lang} hrefFor={`/p/${slug}/voice/{lang}`} />
      <VoicePanel
        key={`${lang}-${d.active?.etag ?? "none"}`}
        project={d.project}
        lang={lang}
        active={d.active?.value ?? null}
        activeEtag={d.active?.etag ?? null}
        takes={d.takes.sort((a, b) => b.createdAt.localeCompare(a.createdAt))}
        script={d.script?.value ?? null}
        readOnly={jobWrites(d.job, ["voice"])}
      />
    </div>
  );
}
