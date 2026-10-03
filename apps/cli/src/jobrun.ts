// Submitting a job and following it: human or NDJSON output, `--yes` / `--max-cost` for cost and style-confirm gates
// only (never editorial gates), exit codes 0 ok · 1 error · 3 waiting for approval · 4 canceled. Ctrl-C cancels.
import { EDITORIAL_GATES, type GateId, type JobEvent, type JobRequest, type Lang } from "@docmaker/core";
import type { EngineExt } from "@docmaker/engine";
import { parseMaxCost, type CliContext } from "./context";

export const EXIT = { ok: 0, error: 1, usage: 2, gate: 3, canceled: 4 } as const;

type Need = Extract<JobEvent, { type: "needs-approval" }>;

const label = (stage: string, lang: string | null) => `${stage}${lang ? ` (${lang})` : ""}`;
const fmtMs = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);

export function formatEvent(e: JobEvent): string | null {
  switch (e.type) {
    case "job-start":
      return `job ${e.jobId} started (${e.request.kind}${e.request.stage ? ` ${e.request.stage}` : ""}${e.request.from || e.request.to ? ` ${e.request.from ?? "research"}→${e.request.to ?? "qa"}` : ""})`;
    case "stage-start":
      return `[..] ${label(e.stage, e.lang)}`;
    case "stage-skip":
      return `[--] ${label(e.stage, e.lang)} ${e.reason === "up-to-date" ? "up to date" : "not applicable"}`;
    case "stage-done":
      return `[ok] ${label(e.stage, e.lang)} ${fmtMs(e.durationMs)}`;
    case "log":
      return e.level === "warn" || e.level === "error" ? `[${e.level}] ${e.stage ? e.stage + ": " : ""}${e.message}` : e.level === "info" ? `     ${e.message}` : null;
    case "estimate":
      return `[$$] estimate ${label(e.estimate.stage, e.estimate.lang)}: $${e.estimate.totalUsd.toFixed(2)} (${e.estimate.confidence})`;
    case "cost":
      return `[$$] ${e.receipt.provider} ${e.receipt.endpoint}: $${e.receipt.costUsd.toFixed(4)}`;
    case "needs-approval":
      return `[gate] ${e.gate} (${e.reason}) before ${label(e.stage, e.lang)}: ${e.summary}`;
    case "artifact":
      return null;
    case "error":
      return `[error] ${e.code}${e.stage ? ` in ${e.stage}` : ""}: ${e.message}${e.hint ? `\n        hint: ${e.hint}` : ""}`;
    case "job-end":
      return `job ${e.jobId} ${e.status}`;
    case "progress":
      return null;
  }
}

/** How to satisfy a gate from the command line. */
export function gateHint(slug: string, g: Need, jobId: string): string {
  const lang = g.lang ? ` --lang ${g.lang}` : "";
  const how: Record<GateId, string> = {
    "style-confirm": `docmaker style ${slug} --confirm   (or --pick <id>; --yes also confirms)`,
    "outline-approval": `docmaker outline ${slug} --confirm-thesis --approve`,
    "factcheck-ack": `docmaker factcheck ${slug}${lang}   (review), then --ack <ids> on a terminal or --ack-file <json> with a note per item`,
    "person-ack": `docmaker persons ${slug} --ack <personId> --note "<why showing this person is justified>"`,
    recheck: `docmaker factcheck ${slug} --recheck   (or docmaker approve ${slug} recheck --items <claimIds> --note "<text>")`,
    cost: `re-run with --yes or --max-cost <usd>, or docmaker approve ${slug} cost --stage ${g.stage}${lang} --plan ${g.planHash}`,
    "fair-use": `docmaker approve ${slug} fair-use --note "<I have read the fair-use notice>"`,
  };
  return `  ${g.gate}: ${how[g.gate]}\n  then: docmaker run ${slug} --resume ${jobId}`;
}

export interface FollowResult { status: string; needs: Need[]; estimates: Map<string, number>; spentEstimate: number; lastError: Extract<JobEvent, { type: "error" }> | null }

