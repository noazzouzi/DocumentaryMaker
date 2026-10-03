// CostTracker (§4.17, §5.4, §17.6): estimates with plan hashes, receipts.ndjson (paid-call idempotence), overrun stop.
import { readFile } from "node:fs/promises";
import {
  CostEstimate, DocmakerError, P, Receipt, hashJson, sha8, type CostTracker, type JobEventInput, type Lang, type Project, type StageId,
} from "@docmaker/core";
import type { ProjectStore } from "@docmaker/core/node";
import { nowIso } from "./util";

const k = (stage: StageId, lang: Lang | null) => `${stage}${lang ? "." + lang : ""}`;
const round2 = (x: number) => Math.round(x * 100) / 100;

export async function readReceipts(store: ProjectStore): Promise<Receipt[]> {
  let text = "";
  try {
    text = await readFile(store.abs(P.receipts), "utf8");
  } catch {
    return [];
  }
  const out: Receipt[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = Receipt.safeParse(JSON.parse(line));
      if (r.success) out.push(r.data);
    } catch { /* torn last line after a crash: ignore */ }
  }
  return out;
}

export class ProjectCosts implements CostTracker {
  private readonly approved = new Map<string, number>();
  private readonly jobSpend = new Map<string, number>();
  private constructor(
    private readonly store: ProjectStore,
    private project: Project,
    private readonly jobId: string | null,
    private readonly emit: (e: JobEventInput) => void,
    private readonly receipts: Receipt[],
  ) {}

  static async open(store: ProjectStore, project: Project, jobId: string | null, emit: (e: JobEventInput) => void): Promise<ProjectCosts> {
    return new ProjectCosts(store, project, jobId, emit, await readReceipts(store));
  }

  setProject(p: Project): void {
    this.project = p;
  }

  /** The approved estimate of a stage in this job (the overrun rule compares against it). */
  setApproved(stage: StageId, lang: Lang | null, usd: number): void {
    this.approved.set(k(stage, lang), usd);
  }

  /** Total spent on a stage/lang over the project's whole history (shown in re-approval summaries). */
  spentHistoryUsd(stage: StageId, lang: Lang | null): number {
    return this.receipts.filter((r) => r.stage === stage && r.lang === lang).reduce((a, r) => a + r.costUsd, 0);
  }

  async estimate(e: Omit<CostEstimate, "schemaVersion" | "id" | "createdAt" | "planHash">, inputsHash: string): Promise<CostEstimate> {
    // The spend so far is part of the plan: after an overrun stop, resuming needs a NEW approval showing it (§5.4).
    const spentSoFar = round2(this.spentHistoryUsd(e.stage, e.lang));
    const planHash = hashJson({ inputsHash, stage: e.stage, lang: e.lang, lines: e.lines, totalUsd: e.totalUsd, spentSoFar });
    const est = CostEstimate.parse({ ...e, schemaVersion: 1, id: `est-${k(e.stage, e.lang)}-${sha8(planHash)}`, planHash, createdAt: nowIso() });
    await this.store.writeJson(P.estimate(e.stage, e.lang), CostEstimate, est, { writer: "engine" });
    return est;
  }

  async findReceipt(fingerprint: string): Promise<Receipt | null> {
    let best: Receipt | null = null;
    for (const r of this.receipts) {
      if (r.fingerprint !== fingerprint) continue;
      if (!best || (r.outputRef && !best.outputRef)) best = r;
    }
    return best;
  }

  async record(r: Omit<Receipt, "createdAt" | "jobId">): Promise<Receipt> {
    const full = Receipt.parse({ ...r, createdAt: nowIso(), jobId: this.jobId });
    await this.store.appendNdjson(P.receipts, full);
    this.receipts.push(full);
    this.jobSpend.set(k(full.stage, full.lang), (this.jobSpend.get(k(full.stage, full.lang)) ?? 0) + full.costUsd);
    this.emit({ type: "cost", receipt: full });
    // overrun rule (§5.4): the stage stops on the paid call that crosses the limit
    this.assertWithinBudget(full.stage, full.lang);
    return full;
  }

  spentUsd(stage: StageId, lang: Lang | null): number {
    return this.jobSpend.get(k(stage, lang)) ?? 0;
  }

  spentTotalUsd(): number {
    return this.receipts.reduce((a, r) => a + r.costUsd, 0);
  }

  assertWithinBudget(stage: StageId, lang: Lang | null): void {
    const spent = this.spentUsd(stage, lang);
    const est = this.approved.get(k(stage, lang));
    const hint = "approve a new estimate (it shows the spend so far), then resume the job";
    if (est !== undefined && spent > Math.max(1.5 * est, est + 1)) {
      throw new DocmakerError("BUDGET_EXCEEDED", `${k(stage, lang)} spent $${spent.toFixed(2)}, over the approved estimate $${est.toFixed(2)} (limit max(1.5×, +$1))`, { hint });
    }
    if (spent > this.project.budget.maxUsdPerStage) {
      throw new DocmakerError("BUDGET_EXCEEDED", `${k(stage, lang)} spent $${spent.toFixed(2)} > maxUsdPerStage $${this.project.budget.maxUsdPerStage}`, { hint });
    }
    const total = this.spentTotalUsd();
    if (total > this.project.budget.maxUsdTotal) {
      throw new DocmakerError("BUDGET_EXCEEDED", `project spend $${total.toFixed(2)} > maxUsdTotal $${this.project.budget.maxUsdTotal}`, { hint: "raise budget.maxUsdTotal in the project settings" });
    }
  }
}
