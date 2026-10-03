// state.json: StageState keyed by (stage, lang, variant). "stale" is computed, never stored (§5.1, §5.3).
import { P, ProjectState, type Lang, type StageId, type StageState } from "@docmaker/core";
import { withFileLock, type ProjectStore } from "@docmaker/core/node";

export interface StageKey { stage: StageId; lang: Lang | null; variant: string | null }
export const keyOf = (k: StageKey): string => `${k.stage}|${k.lang ?? "-"}|${k.variant ?? "-"}`;
const sameKey = (s: StageState, k: StageKey) => s.stage === k.stage && s.lang === k.lang && s.variant === k.variant;

export function emptyStageState(k: StageKey, stageVersion: number): StageState {
  return {
    stage: k.stage, lang: k.lang, variant: k.variant, status: "idle", stageVersion, inputsHash: null, outputsHash: null,
    startedAt: null, finishedAt: null, error: null, costUsd: 0, artifacts: [],
  };
}

export async function readState(store: ProjectStore): Promise<ProjectState> {
  return (await store.readJsonOrNull(P.state, ProjectState)) ?? { schemaVersion: 1, stages: [] };
}

export function findStage(state: ProjectState, k: StageKey): StageState | null {
  return state.stages.find((s) => sameKey(s, k)) ?? null;
}

const STATE_LOCK = ".state.lock";
const NEVER = new AbortController().signal;

/** Read-modify-write of one StageState under a file lock (several jobs of a project may update state concurrently). */
export async function updateStageState(store: ProjectStore, k: StageKey, stageVersion: number, patch: Partial<StageState>): Promise<StageState> {
  return withFileLock(store.abs(STATE_LOCK), `state:${keyOf(k)}`, async () => {
    const st = await readState(store);
    const cur = findStage(st, k) ?? emptyStageState(k, stageVersion);
    const next: StageState = { ...cur, ...patch, stage: k.stage, lang: k.lang, variant: k.variant };
    const others = st.stages.filter((s) => !sameKey(s, k));
    const order = (s: StageState) => keyOf(s);
    const stages = [...others, next].sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
    await store.writeJson(P.state, ProjectState, { schemaVersion: 1, stages }, { writer: "engine" });
    return next;
  }, { signal: NEVER, pollMs: 20 });
}
