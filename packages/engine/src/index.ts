// @docmaker/engine — public API (packages/engine/src/index.ts). Never imports @docmaker/render (RenderClient by DI).
// §4.19 signatures are kept verbatim (types.ts); additional exports are additive helpers for the CLI, the web app and tests.
import type { RenderClient } from "@docmaker/core";
import type { Engine, EngineOptions, StageDef } from "./types";
import { STAGE_LIST } from "./stages";
import { createEngineImpl } from "./engine";
import { runWorkerLoop } from "./worker";

export type {
  JobRunnerMode, EngineOptions, StageStatus, DemoOptions, ImpactReport, Engine, DoctorCheck, DoctorReport, StageCtx, StageDef,
} from "./types";
export type { ProjectState } from "@docmaker/core";

export function createEngine(opts: EngineOptions): Promise<Engine> {
  return createEngineImpl(opts);
}

export const STAGES: readonly StageDef[] = STAGE_LIST;

/** Job-worker main loop (stdin IPC, §14.5). apps/cli/src/worker.ts calls it with an InProcessRenderClient. */
export function runJobWorker(o: { renderClient: RenderClient; cwd: string }): Promise<void> {
  return runWorkerLoop({
    renderClient: o.renderClient,
    cwd: o.cwd,
    makeEngine: async (renderClient, cwd) => {
      const e = await createEngineImpl({ cwd, renderClient });
      return {
        submit: (r) => e.submit(r), resume: (id) => e.resume(id), cancel: (id) => e.cancel(id), events: (id, a) => e.events(id, a),
        listLive: () => e.jobs.liveIds(), close: () => e.close(),
      };
    },
  });
}

// ---- additive exports
export { createEngineImpl, memoStore, secretNameOf } from "./engine";
export type { EngineExt, SetupComponent } from "./engine";
export type { EngineDeps, StylesApi, LlmApi, AssetsApi, VoiceApi, AudioApi, DirectorApi, ExportApi } from "./deps";
export { REAL_DEPS, withStubFallback, isNotImplemented } from "./deps";
export { JobManager, requestKey, isTerminal } from "./jobs";
export { planInvocations, pipelineEstimate, stageRange, NEEDS_TAKE } from "./pipeline";
export { WorkerHost, workerEnv, workerForkOptions } from "./worker";
export { runDoctor, parseFfmpegList, parseFfmpegVersion, nodeVersionCheck, REQUIRED_FILTERS, hyperframesResidue } from "./doctor";
export { parseBlackdetect, parseFreezedetect, blackViolations, sheetFrames } from "./stages/qa";
export { demoSlug, demoVoice } from "./demo";
export {
  gatingItems, fixOnly, factcheckPlanHash, NOTE_MIN, RECHECK_MAX_AGE_DAYS, ACK_SIG_PREFIX, ackSignature, ackCoverage, changedSinceAck, reopenChanged,
} from "./gates";
export { ProjectCosts, readReceipts } from "./costs";
export { stageDef, STAGE_ORDER } from "./stages";
export { exportReadmeRel, upToDateRender } from "./stages/export";
export { snapshotTimelineRel, snapshotMixRel } from "./stages/render";
export { remotionCodeHash } from "./codehash";
export { researchRequestKey, researchResumeInfo, RESEARCH_META, type ResearchResumeInfo } from "./stages/research";
