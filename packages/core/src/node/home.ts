// packages/core/src/node/home.ts — DOCMAKER_HOME layout, HomeConfig, BrowserDoc, disk caps.
import { mkdir, readFile, statfs } from "node:fs/promises";
import { BrowserDoc, HomeConfig } from "../schema/ops";
import type { RuntimeConfig } from "../interfaces";
import { stableStringify } from "../util/json";
import { migrateDoc } from "../util/migrate";
import { atomicWrite } from "./fsutil";

const DEFAULT_HOME_CONFIG: HomeConfig = {
  schemaVersion: 1,
  remotionLicense: null,
  contact: null,
  uiLang: "auto",
  defaults: { languages: ["en"], targetMinutes: 20, styleId: null },
  onboardingDone: false,
};

/** Creates every HomePaths directory. */
export async function ensureHome(config: RuntimeConfig): Promise<void> {
  const p = config.paths;
  for (const d of [p.home, p.cache, p.blobs, p.httpCache, p.models, p.ml, p.sfx, p.music, p.styles, p.bundles, p.bin, p.locks, p.logs]) {
    await mkdir(d, { recursive: true });
  }
}

async function readJsonFile(file: string): Promise<unknown | undefined> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return undefined;
  }
  return JSON.parse(text);
}

/** <home>/config.json, defaults when missing. */
export async function readHomeConfig(config: RuntimeConfig): Promise<HomeConfig> {
  const raw = await readJsonFile(config.paths.configFile);
  if (raw === undefined) return structuredClone(DEFAULT_HOME_CONFIG);
  return HomeConfig.parse(migrateDoc("homeConfig", raw).value);
}

export async function writeHomeConfig(config: RuntimeConfig, patch: Partial<Omit<HomeConfig, "schemaVersion">>): Promise<HomeConfig> {
  const cur = await readHomeConfig(config);
  const next = HomeConfig.parse({ ...cur, ...patch, schemaVersion: 1 });
  await atomicWrite(config.paths.configFile, stableStringify(next));
  return next;
}

/** <home>/browser.json or null. */
export async function readBrowserDoc(config: RuntimeConfig): Promise<BrowserDoc | null> {
  const raw = await readJsonFile(config.paths.browserFile);
  if (raw === undefined) return null;
  return BrowserDoc.parse(migrateDoc("browser", raw).value);
}

/** Free bytes available to this user on the filesystem holding `dir` (statfs). */
export async function freeDiskBytes(dir: string): Promise<number> {
  const s = await statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}

const GiB = 1024 ** 3;
/** min(DOCMAKER_CACHE_MAX_GB ?? 20 GiB, 50 % of free disk) */
export async function cacheCapBytes(config: RuntimeConfig): Promise<number> {
  const raw = Number(process.env.DOCMAKER_CACHE_MAX_GB);
  const cap = Number.isFinite(raw) && raw > 0 ? raw * GiB : 20 * GiB;
  await mkdir(config.paths.cache, { recursive: true });
  const free = await freeDiskBytes(config.paths.cache);
  return Math.floor(Math.min(cap, free * 0.5));
}
