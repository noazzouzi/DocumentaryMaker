// A fake Engine for route tests: only the methods a test provides exist; every other call throws "not implemented".
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Engine } from "@docmaker/engine";
import { DocmakerError, type RuntimeConfig } from "@docmaker/core";
import { setEngineForTests } from "../../src/server/runtime";

export async function tempProjects(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "docmaker-web-test-"));
}

export function fakeConfig(projectsDir: string): RuntimeConfig {
  return { projectsDir, repoRoot: "/repo" } as unknown as RuntimeConfig;
}

export function fakeEngine(impl: Partial<Engine> & { config?: RuntimeConfig }): Engine {
  const e = new Proxy(impl as Record<string, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      if (prop === "then") return undefined; // not a thenable
      return () => {
        throw new DocmakerError("INTERNAL", `not implemented: fake.${String(prop)}`);
      };
    },
  }) as unknown as Engine;
  setEngineForTests(e);
  return e;
}

export async function writeProjectFile(projectsDir: string, slug: string, rel: string, data: string | Uint8Array): Promise<string> {
  const abs = path.join(projectsDir, slug, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, data);
  return abs;
}

const HOST = "127.0.0.1:3210";
/** A same-origin browser-like request (Host + Origin + Sec-Fetch-Site). */
export function req(pathAndQuery: string, init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}): Request {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { host: HOST, "sec-fetch-site": "same-origin", ...(method !== "GET" && method !== "HEAD" ? { origin: `http://${HOST}` } : {}), ...init.headers };
  return new Request(`http://${HOST}${pathAndQuery}`, { ...init, method, headers });
}

export const params = <T extends Record<string, unknown>>(p: T) => ({ params: Promise.resolve(p) });
