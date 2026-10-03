// Isomorphic helpers about job requests.
import { StageId, type JobRecord } from "@docmaker/core";

const ORDER = StageId.options;

/** Stages a request may run (pipeline range, single stage, demo = research→qa). */
export function stagesOf(req: JobRecord["request"]): StageId[] {
  if (req.kind === "stage") return req.stage ? [req.stage] : [];
  const from = ORDER.indexOf(req.from ?? "research");
  const to = ORDER.indexOf(req.to ?? "qa");
  return ORDER.slice(Math.max(0, from), to < 0 ? ORDER.length : to + 1);
}

/** True when an active (queued/running) job may write the output of one of these stages. */
export function jobWrites(job: JobRecord | null | undefined, stages: readonly StageId[]): boolean {
  if (!job || (job.status !== "running" && job.status !== "queued")) return false;
  const s = stagesOf(job.request);
  return stages.some((x) => s.includes(x));
}
