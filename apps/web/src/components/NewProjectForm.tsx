"use client";
// /new: idea → instant offline style ranking (debounced) → style confirmation → create → pipeline estimate → start.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { HomeConfig, Lang, PipelineEstimate, Project, StyleSuggestion } from "@docmaker/core";
import type { StyleSummary } from "@docmaker/styles";
import { fmtUsd } from "@/i18n";
import { api, errorText, submitJob } from "@/lib/api";
import { useI18n } from "./I18nProvider";
import { Badge, Banner, Button, Card, ErrorText, Field, cx, inputCls } from "./ui";

export function NewProjectForm({ home, styles }: { home: HomeConfig; styles: StyleSummary[] }) {
  const { t, lang } = useI18n();
  const router = useRouter();
  const [idea, setIdea] = useState("");
  const [langs, setLangs] = useState<Lang[]>(home.defaults.languages.length ? home.defaults.languages : ["en"]);
  const [primary, setPrimary] = useState<Lang>(home.defaults.languages[0] ?? "en");
  const [minutes, setMinutes] = useState(home.defaults.targetMinutes || 20);
  const [styleId, setStyleId] = useState<string | null>(home.defaults.styleId);
  const [llm, setLlm] = useState<"anthropic" | "fixture">("anthropic");
  const [fixtureId, setFixtureId] = useState("tulip-mania");
  const [suggestion, setSuggestion] = useState<StyleSuggestion | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ project: Project; toOutline: PipelineEstimate | null; whole: PipelineEstimate | null } | null>(null);
  const userPicked = useRef(false);
  const seq = useRef(0);

  const suggest = async (useLlm: boolean) => {
    const text = idea.trim();
    if (text.length < 3) return;
    const n = ++seq.current;
    setSuggesting(true);
    try {
      const s = await api<StyleSuggestion>("/api/styles/suggest", { method: "POST", json: { idea: text, useLlm } });
      if (n !== seq.current) return; // a newer request superseded this one
      setSuggestion(s);
      if (!userPicked.current) {
        setStyleId(s.recommendedStyleId);
        if (s.recommendedMinutes) setMinutes(Math.round(s.recommendedMinutes));
      }
    } catch (e) {
      if (n === seq.current) setError(errorText(e));
    } finally {
      if (n === seq.current) setSuggesting(false);
    }
  };

  useEffect(() => {
    if (idea.trim().length < 3) return;
    const h = setTimeout(() => void suggest(false), 400);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idea]);

  useEffect(() => {
    if (!langs.includes(primary) && langs[0]) setPrimary(langs[0]);
  }, [langs, primary]);

  const ranked = suggestion?.ranked ?? styles.map((s) => ({ styleId: s.id, score: 0, why: "" }));
  const styleName = (id: string) => styles.find((s) => s.id === id)?.names[lang] ?? id;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const project = await api<Project>("/api/projects", {
        method: "POST",
        json: { idea: idea.trim(), languages: langs, primaryLang: primary, targetMinutes: minutes, styleId, llm, fixtureId: llm === "fixture" ? fixtureId : null },
      });
      const q = (to: string) => `/api/projects/${project.slug}/estimate-pipeline?from=research&to=${to}&langs=${langs.join(",")}`;
      const [toOutline, whole] = await Promise.all([api<PipelineEstimate>(q("outline")).catch(() => null), api<PipelineEstimate>(q("export")).catch(() => null)]);
      setCreated({ project, toOutline, whole });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    if (!created) return;
    setBusy(true);
    setError(null);
    try {
      await submitJob(created.project.slug, { kind: "pipeline", from: "research", to: "outline", langs: [] });
      router.push(`/p/${created.project.slug}`);
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };

  if (created) {
    return (
      <Card title={created.project.title || created.project.slug}>
        <div className="space-y-3 text-sm">
          <p className="font-mono text-xs text-neutral-500">{created.project.slug}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-neutral-800 p-3">
              <p className="text-xs uppercase text-neutral-500">{t("new.estimate")}</p>
              <p className="text-2xl font-bold">{created.toOutline ? fmtUsd(lang, created.toOutline.totalUsd) : "—"}</p>
            </div>
            <div className="rounded-md border border-neutral-800 p-3">
              <p className="text-xs uppercase text-neutral-500">{t("new.estimateWhole")}</p>
              <p className="text-2xl font-bold text-neutral-300">{created.whole ? fmtUsd(lang, created.whole.totalUsd) : "—"}</p>
            </div>
          </div>
          {created.toOutline?.stages.length ? (
            <ul className="text-xs text-neutral-400">
              {created.toOutline.stages.map((s) => (
                <li key={s.id}>
                  {s.stage}
                  {s.lang ? `[${s.lang}]` : ""}: {fmtUsd(lang, s.totalUsd)} <span className="text-neutral-600">({s.confidence})</span>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Button variant="primary" busy={busy} onClick={start} data-testid="start-research">
              {t("new.create")}
            </Button>
            <Button variant="ghost" onClick={() => router.push(`/p/${created.project.slug}`)}>
              {t("home.open")}
            </Button>
          </div>
          <ErrorText error={error} />
        </div>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <Field label={t("new.idea")}>
          <textarea className={cx(inputCls, "min-h-28")} value={idea} onChange={(e) => setIdea(e.target.value)} placeholder={t("new.ideaPlaceholder")} maxLength={500} data-testid="idea" />
        </Field>
        <Card
          title={t("new.style")}
          actions={
            <Button size="sm" variant="ghost" onClick={() => void suggest(true)} disabled={idea.trim().length < 3 || suggesting} title={t("new.askClaudeHint")}>
              {t("new.askClaude")}
            </Button>
          }
        >
          {suggesting ? <p className="mb-2 text-xs text-neutral-500">{t("new.suggesting")}</p> : null}
          {suggestion ? (
            <div className="mb-3 flex flex-wrap gap-2 text-xs text-neutral-400">
              <span>{t("new.topic", { topic: suggestion.topicType.replace(/_/g, " ") })}</span>
              {suggestion.riskFlags.filter((f) => f !== "none").length ? <span className="text-amber-400">{t("new.risk", { flags: suggestion.riskFlags.filter((f) => f !== "none").join(", ") })}</span> : null}
              <span>{t("new.recommendedMinutes", { min: suggestion.recommendedMinutes })}</span>
              <Badge>{suggestion.source}</Badge>
            </div>
          ) : null}
          <div className="grid gap-2">
            {ranked.map((r, i) => (
              <label key={r.styleId} className={cx("flex cursor-pointer gap-3 rounded-md border p-3", styleId === r.styleId ? "border-amber-500 bg-amber-500/5" : "border-neutral-800 hover:border-neutral-600")}>
                <input
                  type="radio"
                  name="style"
                  className="mt-1 accent-amber-500"
                  checked={styleId === r.styleId}
                  onChange={() => {
                    userPicked.current = true;
                    setStyleId(r.styleId);
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{styleName(r.styleId)}</span>
                    {suggestion && i === 0 ? <Badge tone="amber">{t("new.suggested")}</Badge> : null}
                    {suggestion ? <span className="ml-auto font-mono text-xs text-neutral-500">{Math.round(r.score * 100)}%</span> : null}
                  </div>
                  <p className="text-xs text-neutral-400">{r.why || styles.find((s) => s.id === r.styleId)?.description[lang]}</p>
                </div>
              </label>
            ))}
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        <Card>
          <div className="grid gap-3">
            <Field label={t("new.languages")}>
              <div className="flex gap-3">
                {(["en", "fr"] as const).map((l) => (
                  <label key={l} className="flex items-center gap-1.5 uppercase">
                    <input type="checkbox" className="accent-amber-500" checked={langs.includes(l)} onChange={(e) => setLangs((cur) => (e.target.checked ? [...new Set([...cur, l])] : cur.length > 1 ? cur.filter((x) => x !== l) : cur))} />
                    {l}
                  </label>
                ))}
              </div>
            </Field>
            <Field label={t("new.primary")}>
              <select className={inputCls} value={primary} onChange={(e) => setPrimary(e.target.value as Lang)}>
                {langs.map((l) => (
                  <option key={l} value={l}>
                    {l.toUpperCase()}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("new.minutes")}>
              <input type="number" min={5} max={60} className={inputCls} value={minutes} onChange={(e) => setMinutes(Math.min(60, Math.max(5, Number(e.target.value) || 5)))} />
            </Field>
            <Field label={t("new.llm")}>
              <select className={inputCls} value={llm} onChange={(e) => setLlm(e.target.value as "anthropic" | "fixture")}>
                <option value="anthropic">{t("new.llm.anthropic")}</option>
                <option value="fixture">{t("new.llm.fixture")}</option>
              </select>
            </Field>
            {llm === "fixture" ? (
              <Field label={t("new.fixture")}>
                <input className={inputCls} value={fixtureId} onChange={(e) => setFixtureId(e.target.value)} />
              </Field>
            ) : null}
          </div>
        </Card>
        {!styleId ? <Banner tone="amber">{t("gate.style-confirm")}</Banner> : null}
        <Button variant="primary" className="w-full justify-center" busy={busy} disabled={idea.trim().length < 3 || !styleId} onClick={create} data-testid="create-project">
          {busy ? t("new.creating") : t("new.create")}
        </Button>
        <ErrorText error={error} />
      </div>
    </div>
  );
}
