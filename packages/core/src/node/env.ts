// packages/core/src/node/env.ts — repo root discovery, the secrets/env chain, User-Agent policy (§4.18, §17.1–17.2).
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ENV_KEYS, ENV_SETTINGS, type SecretName, type Secrets } from "../schema/project";
import { CONTACT_UA_HOSTS, type HomePaths, type RuntimeConfig } from "../interfaces";
import { DocmakerError } from "../util/errors";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const DEFAULT_RENDER_LOCK = "/tmp/docmaker-render.lock";

function walkUp(from: string): string | null {
  let dir = path.resolve(from);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Nearest ancestor of `from` containing pnpm-workspace.yaml (or DOCMAKER_REPO_ROOT). Throws CONFIG if none. */
export function findRepoRoot(from: string): string {
  const env = process.env[ENV_SETTINGS.repoRoot];
  if (env) return path.resolve(env);
  const r = walkUp(from);
  if (!r) {
    throw new DocmakerError("VALIDATION", `no pnpm-workspace.yaml above ${from}`, { hint: `set ${ENV_SETTINGS.repoRoot}` });
  }
  return r;
}

/** Tiny .env parser (no dotenv): KEY=VALUE, optional `export `, # comments, '…' and "…" quoting (\n \" \\ in double quotes). */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    if (v.startsWith('"')) {
      const end = v.lastIndexOf('"');
      // one pass, so an escaped backslash followed by "n" (`\\n`) stays a backslash + "n" (quoteEnvValue's inverse)
      v = (end > 0 ? v.slice(1, end) : v.slice(1)).replace(/\\([\\"n])/g, (_, c: string) => (c === "n" ? "\n" : c));
    } else if (v.startsWith("'")) {
      const end = v.lastIndexOf("'");
      v = end > 0 ? v.slice(1, end) : v.slice(1);
    } else {
      const hash = v.search(/\s#/);
      if (hash >= 0) v = v.slice(0, hash);
      v = v.trim();
    }
    out[m[1]!] = v;
  }
  return out;
}

function readEnvFileSync(p: string): Record<string, string> {
  try {
    return parseEnvFile(readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

function readJsonSync(p: string): unknown {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function homePaths(home: string): HomePaths {
  const j = (...p: string[]) => path.join(home, ...p);
  return {
    home, cache: j("cache"), blobs: j("cache", "blobs"), httpCache: j("cache", "http"), models: j("models"), ml: j("ml"),
    sfx: j("sfx"), music: j("music", "procedural"), styles: j("styles"), bundles: j("bundles"), bin: j("bin"),
    pyVenv: j("py", ".venv"), locks: j("locks"), logs: j("logs"), envFile: j(".env"), configFile: j("config.json"),
    browserFile: j("browser.json"), glProbe: j("gl-probe.json"),
  };
}

function userAgentBaseFor(repoRoot: string): string {
  const root = readJsonSync(path.join(repoRoot, "package.json")) as { version?: unknown; homepage?: unknown } | null;
  const core = readJsonSync(path.join(repoRoot, "packages", "core", "package.json")) as { version?: unknown } | null;
  const version = typeof root?.version === "string" ? root.version : typeof core?.version === "string" ? core.version : "0.0.0";
  const homepage = typeof root?.homepage === "string" && /^https?:\/\/[^\s]+$/.test(root.homepage) && !/example\.(com|org)/.test(root.homepage) ? root.homepage : null;
  return `DocumentaryMaker/${version}` + (homepage ? ` (+${homepage})` : "");
}

/** Precedence: process.env > <home>/.env > <repoRoot>/.env.local (tiny built-in parser; no dotenv). Called per job. */
export function loadRuntime(opts?: { cwd?: string; env?: NodeJS.ProcessEnv }): { secrets: Secrets; config: RuntimeConfig } {
  const penv = opts?.env ?? process.env;
  const cwd = opts?.cwd ?? process.cwd();
  const rootEnv = penv[ENV_SETTINGS.repoRoot];
  const repoRoot = rootEnv ? path.resolve(rootEnv) : walkUp(cwd);
  if (!repoRoot) throw new DocmakerError("VALIDATION", `no pnpm-workspace.yaml above ${cwd}`, { hint: `set ${ENV_SETTINGS.repoRoot}` });
  const local = readEnvFileSync(path.join(repoRoot, ".env.local"));
  const homeRaw = penv[ENV_SETTINGS.home] || local[ENV_SETTINGS.home] || path.join(penv.HOME || os.homedir(), ".documentarymaker");
  const home = path.resolve(repoRoot, homeRaw);
  const paths = homePaths(home);
  const homeEnv = readEnvFileSync(paths.envFile);
  const get = (k: string): string | undefined => {
    for (const src of [penv, homeEnv, local]) {
      const v = src[k];
      if (v !== undefined && v !== "") return v;
    }
    return undefined;
  };
  const secrets: Partial<Record<SecretName, string>> = {};
  for (const [name, envName] of Object.entries(ENV_KEYS) as [SecretName, string][]) {
    const v = get(envName);
    if (v !== undefined) secrets[name] = v;
  }
  const homeConfig = readJsonSync(paths.configFile) as { contact?: unknown } | null;
  const browserDoc = readJsonSync(paths.browserFile) as { executable?: unknown } | null;
  const level = get(ENV_SETTINGS.logLevel);
  const auto = Number(get(ENV_SETTINGS.autoApproveUsd) ?? "0");
  const offlineRaw = (get(ENV_SETTINGS.offline) ?? "").toLowerCase();
  const projects = get(ENV_SETTINGS.projects);
  const config: RuntimeConfig = {
    repoRoot,
    paths,
    projectsDir: projects ? path.resolve(repoRoot, projects) : path.join(repoRoot, "projects"),
    contact: get(ENV_SETTINGS.contact) ?? (typeof homeConfig?.contact === "string" && homeConfig.contact !== "" ? homeConfig.contact : null),
    userAgentBase: userAgentBaseFor(repoRoot),
    ffmpeg: get(ENV_SETTINGS.ffmpeg) ?? "ffmpeg",
    ffprobe: get(ENV_SETTINGS.ffprobe) ?? "ffprobe",
    offline: offlineRaw === "1" || offlineRaw === "true" || offlineRaw === "yes",
    logLevel: (LOG_LEVELS as readonly string[]).includes(level ?? "") ? (level as RuntimeConfig["logLevel"]) : "info",
    autoApproveUsd: Number.isFinite(auto) && auto >= 0 ? auto : 0,
    browserExecutable: get(ENV_SETTINGS.browserExecutable) ?? (typeof browserDoc?.executable === "string" ? browserDoc.executable : null),
    renderLockFile: get(ENV_SETTINGS.renderLock) ?? DEFAULT_RENDER_LOCK,
  };
  return { secrets: Object.freeze(secrets), config };
}

/** "sk-a…9f3c" | "(unset)" */
export function maskSecret(s: string | undefined): string {
  if (s === undefined || s === "") return "(unset)";
  if (s.length <= 8) return "…" + s.slice(-2);
  if (s.length < 16) return s.slice(0, 2) + "…" + s.slice(-2);
  return s.slice(0, 4) + "…" + s.slice(-4);
}

function quoteEnvValue(v: string): string {
  return /^[A-Za-z0-9_./:@+-]*$/.test(v) ? v : '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

/** `docmaker keys set` / web key form: writes <home>/.env (mode 0600), never a project file. */
export async function writeSecret(home: string, envName: string, value: string): Promise<void> {
  if (!/^[A-Z][A-Z0-9_]*$/.test(envName)) throw new DocmakerError("VALIDATION", `invalid variable name ${envName}`);
  if (/[\r\n]/.test(value)) throw new DocmakerError("VALIDATION", "secret values cannot contain newlines");
  await mkdir(home, { recursive: true });
  const file = path.join(home, ".env");
  let lines: string[] = [];
  try {
    lines = (await readFile(file, "utf8")).split(/\r?\n/);
  } catch { /* new file */ }
  const re = new RegExp(`^\\s*(?:export\\s+)?${envName}\\s*=`);
  const line = `${envName}=${quoteEnvValue(value)}`;
  let found = false;
  lines = lines.map((l) => (re.test(l) ? ((found = true), line) : l));
  if (!found) {
    while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
    lines.push(line);
  }
  const tmp = `${file}.tmp-${process.pid}`;
  await writeFile(tmp, lines.join("\n") + "\n", { mode: 0o600 });
  await chmod(tmp, 0o600);
  await rename(tmp, file);
}

/** User-Agent for a URL: userAgentBase + `; contact: <contact>` ONLY for CONTACT_UA_HOSTS. Never reads git/OS user/hostname. */
export function userAgentFor(url: string, config: RuntimeConfig): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return config.userAgentBase;
  }
  if (config.contact && CONTACT_UA_HOSTS.includes(host)) return `${config.userAgentBase}; contact: ${config.contact}`;
  return config.userAgentBase;
}
