// Shared test helpers: an offline runtime in a temp home, a silent logger and a recording CostTracker.
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CostTracker, Logger, Receipt } from "@docmaker/core";
import { loadRuntime } from "@docmaker/core/node";
import type { VoiceCtx } from "../src/index";

export const DATA = path.join(import.meta.dirname, "data");

export function tmpDir(prefix = "voice-test-"): string {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

export const silentLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {},
  child() { return silentLogger; },
};

export function fakeCosts(): CostTracker & { receipts: Omit<Receipt, "createdAt" | "jobId">[]; budgetChecks: number } {
  const receipts: Omit<Receipt, "createdAt" | "jobId">[] = [];
  const t = {
    receipts,
    budgetChecks: 0,
    async estimate() { throw new Error("not used"); },
    async findReceipt() { return null; },
    async record(r: Omit<Receipt, "createdAt" | "jobId">) { receipts.push(r); return { ...r, createdAt: new Date().toISOString(), jobId: null }; },
    spentUsd() { return receipts.reduce((a, r) => a + r.costUsd, 0); },
    spentTotalUsd() { return receipts.reduce((a, r) => a + r.costUsd, 0); },
    assertWithinBudget() { t.budgetChecks++; },
  };
  return t as unknown as CostTracker & { receipts: Omit<Receipt, "createdAt" | "jobId">[]; budgetChecks: number };
}

export function makeCtx(o?: { offline?: boolean; home?: string; secrets?: Record<string, string> }): VoiceCtx & { costs: ReturnType<typeof fakeCosts>; events: [number, string][] } {
  const home = o?.home ?? tmpDir("voice-home-");
  const { config } = loadRuntime({
    cwd: import.meta.dirname,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DOCMAKER_HOME: home, DOCMAKER_PROJECTS: path.join(home, "projects"), DOCMAKER_OFFLINE: o?.offline === false ? "0" : "1" },
  });
  const events: [number, string][] = [];
  return {
    config, secrets: Object.freeze({ ...(o?.secrets ?? {}) }), logger: silentLogger, signal: new AbortController().signal,
    progress: (p, m) => { events.push([p, m]); }, costs: fakeCosts(), events,
  };
}
