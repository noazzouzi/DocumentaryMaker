// /p/[slug]/render — renders (whole / chapter range), QA, timeline-only export, files.
import { GlProbe, P, QaReport, RenderDoc, Timeline, type RenderPresetId } from "@docmaker/core";
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { RenderPanel, type LangRenderData } from "@/components/RenderPanel";
import { fileExists, listExportFiles } from "@/server/files";
import { projectDirOf } from "@/server/runtime";
import { attempt, loadEngine, readDocOrNull } from "@/server/page";
import { readFile } from "node:fs/promises";

export const dynamic = "force-dynamic";

export default async function RenderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const e = r.engine;
  const data = await attempt(async () => {
    const [project, status] = await Promise.all([e.getProject(slug), e.status(slug)]);
    const dir = projectDirOf(e, slug);
    const langs: LangRenderData[] = await Promise.all(
      project.languages.map(async (lang) => {
        const tl = await readDocOrNull(e, slug, P.timeline(lang), Timeline).catch(() => null);
        const renders: LangRenderData["renders"] = {};
        for (const preset of ["draft", "master"] as RenderPresetId[]) {
          const [doc, qa, hasMp4] = await Promise.all([
            readDocOrNull(e, slug, P.renderDoc(lang, preset), RenderDoc).catch(() => null),
            readDocOrNull(e, slug, P.qaReport(lang, preset), QaReport).catch(() => null),
            fileExists(dir, P.renderFinal(lang, preset)),
          ]);
          renders[preset] = { doc: doc?.value ?? null, qa: qa?.value ?? null, hasMp4 };
        }
        return {
          lang,
          chapters: tl?.value.chapters ?? [],
          fps: tl?.value.fps ?? null,
          renders,
          exportFiles: await listExportFiles(dir, lang),
        };
      }),
    );
    let glProbe: string | null = null;
    try {
      const g = GlProbe.safeParse(JSON.parse(await readFile(e.config.paths.glProbe, "utf8")));
      if (g.success) glProbe = `${g.data.chosen}${g.data.gpu ? " (GPU)" : ""}`;
    } catch {
      /* not probed yet */
    }
    return { project, status, langs, glProbe };
  });
  if (!data.ok) return <EngineUnavailable error={data.error} />;
  const d = data.value;
  return <RenderPanel project={d.project} langs={d.langs} stages={d.status.stages} glProbe={d.glProbe} activeJobId={d.status.activeJobId} />;
}
