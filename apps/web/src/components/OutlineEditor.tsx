"use client";
// /p/[slug]/outline: title, thesis (edit or confirm → thesisConfirmed), chapters, teasers, loops, budgets; impact dialog
// before saving; Approve outline (bound to docHash of the saved outline).
import { useRouter } from "next/navigation";
import { useState } from "react";
import { P, docHash, type ChapterPlan, type Outline } from "@docmaker/core";
import { api, errorText } from "@/lib/api";
import { useI18n } from "./I18nProvider";
import { useDocEditor } from "./useDocEditor";
import { DocStatus } from "./DocStatus";
import { HistoryMenu } from "./HistoryMenu";
import { ImpactDialog } from "./ImpactDialog";
import { Badge, Banner, Button, Card, ErrorText, Field, IssueList, cx, inputCls } from "./ui";

export function OutlineEditor({ slug, initial, etag, approved, readOnly }: { slug: string; initial: Outline; etag: string | null; approved: boolean; readOnly: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const ed = useDocEditor<Outline>(slug, P.outline, initial, etag);
  const [impact, setImpact] = useState<Record<string, unknown> | null>(null);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isApproved, setApproved] = useState(approved);
  const o = ed.value!;
  const ro = readOnly;

  const set = (patch: Partial<Outline>) => ed.update((v) => ({ ...v, ...patch, updatedAt: new Date().toISOString() }));
  const setChapter = (i: number, patch: Partial<ChapterPlan>) =>
    ed.update((v) => ({ ...v, chapters: v.chapters.map((c, j) => (j === i ? { ...c, ...patch } : c)), updatedAt: new Date().toISOString() }));
  const acts = [...new Set(o.chapters.map((c) => c.act))];

  const doSave = async () => {
    setImpact(null);
    if (await ed.save()) {
      setApproved(false);
      router.refresh();
    }
  };
  const approve = async () => {
    if (!ed.saved) return;
    setApproving(true);
    setError(null);
    try {
      await api(`/api/projects/${slug}/approvals`, { method: "POST", json: { gate: "outline-approval", stage: "script", lang: null, planHash: docHash(ed.saved), note: "", items: [], itemNotes: {} } });
      setApproved(true);
      await ed.reload(); // the engine may persist thesisConfirmed
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setApproving(false);
    }
  };
  const canApprove = !ed.dirty && (ed.saved?.thesisConfirmed ?? false) && !ro;

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <DocStatus conflict={ed.conflict} readOnly={ro} error={ed.error} onReload={() => void ed.reload()} />
        {isApproved && !ed.dirty ? <Banner tone="green">{t("outline.approved")}</Banner> : null}
        <Card
          actions={
            <>
              <HistoryMenu slug={slug} rel={P.outline} onReverted={() => void ed.reload()} disabled={ro} />
              <Button size="sm" busy={ed.saving} disabled={!ed.dirty || ro} onClick={() => setImpact({ doc: P.outline })}>
                {t("common.save")}
              </Button>
              <Button size="sm" variant="primary" busy={approving} disabled={!canApprove || isApproved} onClick={approve} data-testid="approve-outline">
                {t("outline.approve")}
              </Button>
            </>
          }
          title={o.storyShape}
        >
          <div className="grid gap-3">
            <Field label={t("outline.title")}>
              <input className={inputCls} value={o.title} disabled={ro} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label={t("outline.thesis")}>
              <textarea className={cx(inputCls, "min-h-20")} value={o.thesis} disabled={ro} onChange={(e) => set({ thesis: e.target.value, thesisConfirmed: true })} data-testid="thesis" />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-amber-500" checked={o.thesisConfirmed} disabled={ro} onChange={(e) => set({ thesisConfirmed: e.target.checked })} data-testid="confirm-thesis" />
              {o.thesisConfirmed ? t("outline.thesisConfirmed") : t("outline.thesisConfirm")}
            </label>
            {!o.thesisConfirmed ? <p className="text-xs text-amber-400">{t("outline.needsThesis")}</p> : null}
          </div>
        </Card>
        <Card title={t("outline.chapters")}>
          <ol className="space-y-3">
            {o.chapters.map((c, i) => (
              <li key={c.id} className="rounded-md border border-neutral-800 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-mono text-xs text-neutral-500">{c.id}</span>
                  <input className={cx(inputCls, "font-semibold")} value={c.title} disabled={ro} onChange={(e) => setChapter(i, { title: e.target.value })} aria-label={t("outline.chapter.title")} />
                </div>
                <div className="grid gap-2 sm:grid-cols-[10rem_7rem_1fr]">
                  <Field label={t("outline.chapter.act")}>
                    <select className={inputCls} value={c.act} disabled={ro} onChange={(e) => setChapter(i, { act: e.target.value })}>
                      {acts.map((a) => (
                        <option key={a}>{a}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t("outline.chapter.seconds")}>
                    <input type="number" min={5} className={inputCls} value={c.targetSec} disabled={ro} onChange={(e) => setChapter(i, { targetSec: Math.max(5, Number(e.target.value) || 5) })} />
                  </Field>
                  <Field label={t("outline.chapter.purpose")}>
                    <input className={inputCls} value={c.purpose} disabled={ro} onChange={(e) => setChapter(i, { purpose: e.target.value })} />
                  </Field>
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Field label={t("outline.chapter.exitHook")}>
                    <input className={inputCls} value={c.exitHook} disabled={ro} onChange={(e) => setChapter(i, { exitHook: e.target.value })} />
                  </Field>
                  <label className="flex items-end gap-2 pb-2 text-xs text-neutral-300">
                    <input type="checkbox" className="accent-amber-500" checked={c.adBreakAfter} disabled={ro} onChange={(e) => setChapter(i, { adBreakAfter: e.target.checked })} />
                    {t("outline.chapter.adBreak")}
                  </label>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <IssueList issues={ed.issues} />
        <ErrorText error={error} />
      </div>
      <div className="space-y-4">
        <Card title={t("outline.budget")}>
          <ul className="space-y-2 text-sm">
            {Object.values(o.budgets).map((b) =>
              b ? (
                <li key={b.lang} className="rounded-md border border-neutral-800 p-2">
                  <div className="flex items-center gap-2">
                    <Badge>{b.lang}</Badge>
                    <span>{t("outline.runtime", { min: (b.runtimeSec / 60).toFixed(1) })}</span>
                  </div>
                  <p className="text-xs text-neutral-400">
                    {t("outline.words", { n: b.words })} · {b.chars} chars · {b.charsPerSec} cps · ~{b.beatsApprox} beats
                  </p>
                </li>
              ) : null,
            )}
          </ul>
        </Card>
        <Card title={t("outline.teasers")}>
          <ul className="space-y-1 text-sm text-neutral-300">
            {o.hookTeasers.map((h) => (
              <li key={h.id}>
                {h.teaser} <span className="font-mono text-xs text-neutral-500">→ {h.paidOffIn}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t("outline.loops")}>
          <ul className="space-y-1 text-sm text-neutral-300">
            {o.loops.map((l) => (
              <li key={l.id}>
                <span className="font-mono text-xs text-neutral-500">{l.id}</span> {l.question}{" "}
                <span className="font-mono text-xs text-neutral-500">
                  {l.openedIn}→{l.closedIn}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <ImpactDialog slug={slug} request={impact} onCancel={() => setImpact(null)} onProceed={doSave} />
    </div>
  );
}
