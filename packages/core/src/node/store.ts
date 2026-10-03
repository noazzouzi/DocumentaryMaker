// packages/core/src/node/store.ts — ProjectStore: validated, atomic, ownership-checked, history-keeping JSON persistence.
import { link, copyFile, mkdir, readdir, readFile, appendFile, rm, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { Lang } from "../schema/common";
import { Project } from "../schema/project";
import { P, docEntryFor, type DocRegistryEntry } from "../util/paths";
import { stableStringify } from "../util/json";
import { docHash } from "../util/sha256";
import { migrateDoc } from "../util/migrate";
import { DocmakerError } from "../util/errors";
import { atomicWrite } from "./fsutil";
import { sha256Bytes } from "./hash";
import { releaseLock, tryAcquireLock, withFileLock } from "./locks";

export interface StoreWriteOptions {
  ifMatch?: string | null; // optimistic concurrency on BYTE etags → CONFLICT on mismatch (null = must not exist)
  writer: "stage" | "user" | "engine"; // ownership check against DOC_REGISTRY.owner (stages may only write their own docs)
  stage?: string; // the writing stage id when writer = "stage"
}

const HISTORY_KEEP = 20;
const WRITE_LOCK_TIMEOUT_MS = 30_000;
const WRITE_LOCK_POLL_MS = 15;

/** In-process FIFO mutex per document path (the file lock below covers other processes: web ↔ job worker). */
const inProcess = new Map<string, Promise<void>>();
async function withPathMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = inProcess.get(key) ?? Promise.resolve();
  let done!: () => void;
  const mine = new Promise<void>((r) => { done = r; });
  const tail = prev.then(() => mine);
  inProcess.set(key, tail);
  await prev;
  try {
    return await fn();
  } finally {
    done();
    if (inProcess.get(key) === tail) inProcess.delete(key);
  }
}
const isoForFile = (d: Date) => d.toISOString().replace(/:/g, "-");
const isoFromFile = (s: string) => s.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2}(?:\.\d+)?Z)$/, "$1:$2:$3");

function zodIssues(e: unknown): unknown {
  return (e as { issues?: unknown }).issues ?? String(e);
}

function checkOwner(rel: string, entry: DocRegistryEntry | null, o: StoreWriteOptions): void {
  if (!entry) return;
  const ok =
    o.writer === "stage" ? entry.owner === o.stage :
    o.writer === "user" ? entry.userEditable || entry.owner === "user" :
    entry.owner === "engine";
  if (!ok) {
    const who = o.writer === "stage" ? `stage ${o.stage ?? "?"}` : o.writer;
    throw new DocmakerError("VALIDATION", `${who} may not write ${rel} (owner: ${entry.owner})`);
  }
}

export class ProjectStore {
  readonly dir: string;
  readonly slug: string;

  private constructor(dir: string, slug: string) {
    this.dir = dir;
    this.slug = slug;
  }

  static async create(projectsDir: string, project: unknown): Promise<ProjectStore> {
    const p = Project.parse(project);
    const dir = path.resolve(projectsDir, p.slug);
    try {
      await stat(path.join(dir, P.project));
      throw new DocmakerError("VALIDATION", `project ${p.slug} already exists`);
    } catch (e) {
      if (e instanceof DocmakerError) throw e;
    }
    await mkdir(dir, { recursive: true });
    const s = new ProjectStore(dir, p.slug);
    await s.writeJson(P.project, Project, p, { writer: "engine", ifMatch: null });
    return s;
  }

  static async open(projectsDir: string, slug: string): Promise<ProjectStore> {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new DocmakerError("VALIDATION", `invalid project slug "${slug}"`);
    const dir = path.resolve(projectsDir, slug);
    let raw: string;
    try {
      raw = await readFile(path.join(dir, P.project), "utf8");
    } catch {
      throw new DocmakerError("UPSTREAM_MISSING", `project ${slug} not found in ${projectsDir}`);
    }
    const fv = (JSON.parse(raw) as { formatVersion?: unknown }).formatVersion;
    if (fv !== 1) throw new DocmakerError("MIGRATION_FAILED", `project ${slug}: unsupported formatVersion ${String(fv)}`);
    return new ProjectStore(dir, slug);
  }

  /** path.resolve + traversal guard (must stay inside dir). */
  abs(rel: string): string {
    const a = path.resolve(this.dir, rel);
    if (a !== this.dir && !a.startsWith(this.dir + path.sep)) throw new DocmakerError("VALIDATION", `path escapes the project: ${rel}`);
    return a;
  }

  async exists(rel: string): Promise<boolean> {
    try {
      await stat(this.abs(rel));
      return true;
    } catch {
      return false;
    }
  }

