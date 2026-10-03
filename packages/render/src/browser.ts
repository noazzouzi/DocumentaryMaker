// Browser provisioning (§12.7): DOCMAKER_BROWSER_EXECUTABLE → <home>/browser.json → the repo's shared Chrome Headless
// Shell (<repoRoot>/node_modules/.remotion/...) → only with download:true (`docmaker setup --browser`): Remotion
// ensureBrowser() with cwd = repoRoot, then <home>/browser.json. Renders and tests never download implicitly.
import { constants, existsSync } from "node:fs";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { BrowserDoc, DocmakerError, stableStringify, type RuntimeConfig } from "@docmaker/core";
import { run } from "@docmaker/core/node";
import { loadRenderer } from "./remotion";

export const REPO_CHROME_REL = "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell";
const MISSING_HINT = "docmaker setup --browser";

async function isExecutable(p: string | null | undefined): Promise<boolean> {
  if (!p) return false;
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function browserJsonExecutable(config: RuntimeConfig): Promise<string | null> {
  try {
    const j = JSON.parse(await readFile(config.paths.browserFile, "utf8")) as { executable?: unknown };
    return typeof j.executable === "string" && j.executable !== "" ? j.executable : null;
  } catch {
    return null;
  }
}

/** The ordered candidates with where each came from (doctor shows them). */
export async function browserCandidates(config: RuntimeConfig): Promise<{ source: "env" | "config" | "browser.json" | "repo"; path: string }[]> {
  const out: { source: "env" | "config" | "browser.json" | "repo"; path: string }[] = [];
  const env = process.env.DOCMAKER_BROWSER_EXECUTABLE;
  if (env) out.push({ source: "env", path: env });
  if (config.browserExecutable && config.browserExecutable !== env) out.push({ source: "config", path: config.browserExecutable });
  const doc = await browserJsonExecutable(config);
  if (doc) out.push({ source: "browser.json", path: doc });
  out.push({ source: "repo", path: path.join(config.repoRoot, REPO_CHROME_REL) });
  return out;
}

/** First usable executable, or null (never downloads). */
export async function findBrowserExecutable(config: RuntimeConfig): Promise<string | null> {
  for (const c of await browserCandidates(config)) if (await isExecutable(c.path)) return c.path;
  return null;
}

async function browserVersion(exe: string, signal: AbortSignal): Promise<string> {
  try {
    const r = await run(exe, ["--version"], { signal, timeoutMs: 20_000 });
    const v = /(\d+\.\d+\.\d+\.\d+)/.exec(r.stdout + r.stderr)?.[1];
    return v ?? ((r.stdout.trim() || "unknown").slice(0, 80));
  } catch {
    return "unknown";
  }
}

async function writeBrowserDoc(config: RuntimeConfig, executable: string, version: string): Promise<void> {
  const doc = BrowserDoc.parse({ schemaVersion: 1, executable, version, installedAt: new Date().toISOString() });
  await mkdir(path.dirname(config.paths.browserFile), { recursive: true });
  const tmp = `${config.paths.browserFile}.tmp-${process.pid}`;
  await writeFile(tmp, stableStringify(doc));
  await rename(tmp, config.paths.browserFile);
}

/** <home>/browser.json → executable; else the repo's copy; else download Chrome Headless Shell (only when download=true). */
export async function ensureBrowserExecutable(config: RuntimeConfig, o: { download: boolean; signal: AbortSignal }): Promise<string> {
  const found = await findBrowserExecutable(config);
  if (found) {
    // setup --browser records what it found so every later process (and doctor) agrees on the executable
    if (o.download && (await browserJsonExecutable(config)) !== found) await writeBrowserDoc(config, found, await browserVersion(found, o.signal));
    return found;
  }
  if (!o.download) {
    throw new DocmakerError("TOOL_MISSING", "no Chrome Headless Shell found (DOCMAKER_BROWSER_EXECUTABLE, <home>/browser.json, node_modules/.remotion)", { hint: MISSING_HINT });
  }
  if (o.signal.aborted) throw new DocmakerError("CANCELED", "browser download canceled");
  if (config.offline) throw new DocmakerError("OFFLINE", "cannot download Chrome Headless Shell while offline", { hint: "unset DOCMAKER_OFFLINE and retry" });
  const { ensureBrowser } = await loadRenderer();
  const prev = process.cwd();
  let exe: string | null = null;
  try {
    process.chdir(config.repoRoot); // Remotion downloads into <nearest package.json dir>/node_modules/.remotion
    const status = await ensureBrowser({ logLevel: "warn" });
    if (status.type === "local-puppeteer-browser" || status.type === "user-defined-path") exe = status.path;
  } catch (e) {
    throw new DocmakerError("TOOL_MISSING", `Chrome Headless Shell download failed: ${e instanceof Error ? e.message : String(e)}`, { hint: MISSING_HINT, retryable: true, cause: e });
  } finally {
    process.chdir(prev);
  }
  if (!exe || !existsSync(exe)) exe = path.join(config.repoRoot, REPO_CHROME_REL);
  if (!(await isExecutable(exe))) throw new DocmakerError("TOOL_MISSING", `downloaded browser is not executable: ${exe}`, { hint: MISSING_HINT });
  await writeBrowserDoc(config, exe, await browserVersion(exe, o.signal));
  return exe;
}
