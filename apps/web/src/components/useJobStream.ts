"use client";
// EventSource on /api/jobs/[id]/events with a reducer keyed by stage (progress bars), the log tail, gate requests and
// the end status. The browser resends Last-Event-ID on reconnect; after job-end the stream is closed client-side.
import { useEffect, useReducer, useRef } from "react";
import type { JobEvent, JobStatus } from "@docmaker/core";

export interface StageProgress { key: string; stage: string; lang: string | null; pct: number; message: string; state: "running" | "done" | "skipped" | "failed"; waitingRenderSlot: boolean }
export interface GateRequest { gate: string; stage: string; lang: string | null; planHash: string; reason: "unmet" | "stale"; summary: string; seq: number }
export interface JobStreamState {
  jobId: string | null;
  connected: boolean;
  lastSeq: number;
  stages: StageProgress[];
  log: { seq: number; at: string; level: "debug" | "info" | "warn" | "error"; text: string }[];
  gates: GateRequest[];
  costUsd: number;
  ended: JobStatus | null;
}

const LOG_CAP = 300;
export const initialJobState = (jobId: string | null): JobStreamState => ({ jobId, connected: false, lastSeq: -1, stages: [], log: [], gates: [], costUsd: 0, ended: null });

type Action = { type: "event"; ev: JobEvent } | { type: "connected"; v: boolean } | { type: "reset"; jobId: string | null };

const keyOf = (stage: string, lang: string | null) => (lang ? `${stage}.${lang}` : stage);

function upsertStage(s: StageProgress[], key: string, patch: Partial<StageProgress> & Pick<StageProgress, "stage" | "lang">): StageProgress[] {
  const i = s.findIndex((x) => x.key === key);
  if (i < 0) return [...s, { key, pct: 0, message: "", state: "running", waitingRenderSlot: false, ...patch }];
  const next = s.slice();
  next[i] = { ...next[i]!, ...patch };
  return next;
}

/** Pure reducer (unit-tested): duplicate or older seqs are ignored (replay after reconnect). */
export function jobReducer(st: JobStreamState, a: Action): JobStreamState {
  if (a.type === "reset") return initialJobState(a.jobId);
  if (a.type === "connected") return { ...st, connected: a.v };
  const ev = a.ev;
  if (ev.seq <= st.lastSeq) return st;
  const base = { ...st, lastSeq: ev.seq };
  const log = (level: JobStreamState["log"][number]["level"], text: string) => ({ ...base, log: [...base.log, { seq: ev.seq, at: ev.at, level, text }].slice(-LOG_CAP) });
  switch (ev.type) {
    case "job-start":
      return log("info", `job ${ev.jobId} started (${ev.request.kind}${ev.request.from ? ` ${ev.request.from}→${ev.request.to ?? "…"}` : ev.request.stage ? ` ${ev.request.stage}` : ""})`);
    case "stage-start": {
      const s = log("info", `▶ ${keyOf(ev.stage, ev.lang)}`);
      return { ...s, stages: upsertStage(s.stages, keyOf(ev.stage, ev.lang), { stage: ev.stage, lang: ev.lang, state: "running", pct: 0, message: "" }) };
    }
    case "progress":
      return {
        ...base,
        stages: upsertStage(base.stages, keyOf(ev.stage, ev.lang), {
          stage: ev.stage, lang: ev.lang, pct: ev.pct, message: ev.message, state: "running", waitingRenderSlot: ev.detail?.waiting === "render-slot",
        }),
      };
    case "stage-done": {
      const s = log("info", `✓ ${keyOf(ev.stage, ev.lang)} (${(ev.durationMs / 1000).toFixed(1)} s)`);
      return { ...s, stages: upsertStage(s.stages, keyOf(ev.stage, ev.lang), { stage: ev.stage, lang: ev.lang, pct: 1, state: "done", waitingRenderSlot: false }) };
    }
    case "stage-skip": {
      const s = log("debug", `↷ ${keyOf(ev.stage, ev.lang)} ${ev.reason}`);
      return { ...s, stages: upsertStage(s.stages, keyOf(ev.stage, ev.lang), { stage: ev.stage, lang: ev.lang, pct: 1, state: "skipped" }) };
    }
    case "log":
      return log(ev.level, ev.stage ? `[${ev.stage}] ${ev.message}` : ev.message);
    case "estimate":
      return log("info", `estimate ${keyOf(ev.estimate.stage, ev.estimate.lang)}: $${ev.estimate.totalUsd.toFixed(3)} (${ev.estimate.confidence})`);
    case "cost": {
      const s = log("info", `paid ${ev.receipt.provider}: $${ev.receipt.costUsd.toFixed(4)}`);
      return { ...s, costUsd: s.costUsd + ev.receipt.costUsd };
    }
    case "needs-approval": {
      const s = log("warn", `⏸ ${ev.gate} (${ev.reason}) — ${ev.summary}`);
      const gates = [...s.gates.filter((g) => !(g.gate === ev.gate && g.stage === ev.stage && g.lang === ev.lang)), { gate: ev.gate, stage: ev.stage, lang: ev.lang, planHash: ev.planHash, reason: ev.reason, summary: ev.summary, seq: ev.seq }];
      return { ...s, gates };
    }
    case "artifact":
      return log("debug", `+ ${ev.path}`);
    case "error": {
      const s = log("error", `${ev.code}: ${ev.message}${ev.hint ? ` — ${ev.hint}` : ""}`);
      return ev.stage ? { ...s, stages: upsertStage(s.stages, keyOf(ev.stage, null), { stage: ev.stage, lang: null, state: "failed" }) } : s;
    }
    case "job-end":
      return { ...log(ev.status === "succeeded" ? "info" : "warn", `■ ${ev.status}`), ended: ev.status, stages: ev.status === "failed" ? base.stages.map((x) => (x.state === "running" ? { ...x, state: "failed" as const } : x)) : base.stages };
    default:
      return base;
  }
}

const TYPES = ["job-start", "stage-start", "progress", "log", "estimate", "cost", "needs-approval", "artifact", "stage-skip", "stage-done", "error", "job-end"] as const;

export function useJobStream(jobId: string | null, onEnd?: (status: JobStatus) => void): JobStreamState {
  const [state, dispatch] = useReducer(jobReducer, jobId, initialJobState);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  useEffect(() => {
    dispatch({ type: "reset", jobId });
    if (!jobId || typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
    const handler = (m: MessageEvent<string>) => {
      let ev: JobEvent;
      try {
        ev = JSON.parse(m.data) as JobEvent;
      } catch {
        return;
      }
      dispatch({ type: "event", ev });
      if (ev.type === "job-end") {
        es.close();
        dispatch({ type: "connected", v: false });
        onEndRef.current?.(ev.status);
      }
    };
    for (const t of TYPES) es.addEventListener(t, handler as EventListener);
    es.onopen = () => dispatch({ type: "connected", v: true });
    es.onerror = () => dispatch({ type: "connected", v: false });
    return () => es.close();
  }, [jobId]);
  return state;
}
