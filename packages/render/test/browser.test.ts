import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureBrowserExecutable, findBrowserExecutable } from "../src/browser";
import { testConfig, tmpDir } from "./helpers";

const signal = new AbortController().signal;
let saved: string | undefined;
beforeEach(() => {
  saved = process.env.DOCMAKER_BROWSER_EXECUTABLE;
  delete process.env.DOCMAKER_BROWSER_EXECUTABLE;
});
afterEach(() => {
  if (saved === undefined) delete process.env.DOCMAKER_BROWSER_EXECUTABLE;
  else process.env.DOCMAKER_BROWSER_EXECUTABLE = saved;
});

async function fakeExe(file: string): Promise<string> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "#!/bin/sh\necho 'Google Chrome for Testing 141.0.7390.54'\n");
  await chmod(file, 0o755);
  return file;
}

describe("ensureBrowserExecutable (§12.7)", () => {
  it("precedence: env → browser.json → repo copy; never downloads without download:true", async () => {
    const t = await tmpDir();
    try {
      const repo = path.join(t.dir, "repo");
      const config = testConfig(path.join(t.dir, "home"), { repoRoot: repo });
      await expect(ensureBrowserExecutable(config, { download: false, signal })).rejects.toMatchObject({ code: "TOOL_MISSING", hint: "docmaker setup --browser" });
      const repoExe = await fakeExe(path.join(repo, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"));
      expect(await ensureBrowserExecutable(config, { download: false, signal })).toBe(repoExe);
      const docExe = await fakeExe(path.join(t.dir, "doc-chrome"));
      await mkdir(config.paths.home, { recursive: true });
      await writeFile(config.paths.browserFile, JSON.stringify({ schemaVersion: 1, executable: docExe, version: "1", installedAt: "2026-10-03T00:00:00.000Z" }));
      expect(await findBrowserExecutable(config)).toBe(docExe);
      const envExe = await fakeExe(path.join(t.dir, "env-chrome"));
      process.env.DOCMAKER_BROWSER_EXECUTABLE = envExe;
      expect(await ensureBrowserExecutable(config, { download: false, signal })).toBe(envExe);
      // a configured path that does not exist is skipped
      process.env.DOCMAKER_BROWSER_EXECUTABLE = path.join(t.dir, "missing");
      expect(await ensureBrowserExecutable(config, { download: false, signal })).toBe(docExe);
    } finally {
      await t.cleanup();
    }
  });

  it("setup (download:true) with an existing browser records it in browser.json without downloading", async () => {
    const t = await tmpDir();
    try {
      const repo = path.join(t.dir, "repo");
      const config = testConfig(path.join(t.dir, "home"), { repoRoot: repo });
      const repoExe = await fakeExe(path.join(repo, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell"));
      expect(await ensureBrowserExecutable(config, { download: true, signal })).toBe(repoExe);
      const doc = JSON.parse(await readFile(config.paths.browserFile, "utf8")) as { executable: string; version: string };
      expect(doc.executable).toBe(repoExe);
      expect(doc.version).toBe("141.0.7390.54");
    } finally {
      await t.cleanup();
    }
  });

  it("offline download is refused", async () => {
    const t = await tmpDir();
    try {
      const config = testConfig(path.join(t.dir, "home"), { repoRoot: path.join(t.dir, "repo"), offline: true });
      await expect(ensureBrowserExecutable(config, { download: true, signal })).rejects.toMatchObject({ code: "OFFLINE" });
    } finally {
      await t.cleanup();
    }
  });
});
