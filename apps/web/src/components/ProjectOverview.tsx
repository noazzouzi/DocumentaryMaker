"use client";
// /p/[slug] overview: stage table (done/stale/blocked/running/failed + blockedBy reason), gate banners with actions,
// run controls, Approve & continue, cost vs cap, live job log (SSE) that reattaches to status.activeJobId.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StageId, type JobRecord, type Lang, type Project } from "@docmaker/core";
import type { StageStatus } from "@docmaker/engine";
import { fmtDate, fmtUsd, type MessageKey } from "@/i18n";
import { api, errorText, submitJob } from "@/lib/api";
import { useI18n } from "./I18nProvider";
import { useJobStream, type GateRequest } from "./useJobStream";
import { FairUseDialog } from "./FairUseDialog";
import { Badge, Banner, Button, Card, ErrorText, ProgressBar, cx, inputCls } from "./ui";

export interface StatusPayload { stages: StageStatus[]; costUsd: number; activeJobId: string | null; queued: string[] }

const STAGE_ORDER = StageId.options;
type Tone = "green" | "amber" | "red" | "blue" | "neutral" | "violet";
export function stageView(s: StageStatus): { key: "done" | "stale" | "blocked" | "running" | "failed" | "idle"; tone: Tone } {
  if (s.status === "running") return { key: "running", tone: "blue" };
  if (s.status === "failed") return { key: "failed", tone: "red" };
  if (s.blockedBy) return { key: "blocked", tone: "violet" };
  if (s.status === "done" && s.stale) return { key: "stale", tone: "amber" };
  if (s.status === "done") return { key: "done", tone: "green" };
  if (s.status === "blocked") return { key: "blocked", tone: "violet" };
  return { key: "idle", tone: "neutral" };
}

/** Where the user resolves a gate. */
export function gateHref(slug: string, gate: string, lang: Lang | null, primary: Lang): string | null {
  const l = lang ?? primary;
  switch (gate) {
    case "outline-approval":
      return `/p/${slug}/outline`;
    case "factcheck-ack":
    case "recheck":
      return `/p/${slug}/script/${l}#factcheck`;
    case "person-ack":
      return `/p/${slug}/research#people`;
    case "style-confirm":
      return `/p/${slug}/research#style`;
    default:
      return null;
  }
}

