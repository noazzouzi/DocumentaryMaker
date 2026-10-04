import { defineProject } from "vitest/config";
import { testTmpRoot } from "../../vitest.shared.ts";
// Engine tests run whole fixture pipelines (fakes for Chrome/mix/export): generous timeouts, few workers (shared 4-vCPU box).
export default defineProject({
  test: { ...testTmpRoot, name: "engine", include: ["test/**/*.test.ts?(x)"], environment: "node", passWithNoTests: true, testTimeout: 180_000, hookTimeout: 300_000, pool: "forks", maxWorkers: 2,
    // vitest 5: a project with its own maxWorkers needs its own group (runs after the default group 0 in `pnpm test`)
    sequence: { groupOrder: 1 } },
});
