import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cacheCapBytes, ensureHome, freeDiskBytes, loadRuntime, readBrowserDoc, readHomeConfig, withFileLock, writeHomeConfig } from "../src/node/index";

describe("withFileLock", () => {
  it("serialises critical sections and releases the lock", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "docmaker-lock-"));
    const lock = path.join(dir, "render.lock");
    const signal = new AbortController().signal;
    const order: string[] = [];
    let waited = 0;
    const job = (name: string) => withFileLock(lock, name, async () => {
      order.push(`${name}:in`);
      await new Promise((r) => setTimeout(r, 120));
      order.push(`${name}:out`);
      return name;
    }, { signal, pollMs: 20, onWait: () => waited++ });
    expect(await Promise.all([job("a"), job("b")])).toEqual(["a", "b"]);
    // either may win the race, but sections never interleave
    expect([["a:in", "a:out", "b:in", "b:out"], ["b:in", "b:out", "a:in", "a:out"]]).toContainEqual(order);
    expect(waited).toBe(1);
    await expect(readFile(lock)).rejects.toThrow();
  });
  it("takes over a lock held by a dead pid and honours abort while waiting", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "docmaker-lock-"));
    const lock = path.join(dir, "render.lock");
    await writeFile(lock, JSON.stringify({ pid: 2 ** 22 + 999, owner: "dead", at: "2026-01-01T00:00:00Z" }));
    expect(await withFileLock(lock, "me", async () => "ok", { signal: new AbortController().signal })).toBe("ok");
    await writeFile(lock, JSON.stringify({ pid: process.pid, owner: "me", at: "2026-01-01T00:00:00Z" }));
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    await expect(withFileLock(lock, "other", async () => "no", { signal: ac.signal, pollMs: 20 })).rejects.toMatchObject({ code: "CANCELED" });
  });
});

describe("home", () => {
  it("creates the home layout and round-trips HomeConfig", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "docmaker-home-"));
    const { config } = loadRuntime({ cwd: process.cwd(), env: { DOCMAKER_HOME: path.join(root, "h") } });
    await ensureHome(config);
    expect((await readHomeConfig(config)).uiLang).toBe("auto");
    const c = await writeHomeConfig(config, { contact: "me@example.org", onboardingDone: true });
    expect(c.contact).toBe("me@example.org");
    expect((await readHomeConfig(config)).onboardingDone).toBe(true);
    expect(await readBrowserDoc(config)).toBeNull();
    expect(await freeDiskBytes(root)).toBeGreaterThan(0);
    const cap = await cacheCapBytes(config);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThanOrEqual(20 * 1024 ** 3);
  });
});
