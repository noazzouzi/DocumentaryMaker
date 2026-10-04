// Vitest globalSetup shared by every project (see vitest.shared.ts): each test run gets ONE temp root
// (<tmp>/docmaker-testrun-<pid>-XXXXXX) that every worker uses as TMPDIR (tmp-root.setup.ts), so every
// mkdtemp(os.tmpdir()) of a test, of the code under test and of the processes it spawns (CLI, job worker, ffmpeg,
// Chrome profiles) lands inside it; teardown removes it. Roots left by a killed run (dead pid) are pruned at start.
// The shared generator cache (docmaker-test-shared: procedural SFX/music, see packages/engine/test/shared-home.ts) stays
// in the real temp dir and is kept between runs for speed. DOCMAKER_KEEP_TEST_TMP=1 or DOCMAKER_KEEP_E2E=1 keep the root.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

export const RUN_PREFIX = "docmaker-testrun-";

declare module "vitest" {
  export interface ProvidedContext {
    docmakerTmpRoot: string;
    docmakerTestShared: string;
  }
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
};

/** Removes run roots whose owning vitest process is gone (a crashed or killed run). Returns the removed names. */
export function pruneStaleRunRoots(base: string, isAlive: (pid: number) => boolean = alive): string[] {
  const removed: string[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(base);
  } catch {
    return removed;
  }
  for (const n of names) {
    const m = new RegExp(`^${RUN_PREFIX}(\\d+)-`).exec(n);
    if (!m || isAlive(Number(m[1]))) continue;
    rmSync(path.join(base, n), { recursive: true, force: true });
    removed.push(n);
  }
  return removed;
}

const set = (v: string | undefined): boolean => !!v && v !== "0";
/** Whether to keep the run root (as the e2e helpers keep their homes: any non-empty value but "0"). */
export const keepTestTmp = (env: NodeJS.ProcessEnv = process.env): boolean => set(env.DOCMAKER_KEEP_TEST_TMP) || set(env.DOCMAKER_KEEP_E2E);

export default function setup(project: TestProject): () => void {
  const base = os.tmpdir();
  pruneStaleRunRoots(base);
  const root = mkdtempSync(path.join(base, `${RUN_PREFIX}${process.pid}-`));
  project.provide("docmakerTmpRoot", root);
  project.provide("docmakerTestShared", process.env.DOCMAKER_TEST_SHARED ?? path.join(base, "docmaker-test-shared"));
  return () => {
    if (keepTestTmp()) {
      process.stderr.write(`kept test temp root: ${root}\n`);
      return;
    }
    rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  };
}
