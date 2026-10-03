// Engine host (SPEC §14.1). One engine per Next server process, shared through globalThis so dev hot reloads and the
// many route-handler module instances reuse it. Jobs run in ONE forked job worker (runner "worker"); this process only
// does cheap work (reads, writes, approvals, estimates, styles, live search, freeze, upload, SSE relay).
import "server-only";
import path from "node:path";
import { createEngine, type Engine } from "@docmaker/engine";
import { findRepoRoot } from "@docmaker/core/node";

const g = globalThis as unknown as { __docmaker?: Promise<Engine>; __docmakerTest?: boolean };

/** Repo root: DOCMAKER_REPO_ROOT, else the nearest ancestor of the cwd with pnpm-workspace.yaml (next runs in apps/web). */
export function repoRootOf(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string {
  return env.DOCMAKER_REPO_ROOT ?? findRepoRoot(cwd);
}

export const getEngine = (): Promise<Engine> =>
  (g.__docmaker ??= (async () => {
    const repoRoot = repoRootOf();
    return createEngine({
      cwd: repoRoot,
      renderClient: null,
      // never import.meta.resolve (throws in Turbopack server bundles): the worker is located from the repo root
      runner: { kind: "worker", workerPath: path.join(repoRoot, "apps/cli/src/worker.ts") },
    });
  })().catch((e: unknown) => {
    // do not cache a failed start (e.g. the engine is not implemented yet, or the home is unwritable): retry next request
    if (!g.__docmakerTest) g.__docmaker = undefined;
    throw e;
  }));

/** Tests: inject a fake engine (null → reset to the real one on next use). */
export function setEngineForTests(e: Engine | null): void {
  g.__docmakerTest = e !== null;
  g.__docmaker = e ? Promise.resolve(e) : undefined;
}

/** Absolute project directory (slug already validated by the caller). */
export function projectDirOf(engine: Engine, slug: string): string {
  return path.join(engine.config.projectsDir, slug);
}