export function ProjectOverview({ project, initialStatus, initialJobs }: { project: Project; initialStatus: StatusPayload; initialJobs: JobRecord[] }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const slug = project.slug;
  const [status, setStatus] = useState(initialStatus);
  const [jobs, setJobs] = useState(initialJobs);
  const [jobId, setJobId] = useState<string | null>(initialStatus.activeJobId ?? latestJob(initialJobs)?.id ?? null);
  const [runTo, setRunTo] = useState<StageId>("export");
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fairUse, setFairUse] = useState<GateRequest | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([api<StatusPayload>(`/api/projects/${slug}/status`), api<JobRecord[]>(`/api/projects/${slug}/jobs`)]);
      setStatus(s);
      setJobs(j);
      if (s.activeJobId) setJobId((cur) => (cur === s.activeJobId ? cur : s.activeJobId));
      return s;
    } catch {
      return null;
    }
  }, [slug]);

  const stream = useJobStream(jobId, () => {
    void refresh();
    router.refresh();
  });

  // light polling while no live stream is attached (jobs started from the CLI or another tab)
  useEffect(() => {
    if (stream.connected) return;
    const h = setInterval(() => void refresh(), 4000);
    return () => clearInterval(h);
  }, [stream.connected, refresh]);

  const job = jobs.find((j) => j.id === jobId) ?? null;
  const waiting = job?.status === "waiting-approval" || stream.ended === "waiting-approval";
  const gates = useMemo(() => mergeGates(stream.gates, status.stages), [stream.gates, status.stages]);

  const run = async (label: string, req: Record<string, unknown>) => {
    setBusy(label);
    setError(null);
    try {
      const r = await submitJob(slug, { force, ...req });
      setJobId(r.jobId);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const firstPending = status.stages.find((s) => stageView(s).key !== "done")?.stage ?? null;
  const resume = async () => {
    if (!jobId) return;
    setBusy("resume");
    setError(null);
    try {
      const r = await api<{ jobId: string }>(`/api/jobs/${jobId}/resume`, { method: "POST" });
      setJobId(r.jobId);
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const approveInline = async (g: GateRequest, extra?: () => Promise<void>) => {
    setBusy(`gate-${g.gate}`);
    setError(null);
    try {
      if (extra) await extra();
      if (g.planHash) {
        await api(`/api/projects/${slug}/approvals`, { method: "POST", json: { gate: g.gate, stage: g.stage, lang: g.lang, planHash: g.planHash, note: "", items: [], itemNotes: {} } });
      }
      if (waiting && jobId) await resume();
      else await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const cancel = async () => {
    if (!jobId) return;
    setBusy("cancel");
    try {
      await api(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      await refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  const max = project.budget.maxUsdTotal;
  const grouped = STAGE_ORDER.map((id) => ({ id, rows: status.stages.filter((s) => s.stage === id) })).filter((g) => g.rows.length);
  const running = job && (job.status === "running" || job.status === "queued") && !stream.ended;

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_28rem]">
      <div className="space-y-4">
        {gates.map((g) => {
          const href = gateHref(slug, g.gate, g.lang as Lang | null, project.primaryLang);
          return (
            <Banner
              key={`${g.gate}-${g.stage}-${g.lang}`}
              tone={g.gate === "cost" ? "blue" : "amber"}
              actions={
                <>
                  {g.gate === "cost" && g.planHash ? (
                    <Button size="sm" variant="primary" busy={busy === "gate-cost"} onClick={() => void approveInline(g)}>
                      {t("overview.approveContinue")}
                    </Button>
                  ) : null}
                  {g.gate === "fair-use" ? (
                    <Button size="sm" variant="primary" onClick={() => setFairUse(g)}>
                      {t("gate.go")}
                    </Button>
                  ) : null}
                  {g.gate === "style-confirm" && project.styleId ? (
                    <Button size="sm" variant="primary" busy={busy === "gate-style-confirm"} onClick={() => void approveInline(g, async () => void (await api(`/api/projects/${slug}`, { method: "PATCH", json: { styleConfirmed: true } })))}>
                      {t("research.useStyle")}: {project.styleId}
                    </Button>
                  ) : null}
                  {href ? (
                    <Link href={href} className="rounded-md bg-neutral-800 px-2.5 py-1 text-xs hover:bg-neutral-700">
                      {t("gate.go")} →
                    </Link>
                  ) : null}
                </>
              }
            >
              <p className="font-semibold">
                {t(`gate.${g.gate}` as MessageKey)} <span className="font-normal text-xs opacity-70">({g.stage}{g.lang ? `·${g.lang}` : ""} · {t(`overview.reason.${g.reason}` as MessageKey)})</span>
              </p>
              {g.summary ? <p className="text-xs opacity-80">{g.summary}</p> : null}
            </Banner>
          );
        })}
        {waiting ? (
          <Banner tone="blue" actions={<Button size="sm" variant="primary" busy={busy === "resume"} onClick={resume} data-testid="resume-job">{t("overview.resume")}</Button>}>
            {t("overview.jobEnded", { status: "waiting-approval" })}
          </Banner>
        ) : null}

        <Card
          title={t("overview.stages")}
          actions={
            <span className={cx("text-xs", status.costUsd > max ? "text-red-400" : "text-neutral-400")}>
              {t("overview.cost", { spent: fmtUsd(lang, status.costUsd), max: fmtUsd(lang, max) })}
            </span>
          }
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" busy={busy === "next"} disabled={!firstPending || !!running} onClick={() => firstPending && void run("next", { kind: "stage", stage: firstPending })}>
              {t("overview.runNext")}
              {firstPending ? <span className="font-mono text-xs opacity-70">({firstPending})</span> : null}
            </Button>
            <select className={cx(inputCls, "w-36")} value={runTo} onChange={(e) => setRunTo(e.target.value as StageId)} aria-label={t("overview.runTo")}>
              {STAGE_ORDER.map((s) => (
                <option key={s} value={s}>
                  → {s}
                </option>
              ))}
            </select>
            <Button size="sm" busy={busy === "to"} disabled={!!running} onClick={() => void run("to", { kind: "pipeline", from: firstPending ?? "research", to: runTo })}>
              {t("overview.run")}
            </Button>
            <label className="ml-2 flex items-center gap-1.5 text-xs text-neutral-400">
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} className="accent-amber-500" />
              {t("overview.force")}
            </label>
            {status.queued.length ? <Badge>{t("overview.queued", { n: status.queued.length })}</Badge> : null}
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-neutral-800/70">
              {grouped.map((g) =>
                g.rows.map((s, i) => {
                  const v = stageView(s);
                  const live = stream.stages.find((x) => x.stage === s.stage && (x.lang ?? null) === (s.lang ?? null));
                  return (
                    <tr key={`${s.stage}-${s.lang}-${s.variant}`} data-testid={`stage-${s.stage}${s.lang ? `-${s.lang}` : ""}${s.variant ? `-${s.variant}` : ""}`}>
                      <td className="w-28 py-1.5 font-medium">{i === 0 ? s.stage : ""}</td>
                      <td className="w-20 font-mono text-xs text-neutral-400">
                        {s.lang ?? ""}
                        {s.variant ? `·${s.variant}` : ""}
                      </td>
                      <td className="w-28">
                        <Badge tone={v.tone}>{t(`overview.status.${v.key}` as MessageKey)}</Badge>
                      </td>
                      <td className="text-xs text-neutral-400">
                        {s.blockedBy ? t("overview.blockedBy", { gate: s.blockedBy, reason: t(`overview.reason.${s.blockedReason ?? "unmet"}` as MessageKey) }) : null}
                        {s.error ? <span className="text-red-400">{s.error}</span> : null}
                        {live && live.state === "running" ? (
                          <span className="flex items-center gap-2">
                            <ProgressBar pct={live.pct} />
                            <span className="shrink-0">{live.waitingRenderSlot ? t("overview.waitingRender") : live.message}</span>
                          </span>
                        ) : null}
                      </td>
                      <td className="w-20 text-right text-xs text-neutral-500">{s.costUsd ? fmtUsd(lang, s.costUsd) : ""}</td>
                      <td className="w-16 text-right">
                        <Button size="sm" variant="ghost" disabled={!!running} onClick={() => void run(`row-${s.stage}`, { kind: "stage", stage: s.stage, langs: s.lang ? [s.lang] : [], preset: s.variant ?? null })}>
                          ▶
                        </Button>
                      </td>
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
          <ErrorText error={error} />
        </Card>

        <Card title={t("overview.jobs")}>
          {jobs.length === 0 ? (
            <p className="text-sm text-neutral-500">{t("overview.noJobs")}</p>
          ) : (
            <ul className="divide-y divide-neutral-800 text-sm">
              {jobs.slice(0, 12).map((j) => (
                <li key={j.id} className="flex items-center gap-2 py-1.5">
                  <button type="button" className={cx("font-mono text-xs hover:underline", j.id === jobId ? "text-amber-400" : "text-neutral-300")} onClick={() => setJobId(j.id)}>
                    {j.id}
                  </button>
                  <Badge tone={j.status === "succeeded" ? "green" : j.status === "failed" ? "red" : j.status === "waiting-approval" ? "violet" : j.status === "canceled" ? "neutral" : "blue"}>{j.status}</Badge>
                  <span className="text-xs text-neutral-500">
                    {j.request.kind} {j.request.stage ?? `${j.request.from ?? ""}→${j.request.to ?? ""}`}
                  </span>
                  <span className="ml-auto text-xs text-neutral-600">{fmtDate(lang, j.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card
        title={
          <span className="flex items-center gap-2">
            {t("overview.log")}
            {stream.connected ? <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" aria-label="live" /> : null}
          </span>
        }
        actions={running ? <Button size="sm" variant="danger" busy={busy === "cancel"} onClick={cancel}>{t("overview.cancel")}</Button> : null}
        className="xl:sticky xl:top-20 xl:self-start"
      >
        {jobId ? <p className="mb-2 font-mono text-xs text-neutral-500">{jobId}</p> : <p className="text-sm text-neutral-500">{t("overview.noJobs")}</p>}
        <div className="mb-3 space-y-1.5">
          {stream.stages
            .filter((s) => s.state === "running")
            .map((s) => (
              <div key={s.key} className="text-xs">
                <div className="flex justify-between text-neutral-400">
                  <span>{s.key}</span>
                  <span>{s.waitingRenderSlot ? t("overview.waitingRender") : `${Math.round(s.pct * 100)}%`}</span>
                </div>
                <ProgressBar pct={s.pct} />
                {s.message ? <p className="truncate text-neutral-500">{s.message}</p> : null}
              </div>
            ))}
        </div>
        <ol className="max-h-[32rem] space-y-0.5 overflow-y-auto font-mono text-[11px] leading-relaxed" data-testid="job-log">
          {stream.log.map((l) => (
            <li key={l.seq} className={l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-300" : l.level === "debug" ? "text-neutral-600" : "text-neutral-300"}>
              {l.text}
            </li>
          ))}
        </ol>
        {stream.ended ? <p className="mt-2 text-xs text-neutral-400">{t("overview.jobEnded", { status: stream.ended })}</p> : null}
      </Card>
      <FairUseDialog
        open={fairUse !== null}
        onClose={() => setFairUse(null)}
        onAccept={async () => {
          const g = fairUse;
          setFairUse(null);
          if (!g) return;
          await approveInline(g, async () => void (await api(`/api/projects/${slug}`, { method: "PATCH", json: { editorial: { ...project.editorial, fairUseAcknowledged: true } } })));
        }}
      />
    </div>
  );
}

function latestJob(jobs: JobRecord[]): JobRecord | null {
  return [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/** Gate requests from the live job + gates the status reports on blocked stages (deduplicated by gate/stage/lang). */
export function mergeGates(fromJob: GateRequest[], stages: StageStatus[]): GateRequest[] {
  const out = new Map<string, GateRequest>();
  for (const g of fromJob) out.set(`${g.gate}|${g.stage}|${g.lang}`, g);
  for (const s of stages) {
    if (!s.blockedBy) continue;
    const k = `${s.blockedBy}|${s.stage}|${s.lang}`;
    if (!out.has(k)) out.set(k, { gate: s.blockedBy, stage: s.stage, lang: s.lang, planHash: "", reason: s.blockedReason ?? "unmet", summary: "", seq: -1 });
  }
  return [...out.values()];
}
