"use client";
// /p/[slug]/script/[lang]: chapter tabs, segment rows (displayText, spoken text toggle → ttsTextEdited, facts, device),
// lint issues returned by every save, out-of-sync + Transcreate (secondary languages), chapter lock, history/revert, and
// the fact-check panel (apply rewrite / acknowledge / dismiss, fix-only items, stale banner + re-check).
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Device, P, hashJson, type FactCheck, type FactCheckItem, type Lang, type RiskFlag, type Script, type ScriptSegment } from "@docmaker/core";
import { api, errorText, putDoc, submitJob } from "@/lib/api";
import { NOTE_MIN, applyRewrite, duplicateNotes, factcheckStale, fixOnly, gatingItems, itemSatisfied } from "@/lib/factcheck";
import { useI18n } from "./I18nProvider";
import { useDocEditor } from "./useDocEditor";
import { DocStatus } from "./DocStatus";
import { HistoryMenu } from "./HistoryMenu";
import { Badge, Banner, Button, Card, ErrorText, IssueList, Tabs, cx, inputCls } from "./ui";

type Decision = { kind: "ack" | "dismiss"; note: string };

export function ScriptEditor(p: {
  slug: string; lang: Lang; primaryLang: Lang; script: Script; etag: string | null; factcheck: FactCheck | null; factcheckEtag: string | null;
  primaryScript: Script | null; slicesDocHash: string | null; riskFlags: RiskFlag[]; readOnly: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const rel = P.script(p.lang);
  const ed = useDocEditor<Script>(p.slug, rel, p.script, p.etag);
  const [fc, setFc] = useState<FactCheck | null>(p.factcheck);
  const [fcEtag, setFcEtag] = useState<string | null>(p.factcheckEtag);
  const script = ed.value!;
  const [chapter, setChapter] = useState(script.chapters[0]?.chapterId ?? "");
  const [spokenOpen, setSpokenOpen] = useState<Record<string, boolean>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [confirmIdentical, setConfirmIdentical] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const ro = p.readOnly;
  const secondary = p.lang !== p.primaryLang;

  const primarySegs = useMemo(() => new Map((p.primaryScript?.chapters ?? []).flatMap((c) => c.segments.map((s) => [s.id, s] as const))), [p.primaryScript]);
  const outOfSync = (s: ScriptSegment) => {
    if (!secondary || !s.primaryHash) return false;
    const ps = primarySegs.get(s.id);
    return !!ps && hashJson(ps.displayText) !== s.primaryHash;
  };
  const ch = script.chapters.find((c) => c.chapterId === chapter) ?? script.chapters[0];
  const lintFor = (where: string) => [...ed.issues, ...script.lint].filter((i) => i.where === where);
  const fcFor = (where: string) => (fc?.items ?? []).filter((i) => i.where === where && i.resolution === "open");

  const editSeg = (segId: string, patch: Partial<ScriptSegment>) =>
    ed.update((s) => ({
      ...s,
      updatedAt: new Date().toISOString(),
      chapters: s.chapters.map((c) => (c.segments.some((x) => x.id === segId) ? { ...c, userEdited: true, segments: c.segments.map((x) => (x.id === segId ? { ...x, ...patch } : x)) } : c)),
    }));
  const editChapter = (chId: string, patch: Partial<Script["chapters"][number]>) =>
    ed.update((s) => ({ ...s, updatedAt: new Date().toISOString(), chapters: s.chapters.map((c) => (c.chapterId === chId ? { ...c, ...patch } : c)) }));

  const save = async () => {
    setInfo(null);
    if (await ed.save()) router.refresh();
  };

  // ---- fact-check actions
  const stale = fc ? factcheckStale(fc, ed.saved, p.slicesDocHash, undefined) : [];
  const gating = fc ? gatingItems(fc, p.riskFlags) : [];
  const open = (fc?.items ?? []).filter((i) => i.resolution === "open");
  const putFc = async (next: FactCheck) => {
    const r = await putDoc(p.slug, P.factcheck(p.lang), next, fcEtag);
    setFc(next);
    setFcEtag(r.etag);
  };
  const applyItemRewrite = async (it: FactCheckItem) => {
    setError(null);
    const seg = script.chapters.flatMap((c) => c.segments).find((s) => s.id === it.where);
    if (!seg || it.surface !== "narration") {
      setError(`${it.where}: ${t("script.fc.rewrite")} → ${it.suggestedRewrite}`);
      return;
    }
    const next = applyRewrite(seg.displayText, it.sentence, it.suggestedRewrite);
    if (next === null) {
      setError(`${it.id}: “${it.sentence}” not found in ${it.where}`);
      return;
    }
    const nextScript: Script = {
      ...script,
      updatedAt: new Date().toISOString(),
      chapters: script.chapters.map((c) => ({ ...c, userEdited: c.segments.some((s) => s.id === seg.id) ? true : c.userEdited, segments: c.segments.map((s) => (s.id === seg.id ? { ...s, displayText: next } : s)) })),
    };
    setBusy(it.id);
    try {
      if (await ed.save(nextScript)) {
        if (fc) await putFc({ ...fc, items: fc.items.map((x) => (x.id === it.id ? { ...x, resolution: "rewritten" as const } : x)) });
        router.refresh();
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const decided = Object.entries(decisions).filter(([, d]) => d.note.trim().length >= NOTE_MIN);
  const dups = duplicateNotes(Object.fromEntries(decided.map(([id, d]) => [id, d.note])));
  const recordDecisions = async () => {
    if (!fc) return;
    setBusy("record");
    setError(null);
    try {
      const ids = new Set(decided.map(([id]) => id));
      // persist each resolution + note first (dismissed stays dismissed; the approval marks the rest acknowledged)
      const nextFc: FactCheck = {
        ...fc,
        items: fc.items.map((x) => (ids.has(x.id) ? { ...x, resolution: decisions[x.id]!.kind === "dismiss" ? ("dismissed" as const) : ("acknowledged" as const), note: decisions[x.id]!.note.trim() } : x)),
      };
      await putFc(nextFc);
      const pendingGating = gatingItems(nextFc, p.riskFlags).filter((i) => i.resolution !== "rewritten");
      if (pendingGating.length && pendingGating.every((i) => itemSatisfied(i))) {
        const notes = Object.fromEntries(pendingGating.map((i) => [i.id, i.note.trim()]));
        const identical = duplicateNotes(notes).length > 0;
        const shared = identical && confirmIdentical && new Set(Object.values(notes).map((n) => n.toLowerCase())).size === 1;
        await api(`/api/projects/${p.slug}/approvals`, {
          method: "POST",
          json: { gate: "factcheck-ack", stage: "voice", lang: p.lang, note: shared ? Object.values(notes)[0] : "", items: pendingGating.map((i) => i.id), itemNotes: shared ? {} : notes },
        });
      }
      setDecisions({});
      router.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const recheck = async () => {
    setBusy("recheck");
    setError(null);
    try {
      const r = await submitJob(p.slug, { kind: "stage", stage: "factcheck", langs: [p.lang] });
      setInfo(`→ ${r.jobId}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const transcreate = async (chId: string, force: boolean) => {
    setBusy(`tc-${chId}`);
    setError(null);
    try {
      const r = await submitJob(p.slug, { kind: "stage", stage: "script", langs: [p.lang], options: { chapters: [chId], ...(force ? { forceOverwriteEdits: true } : {}) } });
      setInfo(`${t("script.transcreate")} ${chId} → ${r.jobId}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5 2xl:grid-cols-[1fr_30rem]">
      <div className="min-w-0 space-y-3">
        <DocStatus conflict={ed.conflict} readOnly={ro} error={ed.error} onReload={() => void ed.reload()} />
        <div className="flex flex-wrap items-center gap-2">
          <input className={cx(inputCls, "max-w-xl text-lg font-semibold")} value={script.title} disabled={ro} onChange={(e) => ed.update((s) => ({ ...s, title: e.target.value }))} />
          <div className="ml-auto flex items-center gap-2">
            <a href={`/api/projects/${p.slug}/media/voice/${p.lang}/teleprompter.html?download=1`} className="text-xs text-neutral-400 hover:text-white">
              {t("script.teleprompter")} ↓
            </a>
            <HistoryMenu slug={p.slug} rel={rel} onReverted={() => void ed.reload()} disabled={ro} />
            <Button variant="primary" size="sm" busy={ed.saving} disabled={!ed.dirty || ro} onClick={save} data-testid="save-script">
              {t("script.save")}
            </Button>
          </div>
        </div>
        <Tabs
          tabs={script.chapters.map((c) => ({
            key: c.chapterId,
            label: `${c.chapterId} ${c.title}`.slice(0, 32),
            badge: (
              <>
                {c.locked ? <Badge tone="violet">🔒</Badge> : null}
                {c.segments.some(outOfSync) ? <Badge tone="amber">≠</Badge> : null}
              </>
            ),
          }))}
          value={ch?.chapterId ?? ""}
          onChange={setChapter}
        />
        {ch ? (
          <Card
            title={
              <span className="flex items-center gap-2">
                <input className={cx(inputCls, "w-72")} value={ch.title} disabled={ro} onChange={(e) => editChapter(ch.chapterId, { title: e.target.value, userEdited: true })} />
                {ch.userEdited ? <Badge tone="blue">{t("script.userEdited")}</Badge> : null}
              </span>
            }
            actions={
              <>
                {secondary && ch.segments.some(outOfSync) ? (
                  <Button size="sm" busy={busy === `tc-${ch.chapterId}`} onClick={() => void transcreate(ch.chapterId, ch.userEdited || ch.locked)}>
                    {t("script.transcreate")}
                  </Button>
                ) : null}
                <label className="flex items-center gap-1.5 text-xs text-neutral-300">
                  <input type="checkbox" className="accent-amber-500" checked={ch.locked} disabled={ro} onChange={(e) => editChapter(ch.chapterId, { locked: e.target.checked })} />
                  {t("script.lock")}
                </label>
              </>
            }
          >
            <ol className="space-y-3">
              {ch.segments.map((s) => {
                const items = fcFor(s.id);
                return (
                  <li key={s.id} className={cx("rounded-md border p-3", items.some((i) => i.risk === "high") ? "border-red-800" : items.length ? "border-amber-800" : "border-neutral-800")} data-testid={`segment-${s.id}`}>
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono text-neutral-500">{s.id}</span>
                      <Badge tone={s.type === "clip" ? "blue" : s.type === "narration" ? "neutral" : "violet"}>{s.type}</Badge>
                      {s.type === "narration" ? (
                        <select className="rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5 text-xs" value={s.device} disabled={ro} onChange={(e) => editSeg(s.id, { device: e.target.value as ScriptSegment["device"] })} aria-label={t("script.segment.device")}>
                          {Device.options.map((d) => (
                            <option key={d}>{d}</option>
                          ))}
                        </select>
                      ) : null}
                      {s.factIds.map((f) => (
                        <span key={f} className="rounded bg-sky-950 px-1 font-mono text-sky-300">
                          {f}
                        </span>
                      ))}
                      {outOfSync(s) ? <Badge tone="amber">{t("script.outOfSync")}</Badge> : null}
                      {s.type === "narration" ? (
                        <button type="button" className="ml-auto text-neutral-400 hover:text-white" onClick={() => setSpokenOpen((o) => ({ ...o, [s.id]: !o[s.id] }))}>
                          {t("script.spoken")} {s.ttsTextEdited ? `(${t("script.spokenEdited")})` : ""} {spokenOpen[s.id] ? "▴" : "▾"}
                        </button>
                      ) : null}
                    </div>
                    {s.type === "narration" || s.type === "clip" ? (
                      <textarea
                        className={cx(inputCls, "min-h-16 leading-relaxed", s.type === "clip" && "italic")}
                        value={s.displayText}
                        disabled={ro || s.type === "clip"}
                        onChange={(e) => editSeg(s.id, { displayText: e.target.value })}
                      />
                    ) : (
                      <p className="text-xs text-neutral-500">{s.type === "music_breath" ? `♪ ${s.breathMs} ms` : "sponsor"}</p>
                    )}
                    {s.subtitleTranslation ? <p className="mt-1 text-xs text-neutral-400">↳ {s.subtitleTranslation}</p> : null}
                    {spokenOpen[s.id] ? (
                      <div className="mt-2 space-y-1">
                        <textarea className={cx(inputCls, "min-h-12 font-mono text-xs")} value={s.ttsText} disabled={ro} onChange={(e) => editSeg(s.id, { ttsText: e.target.value, ttsTextEdited: true })} />
                        {s.ttsTextEdited ? (
                          <Button size="sm" variant="ghost" disabled={ro} onClick={() => editSeg(s.id, { ttsTextEdited: false })}>
                            ↺ auto
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                    {lintFor(s.id).length ? <div className="mt-2"><IssueList issues={lintFor(s.id)} /></div> : null}
                    {items.map((i) => (
                      <p key={i.id} className={cx("mt-1 text-xs", i.risk === "high" ? "text-red-400" : "text-amber-300")}>
                        ⚑ {i.id} {i.verdict.replace(/_/g, " ")}: {i.problem}
                      </p>
                    ))}
                  </li>
                );
              })}
            </ol>
          </Card>
        ) : null}
        <IssueList issues={ed.issues.filter((i) => !script.chapters.some((c) => c.segments.some((s) => s.id === i.where)))} />
        {info ? <Banner tone="blue">{info}</Banner> : null}
        <ErrorText error={error} />
      </div>

      <div className="space-y-3" id="factcheck">
        <Card
          title={t("script.factcheck")}
          actions={fc ? <Badge tone={open.some((i) => i.risk === "high") ? "red" : open.length ? "amber" : "green"}>{t("script.fc.open", { n: open.length })}</Badge> : null}
        >
          {!fc ? <p className="text-sm text-neutral-500">{t("script.fc.none")}</p> : null}
          {fc && (stale.length || ed.dirty) ? (
            <Banner tone="amber" actions={<Button size="sm" busy={busy === "recheck"} disabled={ed.dirty} onClick={recheck}>{t("script.fc.recheck")}</Button>}>
              {t("script.fc.stale")} {stale.length ? `(${stale.join(", ")})` : ""}
            </Banner>
          ) : null}
          {fc ? (
            <ul className="mt-3 space-y-2.5">
              {[...fc.items]
                .sort((a, b) => riskRank(b.risk) - riskRank(a.risk) || a.where.localeCompare(b.where))
                .map((it) => {
                  const blocking = gating.some((g) => g.id === it.id);
                  const d = decisions[it.id];
                  return (
                    <li key={it.id} className={cx("rounded-md border p-2.5 text-sm", it.resolution !== "open" ? "border-neutral-800 opacity-70" : blocking ? "border-red-800" : "border-neutral-800")} data-testid={`fc-${it.id}`}>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs">
                        <span className="font-mono text-neutral-500">{it.id}</span>
                        <Badge tone={it.risk === "high" ? "red" : it.risk === "medium" ? "amber" : "neutral"}>{it.risk}</Badge>
                        <Badge>{it.verdict.replace(/_/g, " ")}</Badge>
                        <Badge tone="blue">{it.surface}</Badge>
                        <button type="button" className="font-mono text-sky-400 hover:underline" onClick={() => setChapter(it.where.split("-")[0] ?? chapter)}>
                          {it.where}
                        </button>
                        {it.resolution !== "open" ? <Badge tone="green">{it.resolution}</Badge> : null}
                      </div>
                      <p className="mt-1 text-neutral-200">“{it.sentence}”</p>
                      {it.problem ? <p className="mt-1 text-xs text-neutral-400">{it.problem}</p> : null}
                      {it.suggestedRewrite ? (
                        <p className="mt-1 text-xs text-emerald-300">
                          → {it.suggestedRewrite}
                        </p>
                      ) : null}
                      {it.note ? <p className="mt-1 text-xs italic text-neutral-500">{it.note}</p> : null}
                      {it.resolution === "open" ? (
                        <div className="mt-2 space-y-1.5">
                          <div className="flex flex-wrap gap-1.5">
                            {it.suggestedRewrite ? (
                              <Button size="sm" busy={busy === it.id} disabled={ro || ed.dirty} onClick={() => void applyItemRewrite(it)}>
                                {t("script.fc.applyRewrite")}
                              </Button>
                            ) : null}
                            {fixOnly(it) ? (
                              <span className="text-xs text-red-300">{t("script.fc.fixOnly")}</span>
                            ) : (
                              <>
                                <Button size="sm" variant={d?.kind === "ack" ? "primary" : "secondary"} onClick={() => setDecisions((x) => ({ ...x, [it.id]: { kind: "ack", note: x[it.id]?.note ?? "" } }))}>
                                  {t("script.fc.ack")}
                                </Button>
                                <Button size="sm" variant={d?.kind === "dismiss" ? "primary" : "secondary"} onClick={() => setDecisions((x) => ({ ...x, [it.id]: { kind: "dismiss", note: x[it.id]?.note ?? "" } }))}>
                                  {t("script.fc.dismiss")}
                                </Button>
                              </>
                            )}
                          </div>
                          {d && !fixOnly(it) ? (
                            <input className={inputCls} value={d.note} placeholder={t("script.fc.note")} onChange={(e) => setDecisions((x) => ({ ...x, [it.id]: { ...d, note: e.target.value } }))} />
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
            </ul>
          ) : null}
          {fc && Object.keys(decisions).length ? (
            <div className="mt-3 space-y-2 border-t border-neutral-800 pt-3">
              {dups.length ? (
                <label className="flex items-center gap-2 text-xs text-amber-300">
                  <input type="checkbox" className="accent-amber-500" checked={confirmIdentical} onChange={(e) => setConfirmIdentical(e.target.checked)} />
                  {t("script.fc.notesIdentical")} {t("script.fc.confirmIdentical")}
                </label>
              ) : null}
              <Button variant="primary" size="sm" busy={busy === "record"} disabled={!decided.length || (dups.length > 0 && !confirmIdentical) || stale.length > 0 || ed.dirty} onClick={recordDecisions} data-testid="record-acks">
                {t("script.fc.submitAck")} ({decided.length})
              </Button>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}

const riskRank = (r: FactCheckItem["risk"]) => ({ none: 0, low: 1, medium: 2, high: 3 })[r];
