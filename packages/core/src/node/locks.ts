// packages/core/src/node/locks.ts — machine-wide advisory locks (render slot, bundle build, model downloads).
import { mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { DocmakerError } from "../util/errors";
import { pidAlive, sleep } from "./fsutil";

interface LockBody { pid: number; owner: string; at: string; jobId?: string }

async function readLock(p: string): Promise<{ raw: string; body: LockBody | null } | null> {
  let raw: string;
  try {
    raw = await readFile(p, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  try {
    return { raw, body: JSON.parse(raw) as LockBody };
  } catch {
    return { raw, body: null };
  }
}

/**
 * O_EXCL lock file {pid, owner, at[, jobId]}. A lock whose pid is dead is taken over; a live one →
 * returns "held" with its body. Internal building block for withFileLock and ProjectStore.lock.
 */
export async function tryAcquireLock(p: string, body: LockBody): Promise<{ ok: true; raw: string } | { ok: false; holder: LockBody | null }> {
  await mkdir(path.dirname(p), { recursive: true });
  const raw = JSON.stringify(body);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fh = await open(p, "wx");
      try {
        await fh.writeFile(raw);
      } finally {
        await fh.close();
      }
      return { ok: true, raw };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    const cur = await readLock(p);
    if (cur === null) continue; // released in between
    const stale = cur.body === null
      ? Date.now() - (await stat(p).then((st) => st.mtimeMs).catch(() => Date.now())) > 30_000 // unreadable body: stale after 30 s
      : !pidAlive(cur.body.pid);
    if (!stale) return { ok: false, holder: cur.body };
    // stale: remove only if unchanged since we read it, then retry
    const again = await readLock(p);
    if (again && again.raw === cur.raw) await unlink(p).catch(() => undefined);
  }
  const cur = await readLock(p);
  return { ok: false, holder: cur?.body ?? null };
}

export async function releaseLock(p: string, raw: string): Promise<void> {
  const cur = await readLock(p);
  if (cur && cur.raw === raw) await unlink(p).catch(() => undefined);
}

/** Exclusive advisory lock around fn; waits (polling) while another live process holds it; abort → CANCELED. */
export async function withFileLock<T>(lockPath: string, owner: string, fn: () => Promise<T>, opts: { signal: AbortSignal; pollMs?: number; onWait?: () => void }): Promise<T> {
  let warned = false;
  let raw: string | null = null;
  for (;;) {
    if (opts.signal.aborted) throw new DocmakerError("CANCELED", `canceled while waiting for ${lockPath}`);
    const r = await tryAcquireLock(lockPath, { pid: process.pid, owner, at: new Date().toISOString() });
    if (r.ok) { raw = r.raw; break; }
    if (!warned) { warned = true; opts.onWait?.(); }
    try {
      await sleep(opts.pollMs ?? 500, opts.signal);
    } catch {
      throw new DocmakerError("CANCELED", `canceled while waiting for ${lockPath}`);
    }
  }
  try {
    return await fn();
  } finally {
    await releaseLock(lockPath, raw);
  }
}
