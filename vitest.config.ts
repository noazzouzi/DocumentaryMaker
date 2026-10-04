import { defineConfig } from "vitest/config";
import { testTmpRoot } from "./vitest.shared.ts";
export default defineConfig({
  test: {
    projects: [
      "packages/*",
      "apps/cli",
      "apps/web",
      { test: { ...testTmpRoot, name: "render-int", include: ["packages/{render,remotion}/test-int/**/*.test.ts?(x)"], testTimeout: 600_000, hookTimeout: 600_000, pool: "forks", maxWorkers: 1 } },
      { test: { ...testTmpRoot, name: "e2e", include: ["tests/e2e/**/*.e2e.test.ts"], testTimeout: 1_800_000, hookTimeout: 900_000, pool: "forks", maxWorkers: 1 } },
    ],
  },
});
