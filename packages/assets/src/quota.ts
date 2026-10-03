// Per-provider request budgets (fixed windows per minute/hour/day), persisted in <home>/cache/http/quota.json so daily caps
// (Openverse 200/day) survive restarts. Minute windows wait; hour/day windows refuse with PROVIDER_RATE_LIMIT.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { DocmakerError } from "@docmaker/core";
import type { ProviderLimits, RuntimeConfig } from "@docmaker/core";
import { withFileLock } from "@docmaker/core/node";
import { writeFileAtomic } from "./util";

type Win = { start: number; count: number };
type State = Record<string, { min?: Win; hour?: Win; day?: Win }>;
const SPAN = { min: 60_000, hour: 3_600_000, day: 86_400_000 } as const;
const MAX_WAIT_MS = 65_000;

export class QuotaBuckets {
  readonly file: string;
  private readonly lock: string;
  private readonly now: () => number;
  constructor(config: RuntimeConfig, o?: { now?: () => number }) {
    this.file = path.join(config.paths.httpCache, "quota.json");
    this.lock = path.join(config.paths.locks, "http-quota.lock");
    this.now = o?.now ?? (() => Date.now());
  }

  private async read(): Promise<State> {
    try {
      const j = JSON.parse(await readFile(this.file, "utf8")) as unknown;
      return j && typeof j === "object" ? (j as State) : {};
    } catch {
      return {};
    }
  }

  /** Consumes one request for `provider`; waits for the minute window when needed. */
  async acquire(provider: string, limits: ProviderLimits, signal: AbortSignal): Promise<void> {
    for (;;) {
      const wait = await withFileLock(this.lock, "assets-quota", async () => {
        const st = await this.read();
        const s = (st[provider] ??= {});
        const t = this.now();
        const roll = (k: keyof typeof SPAN) => {
          const w = s[k];
          if (!w || t - w.start >= SPAN[k]) s[k] = { start: t, count: 0 };
          return s[k]!;
        };
        const checks: [keyof typeof SPAN, number | undefined][] = [["day", limits.perDay], ["hour", limits.perHour], ["min", limits.perMin]];
        for (const [k, cap] of checks) {
          if (cap === undefined) continue;
          const w = roll(k);
          if (w.count >= cap) {
            const retryMs = w.start + SPAN[k] - t;
            if (k !== "min" || retryMs > MAX_WAIT_MS) {
              throw new DocmakerError("PROVIDER_RATE_LIMIT", `${provider}: ${cap} requests per ${k} reached`, { retryable: false, details: { retryAfterMs: retryMs } });
            }
            return retryMs;
          }
        }
        for (const [k, cap] of checks) if (cap !== undefined) roll(k).count++;
        await writeFileAtomic(this.file, JSON.stringify(st));
        return 0;
      }, { signal, pollMs: 25 });
      if (wait <= 0) return;
      await new Promise<void>((resolve, reject) => {
        const tm = setTimeout(resolve, wait + 5);
        signal.addEventListener("abort", () => { clearTimeout(tm); reject(new DocmakerError("CANCELED", "canceled")); }, { once: true });
      });
    }
  }
}

/** Per-provider concurrency limiter (in-process). */
export class ConcurrencyGate {
  private active = new Map<string, number>();
  private queue = new Map<string, (() => void)[]>();
  async run<T>(key: string, max: number, fn: () => Promise<T>): Promise<T> {
    while ((this.active.get(key) ?? 0) >= Math.max(1, max)) {
      await new Promise<void>((r) => {
        const q = this.queue.get(key) ?? [];
        q.push(r);
        this.queue.set(key, q);
      });
    }
    this.active.set(key, (this.active.get(key) ?? 0) + 1);
    try {
      return await fn();
    } finally {
      this.active.set(key, (this.active.get(key) ?? 1) - 1);
      this.queue.get(key)?.shift()?.();
    }
  }
}
