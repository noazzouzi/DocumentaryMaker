// /p/[slug]/scenes?lang= — scene board, asset picker, manual clips.
import { BeatPlansDoc, BeatSlicesDoc, FactSheet, FrozenDoc, Lang, P, PicksDoc, Script, UserPicksDoc } from "@docmaker/core";
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { LangSwitch } from "@/components/LangSwitch";
import { SceneBoard } from "@/components/SceneBoard";
import { jobWrites } from "@/lib/jobs";
import { attempt, loadEngine, readDocOrNull } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function ScenesPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const e = r.engine;
  const data = await attempt(async () => {
    const project = await e.getProject(slug);
    const lp = Lang.safeParse(sp.lang);
    const lang = lp.success && project.languages.includes(lp.data) ? lp.data : project.primaryLang;
    const [plans, slices, picks, userPicks, frozen, facts, script, status] = await Promise.all([
      readDocOrNull(e, slug, P.beatPlans, BeatPlansDoc),
      readDocOrNull(e, slug, P.beatSlices(lang), BeatSlicesDoc),
      readDocOrNull(e, slug, P.picks, PicksDoc),
      readDocOrNull(e, slug, P.userPicks, UserPicksDoc),
      readDocOrNull(e, slug, P.frozen, FrozenDoc),
      readDocOrNull(e, slug, P.factsheet, FactSheet),
      readDocOrNull(e, slug, P.script(project.primaryLang), Script),
      e.status(slug),
    ]);
    const job = status.activeJobId ? await e.getJob(status.activeJobId) : null;
    return { project, lang, plans, slices, picks, userPicks, frozen, facts, script, job };
  });
  if (!data.ok) return <EngineUnavailable error={data.error} />;
  const d = data.value;
  return (
    <div className="space-y-3">
      <LangSwitch langs={d.project.languages} current={d.lang} hrefFor={`/p/${slug}/scenes?lang={lang}`} />
      <SceneBoard
        key={`${d.lang}-${d.userPicks?.etag ?? "none"}-${d.slices?.etag ?? "none"}`}
        project={d.project}
        lang={d.lang}
        plans={d.plans?.value.plans ?? []}
        slices={d.slices?.value ?? null}
        slicesEtag={d.slices?.etag ?? null}
        picks={d.picks?.value ?? null}
        userPicks={d.userPicks?.value ?? null}
        userPicksEtag={d.userPicks?.etag ?? null}
        frozen={d.frozen?.value.assets ?? {}}
        facts={d.facts?.value ?? null}
        clipSegments={(d.script?.value.chapters ?? []).flatMap((c) => c.segments).filter((s) => s.type === "clip")}
        readOnly={jobWrites(d.job, ["beats", "beatslice", "assets"])}
      />
    </div>
  );
}
