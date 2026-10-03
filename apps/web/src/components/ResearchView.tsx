"use client";
// /p/[slug]/research: dossier; fact-sheet tabs (sources, people + person approvals, timeline, claims, quotes, figures,
// gaps); style card (refined ranking, titles, thumbnail texts, risk flags, theme override) with "Use this style".
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BUILTIN_FONT_FAMILIES, PENDING_STATUSES, type FactSheet, type Project, type ResearchDossier, type StyleSuggestion, type ThemeOverride } from "@docmaker/core";
import type { StyleSummary } from "@docmaker/styles";
import { api, errorText } from "@/lib/api";
import { useI18n } from "./I18nProvider";
import { ImpactDialog } from "./ImpactDialog";
import { Badge, Banner, Button, Card, ErrorText, Field, Tabs, cx, inputCls } from "./ui";

type Tab = "dossier" | "sources" | "people" | "timeline" | "claims" | "quotes" | "figures" | "gaps";

function PersonApproval({ slug, personId, onDone }: { slug: string; personId: string; onDone: () => void }) {
  const { t } = useI18n();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${slug}/approvals`, { method: "POST", json: { gate: "person-ack", stage: "assets", lang: null, note: note.trim(), items: [personId], itemNotes: { [personId]: note.trim() } } });
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <input className={cx(inputCls, "flex-1")} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("research.personNote")} />
      <Button size="sm" variant="primary" busy={busy} disabled={note.trim().length < 10} onClick={approve}>
        {t("research.approvePerson")}
      </Button>
      <ErrorText error={error} />
    </div>
  );
}

function ThemeEditor({ project, suggested }: { project: Project; suggested: ThemeOverride | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const init: ThemeOverride = project.themeOverride ?? suggested ?? { accent: null, backdropRecipe: null, texture: null, fontHeadline: null };
  const [th, setTh] = useState<ThemeOverride>(init);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const empty = !th.accent && !th.backdropRecipe && !th.texture && !th.fontHeadline;
      await api(`/api/projects/${project.slug}`, { method: "PATCH", json: { themeOverride: empty ? null : th } });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <Field label={t("research.theme.accent")}>
        <div className="flex gap-2">
          <input type="color" value={th.accent?.slice(0, 7) ?? "#f59e0b"} onChange={(e) => setTh({ ...th, accent: e.target.value })} className="h-8 w-10 rounded border border-neutral-700 bg-neutral-950" />
          <input className={inputCls} value={th.accent ?? ""} placeholder="#rrggbb" onChange={(e) => setTh({ ...th, accent: /^#[0-9a-fA-F]{6}$/.test(e.target.value) ? e.target.value : e.target.value === "" ? null : th.accent })} />
        </div>
      </Field>
      <Field label={t("research.theme.backdrop")}>
        <select className={inputCls} value={th.backdropRecipe ?? ""} onChange={(e) => setTh({ ...th, backdropRecipe: (e.target.value || null) as ThemeOverride["backdropRecipe"] })}>
          <option value="">—</option>
          {["gradientGrid", "paper", "darkNoise", "blurSelf"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label={t("research.theme.texture")}>
        <select className={inputCls} value={th.texture ?? ""} onChange={(e) => setTh({ ...th, texture: (e.target.value || null) as ThemeOverride["texture"] })}>
          <option value="">—</option>
          {["none", "paper", "film", "scanlines", "halftone"].map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      </Field>
      <Field label={t("research.theme.font")}>
        <select className={inputCls} value={th.fontHeadline ?? ""} onChange={(e) => setTh({ ...th, fontHeadline: e.target.value || null })}>
          <option value="">—</option>
          {BUILTIN_FONT_FAMILIES.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </Field>
      <div className="flex items-center gap-2 sm:col-span-2">
        <Button size="sm" busy={busy} onClick={save}>
          {t("research.theme.save")}
        </Button>
        {saved ? <span className="text-xs text-emerald-400">{t("common.saved")}</span> : null}
        <ErrorText error={error} />
      </div>
    </div>
  );
}

export function ResearchView({ project, dossier, facts, suggestion, styles, approvedPersons }: {
  project: Project; dossier: ResearchDossier | null; facts: FactSheet | null; suggestion: StyleSuggestion | null; styles: StyleSummary[]; approvedPersons: string[];
}) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dossier");
  const [impactFor, setImpactFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#people") setTab("people");
  }, []);
  const slug = project.slug;
  const styleName = (id: string) => styles.find((s) => s.id === id)?.names[lang] ?? id;

  const useStyle = async (styleId: string) => {
    setError(null);
    try {
      if (styleId !== project.styleId) await api(`/api/projects/${slug}`, { method: "PATCH", json: { styleId } });
      await api(`/api/projects/${slug}/approvals`, { method: "POST", json: { gate: "style-confirm", stage: "outline", lang: null, note: "", items: [styleId], itemNotes: {} } });
      setImpactFor(null);
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    }
  };

  const tabs: { key: Tab; label: string; badge?: React.ReactNode }[] = [
    { key: "dossier", label: t("research.dossier") },
    { key: "sources", label: t("research.sources"), badge: facts ? <Badge>{facts.sources.length}</Badge> : null },
    { key: "people", label: t("research.people"), badge: facts ? <Badge tone={facts.people.some((p) => !p.publicFigure && !p.isMinorOrPrivateVictim && !approvedPersons.includes(p.id)) ? "amber" : "neutral"}>{facts.people.length}</Badge> : null },
    { key: "timeline", label: t("research.timeline") },
    { key: "claims", label: t("research.claims") },
    { key: "quotes", label: t("research.quotes") },
    { key: "figures", label: t("research.figures") },
    { key: "gaps", label: t("research.gaps") },
  ];
  const src = (ids: string[]) => ids.map((id) => facts?.sources.find((s) => s.id === id)).filter(Boolean);

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
      <div className="min-w-0 space-y-3">
        <Tabs tabs={tabs} value={tab} onChange={setTab} />
        {!facts && tab !== "dossier" ? <p className="text-sm text-neutral-500">{t("common.missingDoc")}</p> : null}
        {tab === "dossier" ? (
          dossier ? (
            <article className="whitespace-pre-wrap rounded-lg border border-neutral-800 bg-neutral-900/40 p-4 text-sm leading-relaxed text-neutral-200">{dossier.markdown}</article>
          ) : (
            <p className="text-sm text-neutral-500">{t("common.missingDoc")}</p>
          )
        ) : null}
        {facts && tab === "sources" ? (
          <ul className="space-y-2 text-sm">
            {facts.sources.map((s) => (
              <li key={s.id} className="rounded-md border border-neutral-800 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-neutral-500">{s.id}</span>
                  <a href={s.url} target="_blank" rel="noreferrer noopener" className="font-medium text-amber-300 hover:underline">
                    {s.title || s.url}
                  </a>
                  <Badge tone={s.reliability === "high" ? "green" : s.reliability === "low" ? "red" : "amber"}>{s.reliability}</Badge>
                  <Badge>{s.sourceType.replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-neutral-500">{s.publisher} {s.publishedAt}</span>
                </div>
                {s.snippets[0] ? <p className="mt-1 text-xs text-neutral-400">“{s.snippets[0]}”</p> : null}
              </li>
            ))}
          </ul>
        ) : null}
        {facts && tab === "people" ? (
          <ul className="space-y-2 text-sm" id="people">
            {facts.people.map((p) => {
              const approved = approvedPersons.includes(p.id);
              return (
                <li key={p.id} className="rounded-md border border-neutral-800 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-neutral-500">{p.id}</span>
                    <span className="font-semibold">{p.name}</span>
                    {p.isMinorOrPrivateVictim ? <Badge tone="red">{t("research.minor")}</Badge> : p.publicFigure ? <Badge tone="green">{t("research.public")}</Badge> : <Badge tone="amber">{t("research.private")}</Badge>}
                    {p.wikidataQid ? (
                      <a href={`https://www.wikidata.org/wiki/${p.wikidataQid}`} target="_blank" rel="noreferrer noopener" className="font-mono text-xs text-sky-400 hover:underline">
                        {p.wikidataQid}
                      </a>
                    ) : null}
                    {approved ? <Badge tone="green">{t("research.approved")}</Badge> : null}
                  </div>
                  <p className="text-xs text-neutral-400">{p.roleInStory}</p>
                  {!p.publicFigure && !p.isMinorOrPrivateVictim && !approved ? <PersonApproval slug={slug} personId={p.id} onDone={() => router.refresh()} /> : null}
                </li>
              );
            })}
          </ul>
        ) : null}
        {facts && tab === "timeline" ? (
          <ol className="space-y-1.5 text-sm">
            {[...facts.timeline].sort((a, b) => a.date.localeCompare(b.date)).map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-24 shrink-0 font-mono text-xs text-neutral-500">{e.date}</span>
                <div>
                  <span className="font-medium">{e.title}</span> <Badge>{e.status.replace(/_/g, " ")}</Badge>
                  <p className="text-xs text-neutral-400">{e.whatHappened}</p>
                </div>
              </li>
            ))}
          </ol>
        ) : null}
        {facts && tab === "claims" ? (
          <ul className="space-y-2 text-sm">
            {facts.claims.map((c) => (
              <li key={c.id} className="rounded-md border border-neutral-800 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-neutral-500">{c.id}</span>
                  <Badge tone={PENDING_STATUSES.includes(c.status) ? "amber" : "neutral"}>{c.status.replace(/_/g, " ")}</Badge>
                  <Badge tone={c.sensitivity === "high" ? "red" : c.sensitivity === "medium" ? "amber" : "neutral"}>{c.sensitivity}</Badge>
                </div>
                <p className="mt-1">{c.summary}</p>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-neutral-400">
                  {c.jurisdiction ? (
                    <>
                      <dt>{t("research.jurisdiction")}</dt>
                      <dd>{c.jurisdiction}</dd>
                    </>
                  ) : null}
                  {c.decisionDate ? (
                    <>
                      <dt>{t("research.decision")}</dt>
                      <dd>{c.decisionDate}</dd>
                    </>
                  ) : null}
                  {c.subjectResponse ? (
                    <>
                      <dt>{t("research.response")}</dt>
                      <dd>{c.subjectResponse}</dd>
                    </>
                  ) : null}
                  <dt>{t("research.asOf")}</dt>
                  <dd>{c.asOf}</dd>
                  <dt>{t("research.sources")}</dt>
                  <dd>{src(c.sourceIds).map((s) => s!.id).join(", ")}</dd>
                </dl>
              </li>
            ))}
          </ul>
        ) : null}
        {facts && tab === "quotes" ? (
          <ul className="space-y-2 text-sm">
            {facts.quotes.map((q) => (
              <li key={q.id} className="rounded-md border border-neutral-800 p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-neutral-500">{q.id}</span>
                  <span className="text-xs">{facts.people.find((p) => p.id === q.speakerId)?.name ?? q.speakerId}</span>
                  <Badge tone={q.verification === "verbatim" ? "green" : q.verification === "fuzzy" ? "amber" : q.verification === "not-found" ? "red" : "neutral"}>{q.verification}</Badge>
                  {q.verifiedBy !== "none" ? <Badge tone="blue">{q.verifiedBy}</Badge> : null}
                  <span className="text-xs text-neutral-500">{q.medium.replace(/_/g, " ")} · {q.date}</span>
                </div>
                <blockquote className="mt-1 border-l-2 border-neutral-700 pl-2 italic">{q.verbatim}</blockquote>
              </li>
            ))}
          </ul>
        ) : null}
        {facts && tab === "figures" ? (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-neutral-800">
              {facts.figures.map((f) => (
                <tr key={f.id}>
                  <td className="py-1 font-mono text-xs text-neutral-500">{f.id}</td>
                  <td>{f.label}</td>
                  <td className="text-right font-mono">
                    {f.value.toLocaleString(lang)} {f.unit}
                  </td>
                  <td className="pl-3 text-xs text-neutral-500">{f.asOf}</td>
                  <td>{f.chartable ? <Badge tone="blue">chart</Badge> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {facts && tab === "gaps" ? (
          <ul className="list-inside list-disc space-y-1 text-sm text-neutral-300">
            {facts.gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="space-y-4" id="style">
        <Card title={t("research.styleCard")}>
          {!suggestion ? <p className="text-sm text-neutral-500">{t("common.missingDoc")}</p> : null}
          {project.styleConfirmed ? <Banner tone="green">{styleName(project.styleId ?? "")} ✓</Banner> : null}
          {suggestion ? (
            <div className="space-y-3 text-sm">
              <ul className="space-y-1.5">
                {suggestion.ranked.map((r) => (
                  <li key={r.styleId} className={cx("rounded-md border p-2", r.styleId === project.styleId ? "border-amber-500" : "border-neutral-800")}>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{styleName(r.styleId)}</span>
                      <span className="ml-auto font-mono text-xs text-neutral-500">{Math.round(r.score * 100)}%</span>
                    </div>
                    <p className="text-xs text-neutral-400">{r.why}</p>
                    <Button size="sm" className="mt-1.5" variant={r.styleId === suggestion.recommendedStyleId ? "primary" : "secondary"} onClick={() => setImpactFor(r.styleId)} disabled={project.styleConfirmed && r.styleId === project.styleId}>
                      {t("research.useStyle")}
                    </Button>
                  </li>
                ))}
              </ul>
              {suggestion.riskFlags.filter((f) => f !== "none").length ? (
                <div className="flex flex-wrap gap-1">
                  {suggestion.riskFlags.filter((f) => f !== "none").map((f) => (
                    <Badge key={f} tone="red">
                      {f.replace(/_/g, " ")}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <div>
                <p className="text-xs uppercase text-neutral-500">{t("research.titles")}</p>
                <ul className="list-inside list-disc text-neutral-300">
                  {suggestion.titleOptions.map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs uppercase text-neutral-500">{t("research.thumbs")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestion.thumbnailTextOptions.map((x) => (
                    <span key={x} className="rounded bg-neutral-800 px-2 py-0.5 font-bold uppercase">
                      {x}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          <ErrorText error={error} />
        </Card>
        <Card title={t("research.theme")}>
          <ThemeEditor project={project} suggested={suggestion?.themeOverride ?? null} />
        </Card>
      </div>
      <ImpactDialog slug={slug} request={impactFor && impactFor !== project.styleId ? { styleId: impactFor } : impactFor ? {} : null} onCancel={() => setImpactFor(null)} onProceed={() => useStyle(impactFor!)} />
    </div>
  );
}
