// Bundle once per code hash (§12.1). codeHash = sha256 of the sorted [relative path + sha256(content)] of
// packages/remotion/src/** and packages/core/src/** (minus core/src/node/**) + the exact versions of remotion,
// @remotion/* and @fontsource/*. The bundle lives in <home>/bundles/<codeHash>/ and is built under the machine lock
// <home>/locks/bundle.lock (callers already hold the render lock).
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DocmakerError, type Logger, type RuntimeConfig } from "@docmaker/core";
import { withFileLock } from "@docmaker/core/node";
import { loadBundler } from "./remotion";

const SOURCE_DIRS: readonly { dir: string; exclude: readonly string[] }[] = [
  { dir: "packages/remotion/src", exclude: [] },
  { dir: "packages/core/src", exclude: ["packages/core/src/node"] },
];
const PINNED = /^(remotion|@remotion\/.+|@fontsource\/.+)$/;
const KEEP_BUNDLES = 3;

async function walk(abs: string, rel: string, exclude: readonly string[], out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(abs, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
  for (const e of entries) {
    const r = `${rel}/${e.name}`;
    if (exclude.includes(r) || e.name === "node_modules" || e.name === ".DS_Store") continue;
    if (e.isDirectory()) await walk(path.join(abs, e.name), r, exclude, out);
    else if (e.isFile()) out.push(r);
  }
}

/** Exact versions of the pinned render-time packages (declared in the remotion/render manifests; installed if resolvable). */
async function pinnedVersions(repoRoot: string): Promise<string[]> {
  const versions = new Map<string, string>();
  for (const pkg of ["packages/remotion/package.json", "packages/render/package.json"]) {
    try {
      const j = JSON.parse(await readFile(path.join(repoRoot, pkg), "utf8")) as { dependencies?: Record<string, string> };
      for (const [name, v] of Object.entries(j.dependencies ?? {})) if (PINNED.test(name)) versions.set(name, v);
    } catch {
      /* a missing manifest only weakens the hash; the sources still count */
    }
  }
  for (const name of [...versions.keys()]) {
    for (const base of ["packages/remotion", "packages/render"]) {
      try {
        const j = JSON.parse(await readFile(path.join(repoRoot, base, "node_modules", name, "package.json"), "utf8")) as { version?: string };
        if (j.version) {
          versions.set(name, j.version);
          break;
        }
      } catch {
        /* not installed under this package */
      }
    }
  }
  return [...versions.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([n, v]) => `${n}@${v}`);
}

export async function computeCodeHash(repoRoot: string): Promise<string> {
  const files: string[] = [];
  for (const s of SOURCE_DIRS) await walk(path.join(repoRoot, s.dir), s.dir, s.exclude, files);
  if (!files.some((f) => f.startsWith("packages/remotion/src/"))) {
    throw new DocmakerError("UPSTREAM_MISSING", `no Remotion sources under ${path.join(repoRoot, "packages/remotion/src")}`);
  }
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const h = createHash("sha256");
  h.update("docmaker-codehash-v1\n");
  for (const f of files) {
    const content = await readFile(path.join(repoRoot, f));
    h.update(`${f}\0${createHash("sha256").update(content).digest("hex")}\n`);
  }
  for (const v of await pinnedVersions(repoRoot)) h.update(`pkg\0${v}\n`);
  return h.digest("hex");
}

export interface BundleOptions {
  config: RuntimeConfig;
  logger: Logger;
  enableCaching: boolean;
  signal: AbortSignal;
  onProgress?: (pct: number) => void;
  codeHash?: string;
}

export const bundleDir = (config: RuntimeConfig, codeHash: string) => path.join(config.paths.bundles, codeHash);
export const isBundleReady = (config: RuntimeConfig, codeHash: string) => existsSync(path.join(bundleDir(config, codeHash), "index.html"));

/** Builds <home>/bundles/<codeHash> when missing (bundle.lock; build into a temp dir, then rename). */
export async function ensureBundleBuilt(o: BundleOptions): Promise<{ serveUrl: string; codeHash: string; built: boolean }> {
  const { config, logger, signal } = o;
  const codeHash = o.codeHash ?? (await computeCodeHash(config.repoRoot));
  const outDir = bundleDir(config, codeHash);
  if (isBundleReady(config, codeHash)) return { serveUrl: outDir, codeHash, built: false };
  const entryPoint = path.join(config.repoRoot, "packages/remotion/src/entry.ts");
  if (!existsSync(entryPoint)) throw new DocmakerError("UPSTREAM_MISSING", `Remotion entry not found: ${entryPoint}`);
  await mkdir(config.paths.bundles, { recursive: true });
  let built = false;
  await withFileLock(path.join(config.paths.locks, "bundle.lock"), `bundle:${process.pid}`, async () => {
    if (isBundleReady(config, codeHash)) return; // another process built it while we waited
    const tmpOut = `${outDir}.tmp-${process.pid}`;
    const publicDir = await mkdtemp(path.join(os.tmpdir(), "docmaker-public-"));
    await rm(tmpOut, { recursive: true, force: true });
    const t0 = Date.now();
    try {
      const { bundle } = await loadBundler();
      logger.info("bundling the Remotion entry", { codeHash: codeHash.slice(0, 12), caching: o.enableCaching });
      await bundle({
        entryPoint, outDir: tmpOut, enableCaching: o.enableCaching, publicDir,
        onProgress: (p: number) => o.onProgress?.(Math.max(0, Math.min(1, p / 100))),
      });
      if (signal.aborted) throw new DocmakerError("CANCELED", "bundle canceled");
      await rm(outDir, { recursive: true, force: true });
      await rename(tmpOut, outDir);
      built = true;
      logger.info("bundle ready", { codeHash: codeHash.slice(0, 12), ms: Date.now() - t0 });
    } catch (e) {
      await rm(tmpOut, { recursive: true, force: true });
      if (e instanceof DocmakerError) throw e;
      throw new DocmakerError("RENDER_FAILED", `Remotion bundle failed: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
    } finally {
      await rm(publicDir, { recursive: true, force: true });
    }
    await pruneBundles(config, codeHash).catch(() => undefined);
  }, { signal, onWait: () => logger.info("waiting for the bundle lock") });
  return { serveUrl: outDir, codeHash, built };
}

/** Keeps the newest KEEP_BUNDLES bundles (always keeps `keep`); stale temp dirs of dead builds are removed too. */
async function pruneBundles(config: RuntimeConfig, keep: string): Promise<void> {
  const root = config.paths.bundles;
  const entries = await readdir(root, { withFileTypes: true });
  const dirs: { name: string; mtime: number }[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const full = path.join(root, e.name);
    const tmp = /\.tmp-(\d+)$/.exec(e.name);
    if (tmp) {
      let alive = false;
      try {
        process.kill(Number(tmp[1]), 0);
        alive = true;
      } catch (err) {
        alive = (err as NodeJS.ErrnoException).code === "EPERM";
      }
      if (!alive) await rm(full, { recursive: true, force: true });
      continue;
    }
    if (!/^[0-9a-f]{64}$/.test(e.name)) continue;
    dirs.push({ name: e.name, mtime: (await stat(full)).mtimeMs });
  }
  dirs.sort((a, b) => b.mtime - a.mtime);
  let kept = 0;
  for (const d of dirs) {
    if (d.name === keep || kept < KEEP_BUNDLES - 1) {
      if (d.name !== keep) kept++;
      continue;
    }
    await rm(path.join(root, d.name), { recursive: true, force: true });
  }
}
