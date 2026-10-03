// /p/[slug]/preview/[lang] — Remotion Player synced with the script; overrides.
import { notFound } from "next/navigation";
import { ActiveTake, BeatPlansDoc, Lang, OverridesDoc, P, ProgramLayout, Script, Timeline, TimelineLintDoc, VoiceTrack, hashJson } from "@docmaker/core";
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { LangSwitch } from "@/components/LangSwitch";
import { PreviewView } from "@/components/PreviewView";
import { attempt, loadEngine, pageI18n, readDocOrNull } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function PreviewPage({ params }: { params: Promise<{ slug: string; lang: string }> }) {
  const { slug, lang: raw } = await params;
  const lp = Lang.safeParse(raw);
  if (!lp.success) notFound();
  const lang = lp.data;
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const e = r.engine;
  const { t } = await pageI18n(e);
  const data = await attempt(async () => {
    const project = await e.getProject(slug);
    const [timeline, layout, home, overrides, lint, plans, active, script] = await Promise.all([
      readDocOrNull(e, slug, P.timeline(lang), Timeline),
      readDocOrNull(e, slug, P.layout(lang), ProgramLayout),
      e.homeConfig(),
      readDocOrNull(e, slug, P.overrides(lang), OverridesDoc),
      readDocOrNull(e, slug, P.timelineLint(lang), TimelineLintDoc),
      readDocOrNull(e, slug, P.beatPlans, BeatPlansDoc),
      readDocOrNull(e, slug, P.activeTake(lang), ActiveTake),
      readDocOrNull(e, slug, P.script(lang), Script),
    ]);
    const take = active ? await readDocOrNull(e, slug, P.take(lang, active.value.takeId), VoiceTrack) : null;
    const tts = new Map((script?.value.chapters ?? []).flatMap((c) => c.segments.map((s) => [s.id, hashJson(s.ttsText)] as const)));
    const changed = (take?.value.segments ?? []).filter((s) => s.mode === "narration" && tts.has(s.segmentId) && tts.get(s.segmentId) !== s.ttsTextHash).length;
    return { project, timeline, layout, home, overrides, lint, plans, changed };
  });
  if (!data.ok) return <EngineUnavailable error={data.error} />;
  const d = data.value;
  if (!d.project.languages.includes(lang)) notFound();
  return (
    <div className="space-y-3">
      <LangSwitch langs={d.project.languages} current={lang} hrefFor={`/p/${slug}/preview/{lang}`} />
      {!d.timeline ? (
        <p className="text-neutral-500">{t("preview.noTimeline")}</p>
      ) : (
        <PreviewView
          key={`${lang}-${d.timeline.etag}`}
          slug={slug}
          lang={lang}
          timeline={d.timeline.value}
          layout={d.layout?.value ?? null}
          licenseAcknowledged={d.home.remotionLicense !== null}
          overrides={d.overrides?.value ?? null}
          overridesEtag={d.overrides?.etag ?? null}
          rejected={d.lint?.value.rejectedOverrides ?? []}
          changedSegments={d.changed}
          planKeys={Object.fromEntries((d.plans?.value.plans ?? []).map((pl) => [pl.id, pl.planKey]))}
        />
      )}
    </div>
  );
}
