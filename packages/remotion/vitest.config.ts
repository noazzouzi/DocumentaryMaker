import { defineProject } from "vitest/config";
import { testTmpRoot } from "../../vitest.shared.ts";
export default defineProject({ test: { ...testTmpRoot, name: "remotion", include: ["test/**/*.test.ts?(x)"], environment: "node", passWithNoTests: true } });
