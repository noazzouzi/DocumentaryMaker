"use client";
// /p/[slug]/voice/[lang]: active take, provider/voice/speed/lexicon (+ cloned-voice consent), cost estimate, generate
// the final take (gated) or a scratch take, takes list (activate → layout→mix), segment table, recording uploads.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  P, VoiceProviderId, hashJson, type ActiveTake, type CostEstimate, type JobStatus, type Lang, type LexiconEntry, type Project, type Script,
  type VoiceInfo, type VoiceSettings, type VoiceTrack,
} from "@docmaker/core";
import { fmtSeconds, fmtUsd } from "@/i18n";
import { api, errorText, putDoc, submitJob } from "@/lib/api";
import { useI18n } from "./I18nProvider";
import { JobProgress } from "./JobProgress";
import { TeleprompterRecorder } from "./TeleprompterRecorder";
import { uploadFile } from "./UploadForm";
import { Badge, Banner, Button, Card, ErrorText, Field, ProgressBar, cx, inputCls } from "./ui";

const DEFAULT_SETTINGS: VoiceSettings = {
  provider: "synthetic", voiceId: "synthetic-m1", modelId: null, speed: 1, stability: 0.45, similarityBoost: 0.8, style: 0.15,
  charsPerSec: null, lexicon: [], cloneConsent: null, pickupProvider: null,
};

