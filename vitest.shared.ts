// Shared by every vitest project config: one temp root per test run, removed at teardown (tests/support/tmp-root.*).
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const testTmpRoot = {
  globalSetup: [path.join(here, "tests/support/tmp-root.global.ts")],
  setupFiles: [path.join(here, "tests/support/tmp-root.setup.ts")],
};
