// FrozenCache: content-addressed blobs under <home>/cache/blobs/<aa>/<sha256>.<ext>, an LRU index (CacheIndex) and
// hardlinks into projects (copy fallback). Blobs referenced by any project's frozen.json are never evicted (§7.5).
import { copyFile, link, mkdir, readdir, readFile, rename, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import { CacheIndex, DocmakerError, P } from "@docmaker/core";
import type { Logger, RuntimeConfig } from "@docmaker/core";
import { cacheCapBytes, sha256File, withFileLock } from "@docmaker/core/node";
import { NEVER_ABORT, nowIso, writeFileAtomic } from "./util";

type Entry = CacheIndex["blobs"][number];

export class FrozenCache {
  readonly config: RuntimeConfig;
  readonly logger: Logger;
  constructor(o: { config: RuntimeConfig; logger: Logger }) {
    this.config = o.config;
    this.logger = o.logger;
  }

  get indexFile(): string {
    return path.join(this.config.paths.cache, "index.json");
  }
  private get lockFile(): string {
    return path.join(this.config.paths.locks, "cache-index.lock");
  }
  blobRel(sha256: string, ext: string): string {
    return `blobs/${sha256.slice(0, 2)}/${sha256}.${ext}`;
  }
  blobPath(sha256: string, ext: string): string {
    return path.join(this.config.paths.cache, this.blobRel(sha256, ext));
  }

  async readIndex(): Promise<CacheIndex> {
    try {
      const parsed = CacheIndex.safeParse(JSON.parse(await readFile(this.indexFile, "utf8")));
      if (parsed.success) return parsed.data;
      this.logger.warn("cache index is invalid; rebuilding", { file: this.indexFile });
    } catch { /* missing */ }
    return { schemaVersion: 1, blobs: [] };
  }

  private async mutateIndex<T>(fn: (ix: CacheIndex) => Promise<T> | T): Promise<T> {
    return withFileLock(this.lockFile, "assets-cache", async () => {
      const ix = await this.readIndex();
      const r = await fn(ix);
      ix.blobs.sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : a.ext < b.ext ? -1 : 1));
      await writeFileAtomic(this.indexFile, JSON.stringify(ix));
      return r;
    }, { signal: NEVER_ABORT, pollMs: 50 });
  }

  /** Stores a copy of `file` (content-addressed). Idempotent; refreshes lastUsed. */
  async put(file: string, ext: string): Promise<{ sha256: string; cacheRel: string; bytes: number }> {
    if (!/^[a-z0-9]{2,5}$/.test(ext)) throw new DocmakerError("VALIDATION", `invalid extension ${ext}`);
    const sha256 = await sha256File(file);
    const dest = this.blobPath(sha256, ext);
    const { size } = await stat(file);
    let exists = false;
    try {
      exists = (await stat(dest)).size === size;
    } catch { /* new blob */ }
    if (!exists) {
      await mkdir(path.dirname(dest), { recursive: true });
      const tmp = `${dest}.tmp-${process.pid}`;
      await copyFile(file, tmp);
      await rename(tmp, dest);
    }
    await this.mutateIndex((ix) => {
      const e = ix.blobs.find((b) => b.sha256 === sha256 && b.ext === ext);
      if (e) {
        e.lastUsed = nowIso();
        e.bytes = size;
      } else ix.blobs.push({ sha256, ext, bytes: size, lastUsed: nowIso() });
    });
    return { sha256, cacheRel: this.blobRel(sha256, ext), bytes: size };
  }

  async has(sha256: string): Promise<boolean> {
    const ix = await this.readIndex();
    for (const e of ix.blobs.filter((b) => b.sha256 === sha256)) {
      try {
        await stat(this.blobPath(sha256, e.ext));
        return true;
      } catch { /* listed but gone */ }
    }
    return false;
  }

  /** Hardlinks the blob to <projectDir>/media/<sha256>.<ext> (copy when hardlinks fail). Returns the project-relative path. */
  async linkIntoProject(sha256: string, ext: string, projectDir: string): Promise<string> {
    const rel = P.media(sha256, ext);
    const src = this.blobPath(sha256, ext);
    const dest = path.join(projectDir, rel);
    try {
      await stat(src);
    } catch {
      throw new DocmakerError("UPSTREAM_MISSING", `cache blob ${sha256.slice(0, 12)}.${ext} is missing`);
    }
    try {
      const d = await stat(dest);
      const s = await stat(src);
      if (d.size === s.size) {
        await this.touch(sha256, ext);
        return rel;
      }
      await rm(dest, { force: true });
    } catch { /* not linked yet */ }
    await mkdir(path.dirname(dest), { recursive: true });
    try {
      await link(src, dest);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "EEXIST") return rel;
      const tmp = `${dest}.tmp-${process.pid}`;
      await copyFile(src, tmp);
      await rename(tmp, dest);
    }
    await this.touch(sha256, ext);
    return rel;
  }

  private async touch(sha256: string, ext: string): Promise<void> {
    await this.mutateIndex((ix) => {
      const e = ix.blobs.find((b) => b.sha256 === sha256 && b.ext === ext);
      if (e) e.lastUsed = nowIso();
    });
    const now = new Date();
    await utimes(this.blobPath(sha256, ext), now, now).catch(() => undefined);
  }

  /** LRU eviction down to capBytes; referenced blobs are never removed. Also drops index entries whose file vanished. */
  async gc(o: { referenced: ReadonlySet<string>; capBytes: number }): Promise<{ freedBytes: number; removed: number }> {
    return this.mutateIndex(async (ix) => {
      const alive: Entry[] = [];
      for (const e of ix.blobs) {
        try {
          await stat(this.blobPath(e.sha256, e.ext));
          alive.push(e);
        } catch { /* stale entry */ }
      }
      let total = alive.reduce((s, e) => s + e.bytes, 0);
      let freedBytes = 0;
      let removed = 0;
      const victims = alive.filter((e) => !o.referenced.has(e.sha256)).sort((a, b) => (a.lastUsed < b.lastUsed ? -1 : a.lastUsed > b.lastUsed ? 1 : 0));
      const gone = new Set<Entry>();
      for (const v of victims) {
        if (total <= o.capBytes) break;
        await rm(this.blobPath(v.sha256, v.ext), { force: true });
        gone.add(v);
        total -= v.bytes;
        freedBytes += v.bytes;
        removed++;
      }
      ix.blobs = alive.filter((e) => !gone.has(e));
      if (removed > 0) this.logger.info("cache gc", { removed, freedBytes });
      return { freedBytes, removed };
    });
  }

  /** gc with cacheCapBytes() and every blob referenced by any project's frozen.json under projectsDir. */
  async enforceCap(extraReferenced: Iterable<string> = []): Promise<{ freedBytes: number; removed: number }> {
    const referenced = await collectReferencedBlobs(this.config.projectsDir);
    for (const x of extraReferenced) referenced.add(x);
    return this.gc({ referenced, capBytes: await cacheCapBytes(this.config) });
  }
}

/** sha256 ids of every asset in <projectsDir>/<slug>/assets/frozen.json (+ media files present in each project). */
export async function collectReferencedBlobs(projectsDir: string): Promise<Set<string>> {
  const out = new Set<string>();
  let slugs: string[] = [];
  try {
    slugs = await readdir(projectsDir);
  } catch {
    return out;
  }
  for (const slug of slugs) {
    try {
      const j = JSON.parse(await readFile(path.join(projectsDir, slug, P.frozen), "utf8")) as { assets?: Record<string, unknown> };
      for (const id of Object.keys(j.assets ?? {})) out.add(id);
    } catch { /* no frozen doc */ }
    try {
      for (const f of await readdir(path.join(projectsDir, slug, "media"))) {
        const m = /^([a-f0-9]{64})\./.exec(f);
        if (m) out.add(m[1]!);
      }
    } catch { /* no media */ }
  }
  return out;
}
