"use client";
// /p/[slug]/preview/[lang]: Player synced with the script (click a word → seek; active word by binary search; the panel
// auto-scrolls without re-rendering the Player), chapter selector + strip (markers, SFX ticks), scratch / changed banners,
// overlay and clip overrides (fingerprinted) → overrides.json → direct; rejected overrides listed.
import type { PlayerRef } from "@remotion/player";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ClipLayout, P, type Lang, type OverridesDoc, type ProgramLayout, type Timeline, type TimelineOverride, type Transition, type VisualClip } from "@docmaker/core";
import { fmtSeconds } from "@/i18n";
import { errorText, putDoc, submitJob } from "@/lib/api";
import { createFrameStore, lastWordStartedAt, wordIndexAt, type FrameStore } from "@/lib/frames";
import { useI18n } from "./I18nProvider";
import { JobProgress } from "./JobProgress";
import { PreviewPlayer } from "./PreviewPlayer";
import { Badge, Banner, Button, Card, ErrorText, cx, inputCls } from "./ui";

type OverrideEntry = OverridesDoc["overrides"][number];
const TRANSITIONS: Record<string, Transition> = {
  cut: { kind: "cut", accent: { type: "none" } },
  flash: { kind: "cover", presentation: "flash", durationFrames: 8, direction: "right", color: "#ffffff", peak: 0.8 },
  dipToBlack: { kind: "cover", presentation: "dipToBlack", durationFrames: 12, direction: "right", color: "#000000", peak: 1 },
  glitch: { kind: "cover", presentation: "glitch", durationFrames: 8, direction: "right", color: "#ffffff", peak: 0.8 },
  dissolve: { kind: "overlap", presentation: "dissolve", durationFrames: 12, direction: "right" },
};
const transitionKey = (tr: Transition): string => (tr.kind === "cut" ? "cut" : tr.kind === "overlap" ? "dissolve" : tr.presentation in TRANSITIONS ? tr.presentation : "flash");

