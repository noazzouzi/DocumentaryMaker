"use client";
// /p/[slug]/render: per language — preset, GL, render whole film or a chapter range (draft), live progress per chunk,
// cancel, output player + download, render/QA reports, "Export timeline only" (formats, overlays M3, exportRoot), files.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ExportFormat, GlMode, type Lang, type Project, type QaReport, type RenderDoc, type RenderPresetId } from "@docmaker/core";
import type { StageStatus } from "@docmaker/engine";
import { fmtSeconds } from "@/i18n";
import type { MessageKey } from "@/i18n";
import { api, errorText, submitJob } from "@/lib/api";
import { useI18n } from "./I18nProvider";
import { JobProgress } from "./JobProgress";
import { gateHref } from "./ProjectOverview";
import { Badge, Banner, Button, Card, ErrorText, Field, cx, inputCls } from "./ui";

export interface LangRenderData {
  lang: Lang;
  chapters: { id: string; title: string; from: number; dur: number }[];
  fps: number | null;
  renders: Partial<Record<RenderPresetId, { doc: RenderDoc | null; hasMp4: boolean; qa: QaReport | null }>>;
  exportFiles: { rel: string; bytes: number }[];
}

const fmtBytes = (n: number) => (n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} kB`);

function LangSection({ project, d, stages, glProbe, activeJobId }: { project: Project; d: LangRenderData; stages: StageStatus[]; glProbe: string | null; activeJobId: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const slug = project.slug;
  const [preset, setPreset] = useState<RenderPresetId>(project.render.defaultPreset);
  const [gl, setGl] = useState(project.render.gl);
  const [fromCh, setFromCh] = useState(d.chapters[0]?.id ?? "");
  const [toCh, setToCh] = useState(d.chapters[0]?.id ?? "");
  const [formats, setFormats] = useState(project.export.formats);
  const [overlays, setOverlays] = useState(project.export.overlays);
  const [exportRoot, setExportRoot] = useState(project.export.exportRoot ?? "");
  const [jobId, setJobId] = useState<string | null>(activeJobId);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blocked = stages.filter((s) => s.lang === d.lang && (s.stage === "render" || s.stage === "export") && s.blockedBy);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const ensureGl = async () => {
    if (gl !== project.render.gl) await api(`/api/projects/${slug}`, { method: "PATCH", json: { render: { ...project.render, gl } } });
  };
  const renderWhole = () =>
    run("whole", async () => {
      await ensureGl();
      const r = await submitJob(slug, { kind: "pipeline", from: "layout", to: "qa", langs: [d.lang], preset });
      setJobId(r.jobId);
    });
  const renderRange = () =>
    run("range", async () => {
      const a = d.chapters.find((c) => c.id === fromCh);
      const b = d.chapters.find((c) => c.id === toCh);
      if (!a || !b) return;
      const lo = Math.min(a.from, b.from);
      const hi = Math.max(a.from + a.dur, b.from + b.dur) - 1;
      await ensureGl();
      const r = await submitJob(slug, { kind: "stage", stage: "render", langs: [d.lang], preset: "draft", options: { frameRange: [lo, hi] } });
      setJobId(r.jobId);
    });
  const exportOnly = () =>
    run("export", async () => {
      await api(`/api/projects/${slug}`, { method: "PATCH", json: { export: { ...project.export, formats, overlays, exportRoot: exportRoot.trim() || null } } });
      await submitJob(slug, { kind: "pipeline", from: "layout", to: "mix", langs: [d.lang] });
      const r = await submitJob(slug, { kind: "stage", stage: "export", langs: [d.lang], options: { timelineOnly: true, overlays } });
      setJobId(r.jobId);
    });
  const cancel = () => run("cancel", async () => void (jobId && (await api(`/api/jobs/${jobId}/cancel`, { method: "POST" }))));
  const out = d.renders[preset];

  return (
    <Card title={<span className="uppercase">{d.lang}</span>}>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          {blocked.map((s) => {
            const href = gateHref(slug, s.blockedBy!, d.lang, project.primaryLang);
            return (
              <Banner key={`${s.stage}-${s.variant}`} tone="amber" actions={href ? <Link href={href} className="text-xs underline">{t("gate.go")}</Link> : null}>
                {s.stage}
                {s.variant ? `·${s.variant}` : ""}: {t("render.blocked", { reason: `${t(`gate.${s.blockedBy}` as MessageKey)} (${t(`overview.reason.${s.blockedReason ?? "unmet"}` as MessageKey)})` })}
              </Banner>
            );
          })}
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("render.preset")}>
              <select className={inputCls} value={preset} onChange={(e) => setPreset(e.target.value as RenderPresetId)}>
                <option value="draft">draft</option>
                <option value="master">master</option>
              </select>
            </Field>
            <Field label={t("render.gl")} hint={glProbe ? `probe: ${glProbe}` : undefined}>
              <select className={inputCls} value={gl} onChange={(e) => setGl(e.target.value as Project["render"]["gl"])}>
                {GlMode.options.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" busy={busy === "whole"} onClick={renderWhole} data-testid={`render-whole-${d.lang}`}>
              {t("render.whole")}
            </Button>
          </div>
          {d.chapters.length ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t("render.from")}>
                <select className={inputCls} value={fromCh} onChange={(e) => setFromCh(e.target.value)}>
                  {d.chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} {c.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("render.to")}>
                <select className={inputCls} value={toCh} onChange={(e) => setToCh(e.target.value)}>
                  {d.chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id} {c.title}
                    </option>
                  ))}
                </select>
              </Field>
              <Button busy={busy === "range"} onClick={renderRange} data-testid={`render-range-${d.lang}`}>
                {t("render.range")} (draft)
              </Button>
            </div>
          ) : null}
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <JobProgress jobId={jobId} onEnd={() => router.refresh()} />
            </div>
            {jobId ? (
              <Button size="sm" variant="danger" busy={busy === "cancel"} onClick={cancel}>
                {t("overview.cancel")}
              </Button>
            ) : null}
          </div>
          <div className="space-y-2 rounded-md border border-neutral-800 p-3">
            <p className="text-xs font-semibold uppercase text-neutral-400">{t("render.export")}</p>
            <Field label={t("render.formats")}>
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
                {ExportFormat.options.map((f) => (
                  <label key={f} className="flex items-center gap-1.5">
                    <input type="checkbox" className="accent-amber-500" checked={formats.includes(f)} onChange={(e) => setFormats((cur) => (e.target.checked ? [...cur, f] : cur.filter((x) => x !== f)))} />
                    {f}
                  </label>
                ))}
              </div>
            </Field>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" className="accent-amber-500" checked={overlays} onChange={(e) => setOverlays(e.target.checked)} />
              {t("render.overlays")}
            </label>
            <Field label={t("render.exportRoot")}>
              <input className={inputCls} value={exportRoot} onChange={(e) => setExportRoot(e.target.value)} placeholder="/Volumes/Edit/MyFilm" />
            </Field>
            <Button busy={busy === "export"} disabled={!formats.length} onClick={exportOnly} data-testid={`export-${d.lang}`}>
              {t("render.export")}
            </Button>
          </div>
          <ErrorText error={error} />
        </div>
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase text-neutral-400">{t("render.output")} · {preset}</p>
          {out?.hasMp4 ? (
            <>
              <video controls preload="metadata" className="aspect-video w-full rounded bg-black" src={`/api/projects/${slug}/media/render/${d.lang}/${preset}/final.mp4?v=${out.doc?.createdAt ?? ""}`} />
              <a className="text-sm text-amber-400 hover:underline" href={`/api/projects/${slug}/media/render/${d.lang}/${preset}/final.mp4?download=1`}>
                {t("common.download")} final.mp4
              </a>
            </>
          ) : (
            <p className="text-sm text-neutral-500">{t("render.none")}</p>
          )}
          {out?.doc ? (
            <p className="text-xs text-neutral-400">
              {out.doc.frames}/{out.doc.durationInFrames} frames{d.fps ? ` (${fmtSeconds(out.doc.frames / d.fps)})` : ""} · {out.doc.chunks.length} chunks ({out.doc.chunks.filter((c) => c.cached).length} cached) · {(out.doc.renderMs / 1000).toFixed(0)} s · {out.doc.gl}
              {out.doc.loudness ? ` · ${out.doc.loudness.integratedLufs.toFixed(1)} LUFS / ${out.doc.loudness.truePeakDbtp.toFixed(1)} dBTP` : ""}
            </p>
          ) : null}
          {out?.qa ? (
            <div>
              <p className="text-xs font-semibold uppercase text-neutral-400">{t("render.qa")}</p>
              <ul className="mt-1 space-y-0.5 text-xs">
                {out.qa.checks.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <Badge tone={c.ok ? "green" : c.level === "error" ? "red" : "amber"}>{c.ok ? "ok" : c.level}</Badge>
                    <span className={cx(!c.ok && "text-neutral-200")}>{c.message}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] italic text-neutral-500">{out.qa.audioNotListenedNotice}</p>
            </div>
          ) : null}
          {d.exportFiles.length ? (
            <div>
              <p className="text-xs font-semibold uppercase text-neutral-400">{t("render.files")}</p>
              <ul className="mt-1 max-h-60 overflow-y-auto text-xs">
                {d.exportFiles.map((f) => (
                  <li key={f.rel} className="flex justify-between gap-2">
                    <a className="truncate text-sky-400 hover:underline" href={`/api/projects/${slug}/media/${f.rel}?download=1`}>
                      {f.rel.replace(`export/${d.lang}/`, "")}
                    </a>
                    <span className="shrink-0 text-neutral-500">{fmtBytes(f.bytes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function RenderPanel({ project, langs, stages, glProbe, activeJobId }: { project: Project; langs: LangRenderData[]; stages: StageStatus[]; glProbe: string | null; activeJobId: string | null }) {
  return (
    <div className="space-y-5">
      {langs.map((d) => (
        <LangSection key={d.lang} project={project} d={d} stages={stages} glProbe={glProbe} activeJobId={activeJobId} />
      ))}
    </div>
  );
}
