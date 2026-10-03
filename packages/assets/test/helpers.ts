// Test helpers: isolated homes, offline-by-default runtime, fake HTTP transport and cost tracker.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CostTracker, HttpClient, Logger, Receipt, RuntimeConfig } from "@docmaker/core";
import { createLogger, loadRuntime } from "@docmaker/core/node";
import { createHttpClient, FrozenCache, type AssetsCtx } from "../src/index";

export const DATA = path.join(import.meta.dirname, "data");
export const REPO = path.resolve(import.meta.dirname, "../../..");

export function tmpDir(prefix = "w3"): string {
  return mkdtempSync(path.join(os.tmpdir(), `docmaker-${prefix}-`));
}

export function makeConfig(o?: { offline?: boolean; contact?: string | null; home?: string }): RuntimeConfig {
  const home = o?.home ?? tmpDir("home");
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, HOME: process.env.HOME, DOCMAKER_HOME: home, DOCMAKER_PROJECTS: path.join(home, "projects"),
    DOCMAKER_REPO_ROOT: REPO, DOCMAKER_OFFLINE: o?.offline === false ? "0" : "1", DOCMAKER_LOG_LEVEL: "error",
  };
  if (o?.contact) env.DOCMAKER_CONTACT = o.contact;
  return loadRuntime({ env, cwd: REPO }).config;
}

export const quietLogger = (): Logger => createLogger({ level: "error", sink: () => undefined });

export class FakeCosts implements CostTracker {
  receipts: Receipt[] = [];
  async estimate(): Promise<never> {
    throw new Error("not used");
  }
  async findReceipt(fp: string) {
    return this.receipts.find((r) => r.fingerprint === fp) ?? null;
  }
  async record(r: Omit<Receipt, "createdAt" | "jobId">) {
    const full = { ...r, createdAt: new Date().toISOString(), jobId: null } as Receipt;
    this.receipts.push(full);
    return full;
  }
  spentUsd() {
    return 0;
  }
  spentTotalUsd() {
    return 0;
  }
  assertWithinBudget() { /* unlimited in tests */ }
}

export function makeCtx(o?: { offline?: boolean; http?: HttpClient; config?: RuntimeConfig }): AssetsCtx & { costs: FakeCosts } {
  const config = o?.config ?? makeConfig({ offline: o?.offline ?? true });
  const logger = quietLogger();
  return {
    config, secrets: {}, logger, http: o?.http ?? createHttpClient({ config, logger }), signal: new AbortController().signal,
    progress: () => undefined, costs: new FakeCosts(), cache: new FrozenCache({ config, logger }),
  };
}

/** A fake fetch: routes by URL; records calls (url + headers). */
export function fakeFetch(routes: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; headers: Record<string, string>; method: string }[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url, headers, method: init?.method ?? "GET" });
    return routes(url, init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

export const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

export function cleanup(...dirs: string[]): void {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
}
