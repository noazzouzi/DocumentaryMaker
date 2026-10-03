// Project shell: title, slug, languages and the tab bar.
import type React from "react";
import { notFound } from "next/navigation";
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { ProjectNav } from "@/components/ProjectNav";
import { attempt, loadEngine } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({ children, params }: { children: React.ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const p = await attempt(() => r.engine.getProject(slug));
  if (!p.ok && (p.error.code === "UPSTREAM_MISSING" || p.error.code === "VALIDATION")) notFound();
  if (!p.ok) return <EngineUnavailable error={p.error} />;
  const project = p.value;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight">{project.title || project.idea}</h1>
          <p className="font-mono text-xs text-neutral-500">
            {project.slug} · {project.languages.map((l) => (l === project.primaryLang ? `${l.toUpperCase()}*` : l.toUpperCase())).join(" · ")} · {project.targetMinutes} min · {project.styleId ?? "—"}
          </p>
        </div>
      </div>
      <ProjectNav slug={project.slug} primary={project.primaryLang} />
      {children}
    </div>
  );
}
