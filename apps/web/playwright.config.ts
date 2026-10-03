// Playwright smoke (M3, nightly): `playwright test` in apps/web (docs/ISSUES.md asks for a `test:ui` script).
// Uses the shared Chrome Headless Shell (DOCMAKER_BROWSER_EXECUTABLE) and a production build on port 3212.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.DOCMAKER_UI_PORT ?? 3212);
const HOME = process.env.DOCMAKER_HOME ?? "/tmp/docmaker-home-web-ui";
const PROJECTS = process.env.DOCMAKER_PROJECTS ?? "/tmp/docmaker-projects-web-ui";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.DOCMAKER_BROWSER_EXECUTABLE ? { executablePath: process.env.DOCMAKER_BROWSER_EXECUTABLE } : {},
  },
  webServer: {
    command: `NEXT_TELEMETRY_DISABLED=1 npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/styles`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { DOCMAKER_HOME: HOME, DOCMAKER_PROJECTS: PROJECTS, DOCMAKER_OFFLINE: "1" },
  },
});