export async function follow(ctx: CliContext, engine: EngineExt, jobId: string): Promise<FollowResult> {
  const json = ctx.globals().json === true;
  const needs: Need[] = [];
  const estimates = new Map<string, number>();
  let spentEstimate = 0;
  let lastError: FollowResult["lastError"] = null;
  let status = "failed";
  let lastProgress = 0;
  for await (const e of engine.events(jobId)) {
    if (json) ctx.io.out(JSON.stringify(e) + "\n");
    else if (e.type === "progress") {
      if (ctx.io.isTTY && Date.now() - lastProgress > 200) {
        lastProgress = Date.now();
        ctx.io.out(`\r     ${Math.round(e.pct * 100)}% ${e.message}`.slice(0, 100).padEnd(100) + "\r");
      }
    } else {
      const line = formatEvent(e);
      if (line) ctx.io.out((ctx.io.isTTY ? "\r" + " ".repeat(100) + "\r" : "") + line + "\n");
    }
    if (e.type === "needs-approval") needs.push(e);
    if (e.type === "estimate") {
      estimates.set(e.estimate.planHash, e.estimate.totalUsd);
      spentEstimate += e.estimate.totalUsd;
    }
    if (e.type === "error") lastError = e;
    if (e.type === "job-end") status = e.status;
  }
  return { status, needs, estimates, spentEstimate, lastError };
}

/** Follows a job; Ctrl-C cancels it (first press), the follower then sees job-end "canceled". */
export async function followWithCancel(ctx: CliContext, engine: EngineExt, jobId: string): Promise<FollowResult> {
  let canceled = false;
  const onSig = () => {
    if (canceled) return;
    canceled = true;
    ctx.io.err("\ncanceling…\n");
    void engine.cancel(jobId).catch(() => undefined);
  };
  process.on("SIGINT", onSig);
  try {
    return await follow(ctx, engine, jobId);
  } finally {
    process.off("SIGINT", onSig);
  }
}

/** Submits (or resumes) a job and follows it to the end, applying --yes/--max-cost to cost/style gates. */
export async function runJob(ctx: CliContext, req: JobRequest | { resume: string; slug: string }): Promise<number> {
  const engine = await ctx.engine();
  const g = ctx.globals();
  const maxCost = parseMaxCost(g.maxCost);
  let jobId = "resume" in req ? (await engine.resume(req.resume)).jobId : (await engine.submit(req)).jobId;
  const slug = req.slug;
  let canceled = false;
  const onSig = () => {
    if (canceled) return;
    canceled = true;
    ctx.io.err("\ncanceling…\n");
    void engine.cancel(jobId).catch(() => undefined);
  };
  process.on("SIGINT", onSig);
  try {
    const approved = new Set<string>();
    for (let round = 0; round < 12; round++) {
      const r = await follow(ctx, engine, jobId);
      if (r.status === "succeeded") return EXIT.ok;
      if (r.status === "canceled" || canceled) return EXIT.canceled;
      if (r.status !== "waiting-approval") {
        if (r.lastError && !g.json) ctx.io.err(`failed: ${r.lastError.code}: ${r.lastError.message}\n`);
        return EXIT.error;
      }
      const auto: Need[] = [];
      const manual: Need[] = [];
      for (const n of r.needs) {
        const key = `${n.gate}:${n.planHash}`;
        const est = r.estimates.get(n.planHash) ?? r.spentEstimate;
        const ok = !EDITORIAL_GATES.includes(n.gate) && !approved.has(key) && (
          (n.gate === "cost" && (g.yes === true || (maxCost !== null && est <= maxCost + 1e-9))) || (n.gate === "style-confirm" && g.yes === true));
        (ok ? auto : manual).push(n);
      }
      if (manual.length || auto.length === 0) {
        if (!g.json) {
          ctx.io.err(`\nwaiting for approval (exit 3):\n`);
          for (const n of manual.length ? manual : r.needs) ctx.io.err(gateHint(slug, n, jobId) + "\n");
          if (r.needs.some((n) => EDITORIAL_GATES.includes(n.gate))) ctx.io.err("  (--yes and --max-cost never satisfy editorial gates)\n");
          if (r.needs.some((n) => n.gate === "cost") && maxCost !== null) ctx.io.err(`  (the estimate is above --max-cost $${maxCost.toFixed(2)})\n`);
        }
        return EXIT.gate;
      }
      for (const n of auto) {
        approved.add(`${n.gate}:${n.planHash}`);
        await engine.approve(slug, n.gate, {
          stage: n.stage, lang: n.lang as Lang | null, planHash: n.planHash, by: "flag",
          note: n.gate === "cost" ? (g.yes ? "--yes" : `--max-cost ${maxCost}`) : "--yes", items: n.gate === "cost" ? [n.planHash] : [], itemNotes: {},
        });
        if (!g.json) ctx.io.out(`[gate] ${n.gate} approved by ${g.yes ? "--yes" : "--max-cost"}\n`);
      }
      jobId = (await engine.resume(jobId)).jobId;
    }
    ctx.io.err("too many approval rounds\n");
    return EXIT.error;
  } finally {
    process.off("SIGINT", onSig);
  }
}
