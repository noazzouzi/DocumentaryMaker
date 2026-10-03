"use client";
// Compact live view of one job (progress bars per stage, last log lines, end status) for sub-pages.
import type { JobStatus } from "@docmaker/core";
import { useT } from "./I18nProvider";
import { useJobStream } from "./useJobStream";
import { Badge, ProgressBar } from "./ui";

export function JobProgress({ jobId, onEnd }: { jobId: string | null; onEnd?: (s: JobStatus) => void }) {
  const t = useT();
  const s = useJobStream(jobId, onEnd);
  if (!jobId) return null;
  const last = s.log.slice(-4);
  return (
    <div className="space-y-1.5 rounded-md border border-neutral-800 p-2.5 text-xs" data-testid="job-progress">
      <div className="flex items-center gap-2">
        <span className="font-mono text-neutral-500">{jobId}</span>
        {s.ended ? <Badge tone={s.ended === "succeeded" ? "green" : s.ended === "failed" ? "red" : "violet"}>{s.ended}</Badge> : s.connected ? <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> : null}
      </div>
      {s.stages
        .filter((x) => x.state === "running")
        .map((x) => (
          <div key={x.key}>
            <div className="flex justify-between text-neutral-400">
              <span>{x.key}</span>
              <span>{x.waitingRenderSlot ? t("overview.waitingRender") : `${Math.round(x.pct * 100)}% ${x.message}`}</span>
            </div>
            <ProgressBar pct={x.pct} />
          </div>
        ))}
      <ol className="font-mono text-[11px] text-neutral-400">
        {last.map((l) => (
          <li key={l.seq} className={l.level === "error" ? "text-red-400" : l.level === "warn" ? "text-amber-300" : ""}>
            {l.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
