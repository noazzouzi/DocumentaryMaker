// /p/[slug]/research — dossier, fact sheet, person approvals, style card + theme override.
import { ApprovalsDoc, FactSheet, P, ResearchDossier, StyleSuggestion } from "@docmaker/core";
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { ResearchView } from "@/components/ResearchView";
import { attempt, loadEngine, readDocOrNull } from "@/server/page";

export const dynamic = "force-dynamic";

const TABS = ["dossier", "sources", "people", "timeline", "claims", "quotes", "figures", "gaps"] as const;

export default async function ResearchPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { slug } = await params;
  const tabParam = (await searchParams).tab;
  const initialTab = TABS.find((x) => x === tabParam) ?? "dossier";
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const e = r.engine;
  const data = await attempt(async () => {
    const [project, dossier, facts, suggestion, approvals, styles] = await Promise.all([
      e.getProject(slug),
      readDocOrNull(e, slug, P.dossier, ResearchDossier),
      readDocOrNull(e, slug, P.factsheet, FactSheet),
      readDocOrNull(e, slug, P.styleSuggestion, StyleSuggestion),
      readDocOrNull(e, slug, P.approvals, ApprovalsDoc),
      e.listStyles(),
    ]);
    const approved = (approvals?.value.approvals ?? []).filter((a) => a.gate === "person-ack").flatMap((a) => a.items);
    return { project, dossier: dossier?.value ?? null, facts: facts?.value ?? null, suggestion: suggestion?.value ?? null, styles, approved };
  });
  if (!data.ok) return <EngineUnavailable error={data.error} />;
  const d = data.value;
  return <ResearchView project={d.project} dossier={d.dossier} facts={d.facts} suggestion={d.suggestion} styles={d.styles} approvedPersons={d.approved} initialTab={initialTab} />;
}
