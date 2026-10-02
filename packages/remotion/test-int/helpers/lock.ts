// Machine-wide render lock for test-int, protocol-compatible with @docmaker/core/node withFileLock (O_EXCL JSON
// {pid, owner, at}; a dead pid is taken over). Re-implemented here because @docmaker/remotion may not depend on
// @docmaker/core/node, not even in tests (scripts/check-deps-graph.mjs).
import { readFileSync } from "node:fs";
import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

export const RENDER_LOCK = process.env.DOCMAKER_RENDER_LOCK || "/tmp/docmaker-render.lock";

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
  try {
    // zombies (container PID 1 does not reap) count as dead
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.split(" ")[2] !== "Z";
  } catch {
    return true;
  }
}

async function tryAcquire(p: string, raw: string): Promise<boolean> {
  await mkdir(path.dirname(p), { recursive: true });
  try {
    const fh = await open(p, "wx");
    await fh.writeFile(raw);
    await fh.close();
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  let cur: string;
  try {
    cur = await readFile(p, "utf8");
  } catch {
    return false;
  }
  try {
    const body = JSON.parse(cur) as { pid?: number };
    if (typeof body.pid === "number" && !pidAlive(body.pid)) {
      const again = await readFile(p, "utf8").catch(() => null);
      if (again === cur) await unlink(p).catch(() => undefined);
    }
  } catch {
    /* unreadable body: leave it, the owner will release it */
  }
  return false;
}

export async function withRenderLock<T>(owner: string, fn: () => Promise<T>, onWait?: () => void): Promise<T> {
  const raw = JSON.stringify({ pid: process.pid, owner, at: new Date().toISOString() });
  let warned = false;
  while (!(await tryAcquire(RENDER_LOCK, raw))) {
    if (!warned) {
      warned = true;
      onWait?.();
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    return await fn();
  } finally {
    const cur = await readFile(RENDER_LOCK, "utf8").catch(() => null);
    if (cur === raw) await unlink(RENDER_LOCK).catch(() => undefined);
  }
}

/** Acquires the render lock and returns its release function (for beforeAll/afterAll scoping). */
export async function acquireRenderLock(owner: string, onWait?: () => void): Promise<() => Promise<void>> {
  const raw = JSON.stringify({ pid: process.pid, owner, at: new Date().toISOString() });
  let warned = false;
  while (!(await tryAcquire(RENDER_LOCK, raw))) {
    if (!warned) {
      warned = true;
      onWait?.();
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return async () => {
    const cur = await readFile(RENDER_LOCK, "utf8").catch(() => null);
    if (cur === raw) await unlink(RENDER_LOCK).catch(() => undefined);
  };
}
