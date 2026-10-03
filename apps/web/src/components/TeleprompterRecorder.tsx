"use client";
// In-browser teleprompter recorder (M3): one MediaRecorder take per segment, large text auto-scrolling at the
// calibrated chars/sec, mirror toggle, retake, upload to voice/<lang>/recordings/<segmentId>.webm.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Lang, Script } from "@docmaker/core";
import { useT } from "./I18nProvider";
import { uploadFile } from "./UploadForm";
import { Badge, Button, Card, ErrorText, cx } from "./ui";

const DEFAULT_CPS = 15;

function pickMime(): string {
  const MR = typeof MediaRecorder !== "undefined" ? MediaRecorder : null;
  if (!MR) return "";
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"]) if (MR.isTypeSupported?.(m)) return m;
  return "";
}

export function TeleprompterRecorder({ slug, lang, script, cps }: { slug: string; lang: Lang; script: Script; cps: number | null }) {
  const t = useT();
  const segs = script.chapters.flatMap((c) => c.segments).filter((s) => s.type === "narration" && s.displayText.trim());
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [mirror, setMirror] = useState(false);
  const [state, setState] = useState<"idle" | "recording" | "recorded" | "uploading">("idle");
  const [blob, setBlob] = useState<Blob | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const seg = segs[idx];
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);

  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((tr) => tr.stop());
    },
    [],
  );

  const scrollAlong = (chars: number) => {
    const el = textRef.current;
    if (!el) return;
    const t0 = performance.now();
    const secs = chars / (cps ?? DEFAULT_CPS);
    el.scrollTop = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1000 / secs);
      el.scrollTop = k * (el.scrollHeight - el.clientHeight);
      if (k < 1 && recRef.current?.state === "recording") rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const start = async () => {
    setError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(t("voice.rec.unsupported"));
      return;
    }
    try {
      streamRef.current ??= await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch {
      setError(t("voice.rec.denied"));
      return;
    }
    const mime = pickMime();
    const rec = new MediaRecorder(streamRef.current, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      setBlob(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
      setState("recorded");
    };
    recRef.current = rec;
    rec.start(250);
    setBlob(null);
    setState("recording");
    if (seg) scrollAlong(seg.displayText.length);
  };
  const stop = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    recRef.current?.stop();
  };
  const upload = async () => {
    if (!blob || !seg) return;
    setState("uploading");
    setError(null);
    try {
      const ext = blob.type.includes("ogg") ? "ogg" : blob.type.includes("mp4") ? "m4a" : "webm";
      await uploadFile(`/api/projects/${slug}/upload?kind=recording&lang=${lang}&segmentId=${seg.id}`, new File([blob], `${seg.id}.${ext}`, { type: blob.type }), {}, () => {});
      setDone((d) => new Set(d).add(seg.id));
      setBlob(null);
      setState("idle");
      setIdx((i) => Math.min(segs.length - 1, i + 1));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("recorded");
    }
  };

  return (
    <Card title={t("voice.recorder")} actions={<Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>{open ? "▴" : "▾"}</Button>}>
      {open && seg ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select className="rounded border border-neutral-700 bg-neutral-950 px-1 py-0.5" value={idx} onChange={(e) => { setIdx(Number(e.target.value)); setBlob(null); setState("idle"); }} disabled={state === "recording"}>
              {segs.map((s, i) => (
                <option key={s.id} value={i}>
                  {s.id} {done.has(s.id) ? "✓" : ""}
                </option>
              ))}
            </select>
            <Badge>{done.size}/{segs.length}</Badge>
            <label className="ml-auto flex items-center gap-1">
              <input type="checkbox" className="accent-amber-500" checked={mirror} onChange={(e) => setMirror(e.target.checked)} />
              {t("voice.rec.mirror")}
            </label>
          </div>
          <div ref={textRef} className="h-56 overflow-hidden rounded-md bg-black px-6 py-16 text-3xl font-semibold leading-snug text-white" style={{ transform: mirror ? "scaleX(-1)" : undefined }} data-testid="teleprompter-text">
            {seg.displayText}
            <div className="h-40" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {state === "recording" ? (
              <Button variant="danger" onClick={stop}>
                ■ {t("voice.rec.stop")}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void start()} disabled={state === "uploading"}>
                ● {state === "recorded" ? t("voice.rec.retake") : t("voice.rec.start")}
              </Button>
            )}
            {url ? <audio controls src={url} className="h-8" /> : null}
            <Button busy={state === "uploading"} disabled={state !== "recorded"} onClick={() => void upload()}>
              {t("voice.rec.upload")}
            </Button>
            <Button variant="ghost" disabled={state === "recording" || idx >= segs.length - 1} onClick={() => { setIdx((i) => i + 1); setBlob(null); setState("idle"); }}>
              {t("voice.rec.next")} →
            </Button>
            {state === "recording" ? <span className={cx("h-3 w-3 animate-pulse rounded-full bg-red-500")} aria-label="recording" /> : null}
          </div>
          <ErrorText error={error} />
        </div>
      ) : null}
    </Card>
  );
}
