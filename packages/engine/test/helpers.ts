// Engine test harness: isolated home/projects (env object, process.env untouched), offline, real packages + fakes.
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_KEYS, type JobEvent, type JobRequest, type RenderClient } from "@docmaker/core";
import { loadRuntime } from "@docmaker/core/node";
import type { LlmClient } from "@docmaker/llm";
import { createEngineImpl, type EngineExt } from "../src/engine";
import type { EngineDeps } from "../src/deps";
import { FakeRenderClient, skeletonDeps } from "./fakes";
import { silentLogger } from "../src/util";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export interface TestEnv { root: string; env: NodeJS.ProcessEnv; cleanup(): void }

export function testEnv(tag: string): TestEnv {
  const root = mkdtempSync(path.join(os.tmpdir(), `docmaker-engine-${tag}-`));
  const env: NodeJS.ProcessEnv = { ...process.env, DOCMAKER_HOME: path.join(root, "home"), DOCMAKER_PROJECTS: path.join(root, "projects"), DOCMAKER_OFFLINE: "1", DOCMAKER_REPO_ROOT: REPO_ROOT, DOCMAKER_LOG_LEVEL: "error" };
  for (const k of Object.values(ENV_KEYS)) delete env[k];
  delete env.DOCMAKER_AUTO_APPROVE_USD;
  return { root, env, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

export async function testEngine(t: TestEnv, o: { deps?: EngineDeps; renderClient?: RenderClient | null; llmOverride?: LlmClient; skipReconcile?: boolean } = {}): Promise<EngineExt & { fakeRender: FakeRenderClient | null }> {
  const { config } = loadRuntime({ cwd: REPO_ROOT, env: t.env });
  const fake = o.renderClient === undefined ? new FakeRenderClient(config) : null;
  const e = await createEngineImpl({
    cwd: REPO_ROOT, env: t.env, renderClient: o.renderClient === undefined ? fake : o.renderClient, deps: o.deps ?? skeletonDeps(),
    llmOverride: o.llmOverride, skipReconcile: o.skipReconcile, logger: silentLogger,
  });
  return Object.assign(e, { fakeRender: fake });
}

export const stageReq = (slug: string, stage: JobRequest["stage"], over: Partial<JobRequest> = {}): JobRequest =>
  ({ slug, kind: "stage", stage, from: null, to: null, langs: [], force: false, options: {}, preset: null, ...over });
export const pipelineReq = (slug: string, from: JobRequest["from"], to: JobRequest["to"], over: Partial<JobRequest> = {}): JobRequest =>
  ({ slug, kind: "pipeline", stage: null, from, to, langs: [], force: false, options: {}, preset: null, ...over });

export async function collect(engine: EngineExt, jobId: string, afterSeq?: number): Promise<JobEvent[]> {
  const out: JobEvent[] = [];
  for await (const e of engine.events(jobId, afterSeq)) out.push(e);
  return out;
}

export async function runToEnd(engine: EngineExt, req: JobRequest): Promise<{ jobId: string; status: string; events: JobEvent[] }> {
  const { jobId } = await engine.submit(req);
  const events = await collect(engine, jobId);
  const rec = await engine.waitForJob(jobId);
  return { jobId, status: rec.status, events };
}

/** A fixture project (gates auto-approved for tulip-mania) with a confirmed style. */
export async function fixtureProject(engine: EngineExt, fixture = "tulip-mania", slug = "t1", languages: ("en" | "fr")[] = ["en"]) {
  const fx = await engine.rt.fixture(fixture);
  if (!fx) throw new Error(`fixture ${fixture} missing`);
  return engine.createProject({ idea: fx.idea, slug, languages, primaryLang: fx.primaryLang, targetMinutes: fx.targetMinutes, styleId: fx.styleId, llm: "fixture", fixtureId: fx.id, seed: fx.seed });
}

export function deferred<T = void>(): { promise: Promise<T>; resolve(v: T): void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
