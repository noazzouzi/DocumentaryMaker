"use client";
// /p/[slug]/publish/[lang]: title / thumbnail text / description from suggestions or free text → Project.publish[lang];
// accusatory-wording hint on every change; save re-runs the (cheap) fact-check of title/thumbnail/description; kit preview.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Lang, Project, PublishInfo } from "@docmaker/core";
import { accusatoryTerms } from "@/lib/accusatory";
import { api, errorText, submitJob } from "@/lib/api";
import { useI18n } from "./I18nProvider";
import { JobProgress } from "./JobProgress";
import { Badge, Banner, Button, Card, ErrorText, Field, cx, inputCls } from "./ui";

export function PublishEditor({ project, lang, titleOptions, thumbOptions, scriptTitle }: { project: Project; lang: Lang; titleOptions: string[]; thumbOptions: string[]; scriptTitle: string | null }) {
  const { t } = useI18n();
  const router = useRouter();
  const init: PublishInfo = project.publish[lang] ?? { title: scriptTitle ?? titleOptions[0] ?? "", thumbnailText: thumbOptions[0] ?? "", description: "" };
  const [info, setInfo] = useState<PublishInfo>(init);
  const [kit, setKit] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/projects/${project.slug}/media/export/${lang}/publish.${lang}.md`, { cache: "no-store" })
      .then(async (r) => setKit(r.ok ? await r.text() : null))
      .catch(() => setKit(null));
  }, [project.slug, lang, jobId]);
  const flagged = accusatoryTerms(`${info.title}\n${info.thumbnailText}\n${info.description}`);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/projects/${project.slug}`, { method: "PATCH", json: { publish: { ...project.publish, [lang]: info } } });
      const r = await submitJob(project.slug, { kind: "stage", stage: "factcheck", langs: [lang] });
      setJobId(r.jobId);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const chips = (opts: string[], pick: (s: string) => void) => (
    <div className="mt-1 flex flex-wrap gap-1">
      {opts.map((o) => (
        <button key={o} type="button" onClick={() => pick(o)} className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-700">
          {o}
        </button>
      ))}
    </div>
  );
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_28rem]">
      <Card title={t("project.tab.publish")} actions={<Button variant="primary" size="sm" busy={busy} onClick={save} data-testid="save-publish">{t("publish.save")}</Button>}>
        <div className="grid gap-4">
          <Field label={`${t("publish.title")} (${info.title.length}/100)`}>
            <input className={inputCls} maxLength={100} value={info.title} onChange={(e) => setInfo({ ...info, title: e.target.value })} />
            {chips([...(scriptTitle ? [scriptTitle] : []), ...titleOptions], (s) => setInfo({ ...info, title: s.slice(0, 100) }))}
          </Field>
          <Field label={`${t("publish.thumbnail")} (${info.thumbnailText.length}/40)`}>
            <input className={cx(inputCls, "font-bold uppercase")} maxLength={40} value={info.thumbnailText} onChange={(e) => setInfo({ ...info, thumbnailText: e.target.value })} />
            {chips(thumbOptions, (s) => setInfo({ ...info, thumbnailText: s.slice(0, 40) }))}
          </Field>
          <Field label={`${t("publish.description")} (${info.description.length}/5000)`}>
            <textarea className={cx(inputCls, "min-h-48")} maxLength={5000} value={info.description} onChange={(e) => setInfo({ ...info, description: e.target.value })} />
          </Field>
          {flagged.length ? (
            <Banner tone="red">
              {t("publish.accusatory")}{" "}
              {flagged.map((w) => (
                <Badge key={w} tone="red">
                  {w}
                </Badge>
              ))}
            </Banner>
          ) : null}
          <JobProgress jobId={jobId} onEnd={() => router.refresh()} />
          <ErrorText error={error} />
        </div>
      </Card>
      <Card title={t("publish.kit")}>
        {kit ? <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap text-xs text-neutral-300">{kit}</pre> : <p className="text-sm text-neutral-500">{t("common.missingDoc")}</p>}
      </Card>
    </div>
  );
}
