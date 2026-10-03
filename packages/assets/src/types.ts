// Shared package types.
import type { CostTracker, HttpClient, Logger, Progress, RuntimeConfig, Secrets } from "@docmaker/core";
import type { FrozenCache } from "./cache";

export interface AssetsCtx { config: RuntimeConfig; secrets: Secrets; logger: Logger; http: HttpClient; signal: AbortSignal; progress: Progress; costs: CostTracker; cache: FrozenCache }
