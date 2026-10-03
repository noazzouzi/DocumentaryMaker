// /p/[slug]/outline — outline editor and approval.
import { ApprovalsDoc, Outline, P, docHash } from "@docmaker/core";
import { EngineUnavailable } from "@/components/EngineUnavailable";
import { OutlineEditor } from "@/components/OutlineEditor";
import { jobWrites } from "@/lib/jobs";
import { attempt, loadEngine, pageI18n, readDocOrNull } from "@/server/page";

export const dynamic = "force-dynamic";

export default async function OutlinePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const r = await loadEngine();
  if (!r.ok) return <EngineUnavailable error={r.error} />;
  const e = r.engine;
  const { t } = await pageI18n(e);
  const data = await attempt(async () => {
    const [outline, approvals, status] = await Promise.all([readDocOrNull(e, slug, P.outline, Outline), readDocOrNull(e, slug, P.approvals, ApprovalsDoc), e.status(slug)]);
    const job = status.activeJobId ? await e.getJob(status.activeJobId) : null;
    return { outline, approvals: approvals?.value ?? null, job };
  });
  if (!data.ok) return <EngineUnavailable error={data.error} />;
  const { outline, approvals, job } = data.value;
  if (!outline) return <p className="text-neutral-500">{t("common.missingDoc")}</p>;
  const h = docHash(outline.value);
  const approved = (approvals?.approvals ?? []).some((a) => a.gate === "outline-approval" && a.planHash === h);
  return <OutlineEditor key={outline.etag ?? "x"} slug={slug} initial={outline.value} etag={outline.etag} approved={approved} readOnly={jobWrites(job, ["outline"])} />;
}