export function VoicePanel(p: {
  project: Project; lang: Lang; active: ActiveTake | null; activeEtag: string | null; takes: VoiceTrack[]; script: Script | null; readOnly: boolean;
}) {
  const { t, lang: ui } = useI18n();
  const router = useRouter();
  const slug = p.project.slug;
  const [settings, setSettings] = useState<VoiceSettings>(p.project.voice[p.lang] ?? DEFAULT_SETTINGS);
  const [voices, setVoices] = useState<VoiceInfo[] | null>(null);
  const [voicesDegraded, setVoicesDegraded] = useState(false);
  const [estimate, setEstimate] = useState<CostEstimate | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [chainAfter, setChainAfter] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [upProgress, setUpProgress] = useState<number | null>(null);
  const [pickup, setPickup] = useState(settings.pickupProvider !== null);
  const activeTake = p.takes.find((x) => x.id === p.active?.takeId) ?? null;
  const ro = p.readOnly;

  useEffect(() => {
    let alive = true;
    fetch(`/api/voices?provider=${settings.provider}&lang=${p.lang}`, { cache: "no-store" })
      .then(async (r) => {
        if (!alive) return;
        setVoicesDegraded(r.headers.get("x-docmaker-degraded") !== null);
        setVoices(r.ok ? ((await r.json()) as VoiceInfo[]) : []);
      })
      .catch(() => alive && setVoices([]));
    return () => {
      alive = false;
    };
  }, [settings.provider, p.lang]);
  useEffect(() => {
    api<CostEstimate | null>(`/api/projects/${slug}/estimate?stage=voice&lang=${p.lang}`).then(setEstimate).catch(() => setEstimate(null));
  }, [slug, p.lang]);

  const scriptSegs = new Map((p.script?.chapters ?? []).flatMap((c) => c.segments.map((s) => [s.id, s] as const)));
  const changedSince = (take: VoiceTrack) => take.segments.filter((s) => {
    const cur = scriptSegs.get(s.segmentId);
    return cur && s.mode === "narration" && hashJson(cur.ttsText) !== s.ttsTextHash;
  }).length;
  const selectedVoice = voices?.find((v) => v.id === settings.voiceId) ?? null;
  const needsConsent = selectedVoice?.cloned === true && !(settings.cloneConsent && settings.cloneConsent.statement.trim().length >= 20);

  const saveSettings = async (next = settings) => {
    await api(`/api/projects/${slug}`, { method: "PATCH", json: { voice: { ...p.project.voice, [p.lang]: next } } });
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const generate = (kind: "final" | "scratch", extra: Record<string, unknown> = {}) =>
    run(kind, async () => {
      if (kind === "final") await saveSettings();
      const r = await submitJob(slug, { kind: "stage", stage: "voice", langs: [p.lang], options: { takeKind: kind, ...extra } });
      setJobId(r.jobId);
      setChainAfter(true);
    });
  // §5.3: after a voice job (or a take activation) the app runs layout → mix; render stays the user's call
  const chainLayoutToMix = async () => {
    const r = await submitJob(slug, { kind: "pipeline", from: "layout", to: "mix", langs: [p.lang] });
    setChainAfter(false);
    setJobId(r.jobId);
  };
  const onJobEnd = (s: JobStatus) => {
    if (s === "succeeded" && chainAfter) void chainLayoutToMix().catch((e) => setError(errorText(e)));
    else router.refresh();
  };
  const activate = (takeId: string) =>
    run(`act-${takeId}`, async () => {
      const doc: ActiveTake = { schemaVersion: 1, lang: p.lang, takeId: takeId as ActiveTake["takeId"], setAt: new Date().toISOString() };
      await putDoc(slug, P.activeTake(p.lang), doc, p.activeEtag);
      await chainLayoutToMix();
      router.refresh();
    });
  const uploadRecordings = (files: FileList | null, segmentId: string | null) =>
    run("upload", async () => {
      if (!files?.length) return;
      for (const [i, f] of [...files].entries()) {
        setUpProgress(i / files.length);
        await uploadFile(`/api/projects/${slug}/upload?kind=recording&lang=${p.lang}${segmentId ? `&segmentId=${segmentId}` : ""}`, f, {}, (x) => setUpProgress((i + x) / files.length));
      }
      setUpProgress(null);
      setInfo(`${files.length} ✓`);
    });
  const buildFromRecordings = () =>
    run("recording", async () => {
      const next: VoiceSettings = { ...settings, provider: "recording", pickupProvider: pickup ? settings.pickupProvider ?? "synthetic" : null };
      setSettings(next);
      await saveSettings(next);
      const r = await submitJob(slug, { kind: "stage", stage: "voice", langs: [p.lang], options: { takeKind: "final", pickupTts: pickup } });
      setJobId(r.jobId);
      setChainAfter(true);
    });

  const lex = settings.lexicon;
  const setLex = (l: LexiconEntry[]) => setSettings({ ...settings, lexicon: l });

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_26rem]">
      <div className="space-y-4">
        {ro ? <Banner tone="blue">{t("common.readOnlyJob")}</Banner> : null}
        <Card title={t("voice.active")}>
          {activeTake ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-mono">{activeTake.id}</span>
              <Badge tone={activeTake.kind === "final" ? "green" : "amber"}>{activeTake.kind}</Badge>
              <Badge>{activeTake.provider}</Badge>
              <span className="text-neutral-400">{activeTake.voiceId}</span>
              <Badge tone={activeTake.license.commercialOk ? "green" : "amber"} title={activeTake.license.attributionText ?? undefined}>
                {activeTake.license.code}
              </Badge>
              {changedSince(activeTake) ? <Badge tone="amber">{t("preview.changed", { n: changedSince(activeTake) })}</Badge> : null}
            </div>
          ) : (
            <p className="text-sm text-neutral-500">{t("voice.noTake")}</p>
          )}
        </Card>
        <Card title={t("voice.takes")}>
          <ul className="divide-y divide-neutral-800 text-sm">
            {p.takes.map((tk) => (
              <li key={tk.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="font-mono text-xs">{tk.id}</span>
                <Badge tone={tk.kind === "final" ? "green" : "amber"}>{tk.kind}</Badge>
                <span className="text-xs text-neutral-400">
                  {tk.provider} · {tk.voiceId} · {tk.segments.length} seg · {fmtUsd(ui, tk.costUsd)}
                </span>
                {tk.missingSegmentIds.length ? <Badge tone="red">−{tk.missingSegmentIds.length}</Badge> : null}
                {tk.id === p.active?.takeId ? (
                  <Badge tone="green">✓</Badge>
                ) : (
                  <Button size="sm" className="ml-auto" busy={busy === `act-${tk.id}`} disabled={ro} onClick={() => void activate(tk.id)}>
                    {t("voice.activate")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
        {activeTake ? (
          <Card title={t("voice.segments")}>
            <table className="w-full text-xs">
              <thead className="text-left text-neutral-500">
                <tr>
                  <th className="py-1">id</th>
                  <th>{t("voice.duration")}</th>
                  <th>{t("voice.timing")}</th>
                  <th>{t("voice.wer")}</th>
                  <th />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {activeTake.segments.map((s) => {
                  const cur = scriptSegs.get(s.segmentId);
                  const edited = cur && s.mode === "narration" && hashJson(cur.ttsText) !== s.ttsTextHash;
                  const src = s.words[0]?.source ?? activeTake.timing.source;
                  return (
                    <tr key={s.segmentId}>
                      <td className="py-1 font-mono">
                        {s.segmentId} {s.pickup ? <Badge tone="violet">pickup</Badge> : null}
                      </td>
                      <td>{fmtSeconds(s.durationMs / 1000)}</td>
                      <td>{src}</td>
                      <td className={cx(s.asrWer !== null && s.asrWer > 0.15 && "text-red-400")}>{s.asrWer === null ? "—" : `${Math.round(s.asrWer * 100)}%`}</td>
                      <td className="flex items-center gap-2 py-1">
                        <audio controls preload="none" src={`/api/projects/${slug}/media/${s.file}`} className="h-6 w-40" />
                        {edited ? <Badge tone="amber">{t("voice.editedAfter")}</Badge> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ) : null}
        {p.script ? <TeleprompterRecorder slug={slug} lang={p.lang} script={p.script} cps={settings.charsPerSec} /> : null}
      </div>

      <div className="space-y-4">
        <Card title={t("voice.provider")}>
          <div className="grid gap-3">
            <Field label={t("voice.provider")}>
              <select className={inputCls} value={settings.provider} disabled={ro} onChange={(e) => setSettings({ ...settings, provider: e.target.value as VoiceSettings["provider"], voiceId: "auto" })}>
                {VoiceProviderId.options.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </Field>
            <Field label={t("voice.voice")} hint={voicesDegraded ? t("voice.voicesUnavailable") : undefined}>
              {voices && voices.length ? (
                <select className={inputCls} value={settings.voiceId} disabled={ro} onChange={(e) => setSettings({ ...settings, voiceId: e.target.value })}>
                  <option value="auto">auto</option>
                  {voices.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.gender}{v.cloned ? ", cloned" : ""}) — {v.license.code}
                    </option>
                  ))}
                </select>
              ) : (
                <input className={inputCls} value={settings.voiceId} disabled={ro} onChange={(e) => setSettings({ ...settings, voiceId: e.target.value })} />
              )}
            </Field>
            {selectedVoice?.cloned ? (
              <Field label={t("voice.consent")}>
                <textarea
                  className={cx(inputCls, "min-h-16")}
                  value={settings.cloneConsent?.statement ?? ""}
                  onChange={(e) => setSettings({ ...settings, cloneConsent: { declaredAt: new Date().toISOString(), statement: e.target.value } })}
                />
              </Field>
            ) : null}
            <Field label={`${t("voice.speed")} ×${settings.speed.toFixed(2)}`}>
              <input type="range" min={0.7} max={1.2} step={0.01} value={settings.speed} disabled={ro} onChange={(e) => setSettings({ ...settings, speed: Number(e.target.value) })} className="accent-amber-500" />
            </Field>
            <Field label={t("voice.lexicon")}>
              <ul className="space-y-1">
                {lex.map((l, i) => (
                  <li key={i} className="flex gap-1">
                    <input className={inputCls} value={l.match} placeholder={t("voice.lexicon.match")} onChange={(e) => setLex(lex.map((x, j) => (j === i ? { ...x, match: e.target.value } : x)))} />
                    <input className={inputCls} value={l.say} placeholder={t("voice.lexicon.say")} onChange={(e) => setLex(lex.map((x, j) => (j === i ? { ...x, say: e.target.value } : x)))} />
                    <Button size="sm" variant="ghost" onClick={() => setLex(lex.filter((_, j) => j !== i))}>
                      ✕
                    </Button>
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="ghost" onClick={() => setLex([...lex, { match: "", say: "", caseSensitive: false }])}>
                +
              </Button>
            </Field>
            <Button size="sm" busy={busy === "settings"} disabled={ro || lex.some((l) => !l.match.trim() || !l.say.trim())} onClick={() => void run("settings", async () => { await saveSettings(); setInfo(t("common.saved")); router.refresh(); })}>
              {t("voice.saveSettings")}
            </Button>
          </div>
        </Card>
        <Card title={t("voice.estimate")}>
          <p className="text-2xl font-bold">{estimate ? fmtUsd(ui, estimate.totalUsd) : "—"}</p>
          {estimate ? <p className="text-xs text-neutral-500">{estimate.lines.map((l) => `${l.label}: ${l.quantity} ${l.unit}`).join(" · ")}</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="primary" busy={busy === "final"} disabled={ro || needsConsent} onClick={() => void generate("final")} data-testid="generate-final">
              {t("voice.generate")}
            </Button>
            <Button busy={busy === "scratch"} disabled={ro} onClick={() => void generate("scratch")}>
              {t("voice.scratch")}
            </Button>
          </div>
        </Card>
        <Card title={t("voice.uploadRecordings")}>
          <div className="grid gap-2 text-sm">
            <Field label={t("voice.uploadGlobal")}>
              <input type="file" multiple accept="audio/*,video/webm" disabled={ro} onChange={(e) => void uploadRecordings(e.target.files, null)} />
            </Field>
            {upProgress !== null ? <ProgressBar pct={upProgress} /> : null}
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" className="accent-amber-500" checked={pickup} onChange={(e) => setPickup(e.target.checked)} />
              {t("voice.pickup")}
            </label>
            <Button size="sm" busy={busy === "recording"} disabled={ro} onClick={() => void buildFromRecordings()}>
              {t("voice.generate")} (recording)
            </Button>
            <p className="text-xs text-neutral-500">
              {t("voice.calibrate")}: <code className="text-amber-300">pnpm docmaker voice calibrate {slug} --lang {p.lang}</code>
            </p>
          </div>
        </Card>
        <JobProgress jobId={jobId} onEnd={onJobEnd} />
        {info ? <Banner tone="green">{info}</Banner> : null}
        <ErrorText error={error} />
      </div>
    </div>
  );
}
