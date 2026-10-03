// /p/[slug] — overview (stages, gates, run controls, live job log).
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { ProjectOverview } from "@/components/ProjectOverview";
import { attempt, loadEngine } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function OverviewPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const [project, status, jobs] = await Promise.all([attempt(() => r.engine.getProject(slug)), attempt(() => r.engine.status(slug)), attempt(() => r.engine.listJobs(slug))]);
  if (!project.ok) return <EngineUnavailable error={project.error} />;
  if (!status.ok) return <EngineUnavailable error={status.error} />;
  return <ProjectOverview project={project.value} initialStatus={status.value} initialJobs={jobs.ok ? jobs.value : []} />;
}
