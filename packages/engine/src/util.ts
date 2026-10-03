// Small engine helpers (no package logic here).
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile, stat, readdir } from "node:fs/promises";
import path from "node:path";
import { DocmakerError, isDocmakerError, type ErrorCode, type JobOptions, type Lang, type Logger, type Project } from "@docmaker/core";

export const nowIso = (): string => new Date().toISOString();

const pad2 = (n: number) => String(n).padStart(2, "0");
/** "job-<yyyymmdd-hhmmss>-<rand6>" (UTC). */
export function newJobId(d = new Date()): string {
  const stamp = `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}-${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}`;
  return `job-${stamp}-${randomBytes(3).toString("hex")}`;
}
export const JOB_ID_RE = /^job-\d{8}-\d{6}-[a-f0-9]{6}$/;

/** Project languages (or the requested subset), primary language first, de-duplicated. */
export function orderLangs(project: Pick<Project, "languages" | "primaryLang">, requested: readonly Lang[] | null | undefined): Lang[] {
  const base = requested && requested.length > 0 ? requested.filter((l) => project.languages.includes(l)) : project.languages;
  const uniq = [...new Set(base)];
  return uniq.sort((a, b) => (a === project.primaryLang ? -1 : b === project.primaryLang ? 1 : project.languages.indexOf(a) - project.languages.indexOf(b)));
}

/** Only the option keys a stage declares (undefined values dropped so absent ≡ undefined). */
export function pickOptions(options: JobOptions, keys: readonly (keyof JobOptions)[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of [...keys].sort()) if (options[k] !== undefined) out[k] = options[k];
  return out;
}

export const silentLogger: Logger = {
  debug() {}, info() {}, warn() {}, error() {},
  child() {
    return silentLogger;
  },
};

/** Atomic text write that skips identical content; returns whether the file changed. */
export async function writeTextIfChanged(abs: string, text: string | Uint8Array): Promise<boolean> {
  const next = typeof text === "string" ? Buffer.from(text, "utf8") : Buffer.from(text);
  try {
    const cur = await readFile(abs);
    if (cur.equals(next)) return false;
  } catch { /* missing */ }
  await mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp-${process.pid}-${randomBytes(3).toString("hex")}`;
  await writeFile(tmp, next);
  await rename(tmp, abs);
  return true;
}

export async function fileExists(abs: string): Promise<boolean> {
  try {
    await stat(abs);
    return true;
  } catch {
    return false;
  }
}

export async function readJsonFile<T = unknown>(abs: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(abs, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Recursive file list (project-relative, POSIX separators, sorted). */
export async function listFilesRec(rootAbs: string, relPrefix = ""): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(path.join(rootAbs, relPrefix), { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await listFilesRec(rootAbs, rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

/** Normalises anything thrown into {code, message, retryable, hint}. */
export function errorInfo(e: unknown): { code: ErrorCode; message: string; retryable: boolean; hint: string | null; details: unknown } {
  if (isDocmakerError(e)) return { code: e.code, message: e.message, retryable: e.retryable, hint: e.hint, details: e.details };
  if (e instanceof Error && e.name === "AbortError") return { code: "CANCELED", message: "canceled", retryable: false, hint: null, details: undefined };
  return { code: "INTERNAL", message: e instanceof Error ? e.message : String(e), retryable: false, hint: null, details: undefined };
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DocmakerError("CANCELED", "canceled");
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DocmakerError("CANCELED", "canceled"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DocmakerError("CANCELED", "canceled"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Small async mutex (FIFO). */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
export const daysBetween = (a: string, b: Date): number => {
  const t = Date.parse(a.length === 4 ? `${a}-01-01` : a.length === 7 ? `${a}-01` : a);
  return Number.isFinite(t) ? (b.getTime() - t) / 86_400_000 : Number.POSITIVE_INFINITY;
};