  private async readRaw(rel: string): Promise<{ bytes: Buffer; value: unknown } | null> {
    let bytes: Buffer;
    try {
      bytes = await readFile(this.abs(rel));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString("utf8"));
    } catch (e) {
      throw new DocmakerError("VALIDATION", `${rel} is not valid JSON`, { cause: e });
    }
    const entry = docEntryFor(rel);
    return { bytes, value: entry ? migrateDoc(entry.kind, raw).value : raw };
  }

  /** Reads, runs migrateDoc(kind) when DOC_REGISTRY knows the path, then schema.parse. Never writes back implicitly. */
  async readJson<S extends z.ZodType>(rel: string, schema: S): Promise<z.infer<S>> {
    const r = await this.readRaw(rel);
    if (!r) throw new DocmakerError("UPSTREAM_MISSING", `${rel} does not exist`);
    const parsed = schema.safeParse(r.value);
    if (!parsed.success) throw new DocmakerError("VALIDATION", `${rel} does not match its schema`, { details: zodIssues(parsed.error) });
    return parsed.data;
  }

  async readJsonOrNull<S extends z.ZodType>(rel: string, schema: S): Promise<z.infer<S> | null> {
    if (!(await this.exists(rel))) return null;
    return this.readJson(rel, schema);
  }

  /**
   * validate → stableStringify(indent: entry.compact ? 0 : 2) → tmp + rename. SKIPS the write when docHash(new) === docHash(old)
   * (returns changed:false), so no-op re-runs never cascade. userEditable docs keep the previous version in .history/ (last 20).
   */
  async writeJson<S extends z.ZodType>(rel: string, schema: S, value: z.input<S>, opts: StoreWriteOptions): Promise<{ etag: string; docHash: string; changed: boolean }> {
    const abs = this.abs(rel);
    const entry = docEntryFor(rel);
    checkOwner(rel, entry, opts);
    const parsed = schema.safeParse(value);
    if (!parsed.success) throw new DocmakerError("VALIDATION", `${rel}: value does not match its schema`, { details: zodIssues(parsed.error) });
    const next = parsed.data;
    if (entry && entry.schema !== (schema as z.ZodType)) {
      const reg = entry.schema.safeParse(next);
      if (!reg.success) throw new DocmakerError("VALIDATION", `${rel}: value does not match the registered ${entry.kind} schema`, { details: zodIssues(reg.error) });
    }
    const nextHash = docHash(next);
    const lockPath = this.abs(P.writeLock(rel));
    // The read → ifMatch compare → history → write sequence must be atomic per document, or two writers holding the
    // same base etag both pass the check and the later rename silently drops the earlier edit.
    return withPathMutex(lockPath, async () => {
      try {
        return await withFileLock(lockPath, `store:${rel}`, () => this.writeLocked(rel, abs, entry, schema, next, nextHash, opts), {
          signal: AbortSignal.timeout(WRITE_LOCK_TIMEOUT_MS), pollMs: WRITE_LOCK_POLL_MS,
        });
      } catch (e) {
        if (e instanceof DocmakerError && e.code === "CANCELED") {
          throw new DocmakerError("LOCKED", `${rel} is being written by another process`, { retryable: true, hint: `stale lock? remove ${lockPath}` });
        }
        throw e;
      }
    });
  }

  private async writeLocked(rel: string, abs: string, entry: DocRegistryEntry | null, schema: z.ZodType, next: unknown, nextHash: string, opts: StoreWriteOptions): Promise<{ etag: string; docHash: string; changed: boolean }> {
    let old: { bytes: Buffer; value: unknown } | null = null;
    try {
      old = await this.readRaw(rel);
    } catch {
      old = null; // unreadable old file: overwrite
      if (opts.ifMatch === null) throw new DocmakerError("CONFLICT", `${rel} already exists`);
    }
    const oldEtag = old ? sha256Bytes(old.bytes) : (await this.exists(rel)) ? sha256Bytes(await readFile(abs)) : null;
    if (opts.ifMatch !== undefined) {
      if (opts.ifMatch === null ? oldEtag !== null : opts.ifMatch !== oldEtag) {
        throw new DocmakerError("CONFLICT", `${rel} changed since it was read`, { hint: "a user edit happened during the job; re-run", details: { expected: opts.ifMatch, actual: oldEtag } });
      }
    }
    if (old) {
      const op = schema.safeParse(old.value);
      const oldHash = docHash(op.success ? op.data : old.value);
      if (oldHash === nextHash && oldEtag) return { etag: oldEtag, docHash: nextHash, changed: false };
      if (entry?.userEditable && opts.writer === "user" && oldEtag) await this.pushHistory(rel, old.bytes, oldEtag);
    }
    const text = stableStringify(next, entry?.compact ? 0 : 2);
    await atomicWrite(abs, text);
    return { etag: sha256Bytes(text), docHash: nextHash, changed: true };
  }

  private async pushHistory(rel: string, bytes: Buffer, etag: string): Promise<void> {
    const dir = this.abs(P.history(rel));
    await mkdir(dir, { recursive: true });
    let name = `${isoForFile(new Date())}-${etag.slice(0, 8)}.json`;
    const existing = new Set(await readdir(dir));
    for (let n = 1; existing.has(name); n++) name = `${isoForFile(new Date())}-${etag.slice(0, 8)}-${n}.json`;
    await atomicWrite(path.join(dir, name), bytes);
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
    for (const f of files.slice(0, Math.max(0, files.length - HISTORY_KEEP))) await rm(path.join(dir, f), { force: true });
  }

  /** sha256 of the bytes (concurrency only). */
  async etag(rel: string): Promise<string | null> {
    try {
      return sha256Bytes(await readFile(this.abs(rel)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  /** docHash of the parsed doc (inputs hashing). */
  async docHashOf(rel: string): Promise<string | null> {
    const r = await this.readRaw(rel);
    if (!r) return null;
    const entry = docEntryFor(rel);
    if (entry) {
      const p = entry.schema.safeParse(r.value);
      if (p.success) return docHash(p.data);
    }
    return docHash(r.value);
  }

  async history(rel: string): Promise<{ file: string; at: string; etag: string }[]> {
    const relDir = P.history(rel);
    let files: string[];
    try {
      files = (await readdir(this.abs(relDir))).filter((f) => f.endsWith(".json"));
    } catch {
      return [];
    }
    const out: { file: string; at: string; etag: string }[] = [];
    for (const f of files.sort().reverse()) {
      const m = /^(.+Z)-([a-f0-9]{8})(?:-\d+)?\.json$/.exec(f);
      const bytes = await readFile(this.abs(relDir + f));
      out.push({ file: relDir + f, at: m ? isoFromFile(m[1]!) : "", etag: sha256Bytes(bytes) });
    }
    return out;
  }

  async revert(rel: string, historyFile: string): Promise<{ etag: string }> {
    const entry = docEntryFor(rel);
    if (!entry || !entry.userEditable) throw new DocmakerError("VALIDATION", `${rel} has no history`);
    const known = await this.history(rel);
    if (!known.some((h) => h.file === historyFile)) throw new DocmakerError("VALIDATION", `unknown history file ${historyFile}`);
    const raw = JSON.parse(await readFile(this.abs(historyFile), "utf8")) as unknown;
    const r = await this.writeJson(rel, entry.schema, migrateDoc(entry.kind, raw).value as never, { writer: "user" });
    return { etag: r.etag };
  }

  async appendNdjson(rel: string, obj: unknown): Promise<void> {
    const abs = this.abs(rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await appendFile(abs, JSON.stringify(obj) + "\n");
  }

  /** Hardlink, fallback copy. */
  async linkOrCopy(srcAbs: string, rel: string): Promise<void> {
    const dest = this.abs(rel);
    await mkdir(path.dirname(dest), { recursive: true });
    try {
      const [a, b] = await Promise.all([stat(srcAbs), stat(dest)]);
      if (a.ino === b.ino && a.dev === b.dev) return;
      await unlink(dest);
    } catch { /* dest missing */ }
    try {
      await link(srcAbs, dest);
    } catch {
      await copyFile(srcAbs, dest);
    }
  }

  /** Job lock: .lock {pid, owner, jobId, at} via O_EXCL; stale pid → take over; live → DocmakerError("LOCKED"). */
  async lock(owner: string, jobId: string): Promise<() => Promise<void>> {
    const p = this.abs(P.lock);
    const r = await tryAcquireLock(p, { pid: process.pid, owner, jobId, at: new Date().toISOString() });
    if (!r.ok) {
      throw new DocmakerError("LOCKED", `project ${this.slug} is locked by ${r.holder?.owner ?? "another process"}`, {
        retryable: true, details: r.holder, hint: r.holder?.jobId ? `job ${r.holder.jobId} is running` : undefined,
      });
    }
    const raw = r.raw;
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await releaseLock(p, raw);
    };
  }
}

/**
 * Files of one language in a directory (non-recursive, sorted absolute paths): names equal to the language
 * or starting with `<lang>.`, plus names containing `.<lang>.` (e.g. timeline/en.json, en.lint.json, credits.en.md).
 */
export async function listLangFiles(dir: string, lang: Lang): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && (e.name === lang || e.name.startsWith(`${lang}.`) || e.name.includes(`.${lang}.`)))
    .map((e) => path.join(dir, e.name))
    .sort();
}
