import { defineProject } from "vitest/config";
// Engine tests run whole fixture pipelines (fakes for Chrome/mix/export): generous timeouts, few workers (shared 4-vCPU box).
export default defineProject({
  test: { name: "engine", include: ["test/**/*.test.ts?(x)"], environment: "node", passWithNoTests: true, testTimeout: 180_000, hookTimeout: 300_000, pool: "forks", maxWorkers: 2 },
});
