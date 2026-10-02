import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { name: "remotion-int", include: ["test-int/**/*.test.ts?(x)"], environment: "node", pool: "forks", maxWorkers: 1, testTimeout: 600_000, hookTimeout: 600_000, passWithNoTests: true },
});
