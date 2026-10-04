import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";
import { testTmpRoot } from "../../vitest.shared";

const here = path.dirname(fileURLToPath(import.meta.url));
export default defineProject({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: path.join(here, "src/$1") },
      // `server-only` throws outside the react-server condition; route modules are imported directly in tests
      { find: /^server-only$/, replacement: path.join(here, "test/support/server-only.ts") },
    ],
  },
  test: { ...testTmpRoot, name: "web", include: ["test/**/*.test.ts?(x)"], environment: "node", passWithNoTests: true },
});