function ScriptPanel({ layout, store, onSeek }: { layout: ProgramLayout; store: FrameStore; onSeek: (f: number) => void }) {
  const frame = useSyncExternalStore(store.subscribe, store.get, () => 0);
  const active = wordIndexAt(layout.words, frame);
  const anchor = active >= 0 ? active : lastWordStartedAt(layout.words, frame);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (anchor < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-w="${anchor}"]`);
    const box = listRef.current;
    if (!el || !box) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 24 || top > box.scrollTop + box.clientHeight - 48) box.scrollTo({ top: Math.max(0, top - box.clientHeight / 3), behavior: "smooth" });
  }, [anchor]);
  const bySeg = useMemo(() => {
    const out: { segmentId: string; words: { i: number; text: string; from: number }[] }[] = [];
    layout.words.forEach((w, i) => {
      const last = out[out.length - 1];
      if (last && last.segmentId === w.segmentId) last.words.push({ i, text: w.text, from: w.from });
      else out.push({ segmentId: w.segmentId, words: [{ i, text: w.text, from: w.from }] });
    });
    return out;
  }, [layout.words]);
  return (
    <div ref={listRef} className="relative max-h-[60vh] space-y-2 overflow-y-auto pr-2 text-sm leading-relaxed" data-testid="script-panel">
      {bySeg.map((s) => (
        <p key={s.segmentId}>
          <span className="mr-1 font-mono text-[10px] text-neutral-600">{s.segmentId}</span>
          {s.words.map((w) => (
            <button
              key={w.i}
              type="button"
              data-w={w.i}
              onClick={() => onSeek(w.from)}
              className={cx("rounded px-0.5 hover:bg-neutral-700", w.i === active ? "bg-amber-500 text-neutral-950" : w.i < anchor ? "text-neutral-300" : "text-neutral-500")}
            >
              {w.text}
            </button>
          ))}
        </p>
      ))}
    </div>
  );
}

function ChapterStrip({ timeline, store, onSeek }: { timeline: Timeline; store: FrameStore; onSeek: (f: number) => void }) {
  const frame = useSyncExternalStore(store.subscribe, store.get, () => 0);
  const total = timeline.durationInFrames;
  const pct = (f: number) => `${(f / total) * 100}%`;
  return (
    <div
      className="relative h-9 w-full cursor-pointer select-none overflow-hidden rounded bg-neutral-900"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onSeek(Math.round(((e.clientX - r.left) / r.width) * (total - 1)));
      }}
      data-testid="chapter-strip"
    >
      {timeline.chapters.map((c, i) => (
        <div key={c.id} className={cx("absolute top-0 h-6 truncate border-r border-neutral-950 px-1 text-[10px] leading-6", i % 2 ? "bg-neutral-800" : "bg-neutral-700/70")} style={{ left: pct(c.from), width: pct(c.dur) }} title={c.title}>
          {c.id} {c.title}
        </div>
      ))}
      {timeline.markers.map((m) => (
        <div key={m.id} className="absolute top-0 h-6 w-px bg-sky-400" style={{ left: pct(m.frame) }} title={`${m.kind}: ${m.name}`} />
      ))}
      {timeline.audio.sfx.map((s) => (
        <div key={s.id} className="absolute bottom-0 h-2 w-px bg-amber-400" style={{ left: pct(s.eventFrame) }} title={s.sfxId} />
      ))}
      <div className="pointer-events-none absolute top-0 h-full w-0.5 bg-white" style={{ left: pct(frame) }} />
    </div>
  );
}

export function PreviewView(p: {
  slug: string; lang: Lang; timeline: Timeline; layout: ProgramLayout | null; licenseAcknowledged: boolean; overrides: OverridesDoc | null; overridesEtag: string | null;
  rejected: { id: string; reason: string }[]; changedSegments: number; planKeys: Record<string, string>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const tl = p.timeline;
  const playerRef = useRef<PlayerRef | null>(null);
  const store = useMemo(() => createFrameStore(0), []);
  const onFrame = useCallback((f: number) => store.set(f), [store]);
  const [chapter, setChapter] = useState<string>("");
  const [pending, setPending] = useState<OverrideEntry[]>([]);
  const [etag, setEtag] = useState(p.overridesEtag);
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ch = tl.chapters.find((c) => c.id === chapter) ?? null;
  const range = useMemo<[number, number] | null>(() => (ch ? [ch.from, ch.from + ch.dur - 1] : null), [ch]);
  const seek = useCallback(
    (f: number) => {
      playerRef.current?.seekTo(f);
      store.set(f);
    },
    [store],
  );
  const existing = p.overrides?.overrides ?? [];
  const removed = new Set([...existing, ...pending].flatMap((o) => (o.override.op === "removeItem" ? [o.override.itemId] : [])));
  const clipOverride = (clipId: string, op: "setTransition" | "setLayout") => [...existing, ...pending].filter((o) => o.override.op === op && "clipId" in o.override && o.override.clipId === clipId).at(-1)?.override;

  const add = (target: OverrideEntry["target"], override: TimelineOverride) =>
    setPending((cur) => [
      ...cur.filter((o) => !(o.target.itemId === target.itemId && o.override.op === override.op)),
      { id: `ui-${Date.now().toString(36)}-${cur.length}`, createdAt: new Date().toISOString(), target, override },
    ]);
  const clipTarget = (c: VisualClip): OverrideEntry["target"] => ({
    itemId: c.id, component: null, beatId: c.beatId, planKey: c.beatId ? p.planKeys[c.beatId] ?? null : null,
    assetId: c.source.kind === "image" || c.source.kind === "video" ? c.source.assetId : null, wordNorm: null,
  });
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const doc: OverridesDoc = { schemaVersion: 1, lang: p.lang, overrides: [...existing, ...pending] };
      const r = await putDoc(p.slug, P.overrides(p.lang), doc, etag);
      setEtag(r.etag);
      setPending([]);
      const j = await submitJob(p.slug, { kind: "stage", stage: "direct", langs: [p.lang] });
      setJobId(j.jobId);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_24rem]">
      <div className="min-w-0 space-y-3">
        {tl.takeKind === "scratch" ? <Banner tone="amber">{t("preview.scratch")}</Banner> : null}
        {p.changedSegments > 0 ? <Banner tone="amber">{t("preview.changed", { n: p.changedSegments })}</Banner> : null}
        <div className="flex flex-wrap items-center gap-2">
          <select className={cx(inputCls, "w-72")} value={chapter} onChange={(e) => setChapter(e.target.value)} aria-label={t("preview.chapter")}>
            <option value="">{t("preview.whole")} ({fmtSeconds(tl.durationInFrames / tl.fps)})</option>
            {tl.chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} — {c.title} ({fmtSeconds(c.dur / tl.fps)})
              </option>
            ))}
          </select>
          <span className="font-mono text-xs text-neutral-500">
            {tl.takeId} · {tl.directorVersion}
          </span>
        </div>
        <PreviewPlayer slug={p.slug} timeline={tl} range={range} licenseAcknowledged={p.licenseAcknowledged} onFrame={onFrame} playerRef={playerRef} />
        <ChapterStrip timeline={tl} store={store} onSeek={seek} />
        <Card title={t("preview.overlays")} actions={<Button size="sm" variant="primary" busy={busy} disabled={!pending.length} onClick={save}>{t("preview.saveOverrides")} ({pending.length})</Button>}>
          <div className="grid gap-4 lg:grid-cols-2">
            <ul className="max-h-80 space-y-1 overflow-y-auto text-xs">
              {tl.overlays.map((o) => (
                <li key={o.id} className={cx("flex items-center gap-2", removed.has(o.id) && "opacity-40 line-through")}>
                  <button type="button" className="font-mono text-sky-400 hover:underline" onClick={() => seek(o.from)}>
                    {fmtSeconds(o.from / tl.fps)}
                  </button>
                  <Badge>{o.component}</Badge>
                  <span className="truncate text-neutral-500">{o.id}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={removed.has(o.id)}
                    onClick={() => add({ itemId: o.id, component: o.component, beatId: o.beatId, planKey: o.beatId ? p.planKeys[o.beatId] ?? null : null, assetId: null, wordNorm: null }, { op: "removeItem", itemId: o.id })}
                  >
                    {t("preview.remove")}
                  </Button>
                </li>
              ))}
            </ul>
            <ul className="max-h-80 space-y-1 overflow-y-auto text-xs">
              {tl.video.map((c) => {
                const tr = clipOverride(c.id, "setTransition");
                const ly = clipOverride(c.id, "setLayout");
                return (
                  <li key={c.id} className="flex items-center gap-1.5">
                    <button type="button" className="font-mono text-sky-400 hover:underline" onClick={() => seek(c.from)}>
                      {fmtSeconds(c.from / tl.fps)}
                    </button>
                    <span className="w-28 truncate text-neutral-500" title={c.id}>
                      {c.id}
                    </span>
                    <select
                      className="rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5"
                      aria-label={t("preview.transition")}
                      value={transitionKey(tr && tr.op === "setTransition" ? tr.transition : c.transitionIn)}
                      onChange={(e) => add(clipTarget(c), { op: "setTransition", clipId: c.id, transition: TRANSITIONS[e.target.value]! })}
                    >
                      {Object.keys(TRANSITIONS).map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                    <select
                      className="rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5"
                      aria-label={t("preview.layout")}
                      value={ly && ly.op === "setLayout" ? ly.layout : c.layout}
                      onChange={(e) => add(clipTarget(c), { op: "setLayout", clipId: c.id, layout: e.target.value as VisualClip["layout"] })}
                    >
                      {ClipLayout.options.map((k) => (
                        <option key={k}>{k}</option>
                      ))}
                    </select>
                  </li>
                );
              })}
            </ul>
          </div>
          {p.rejected.length ? (
            <div className="mt-3 border-t border-neutral-800 pt-2">
              <p className="text-xs uppercase text-red-300">{t("preview.rejected")}</p>
              <ul className="text-xs text-neutral-400">
                {p.rejected.map((r) => (
                  <li key={r.id}>
                    <span className="font-mono">{r.id}</span>: {r.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <JobProgress jobId={jobId} onEnd={() => router.refresh()} />
          <ErrorText error={error} />
        </Card>
      </div>
      <Card title={t("preview.script")} className="xl:sticky xl:top-20 xl:self-start">
        {p.layout ? <ScriptPanel layout={p.layout} store={store} onSeek={seek} /> : <p className="text-sm text-neutral-500">{t("common.missingDoc")}</p>}
      </Card>
    </div>
  );
}
