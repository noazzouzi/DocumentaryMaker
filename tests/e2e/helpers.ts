// Shared e2e harness (§16.4/§16.5): isolated home + projects, every provider key deleted, DOCMAKER_OFFLINE=1, and a
// "dead proxy" that counts connection attempts (HTTP(S)_PROXY point at it; NODE_USE_ENV_PROXY=1) — it must see nothing.
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENV_KEYS } from "@docmaker/core";

export const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
export const SHARED_CHROME = path.join(REPO_ROOT, "node_modules/.remotion/chrome-headless-shell/linux64/chrome-headless-shell-linux64/chrome-headless-shell");

export interface OfflineEnv {
  home: string;
  projects: string;
  env: NodeJS.ProcessEnv;
  proxyConnections(): number;
  restore(): Promise<void>;
}

export async function offlineEnv(tag: string): Promise<OfflineEnv> {
  const root = mkdtempSync(path.join(os.tmpdir(), `docmaker-e2e-${tag}-`));
  const home = path.join(root, "home");
  const projects = path.join(root, "projects");
  let connections = 0;
  const server = net.createServer((sock) => {
    connections++;
    sock.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  const saved = { ...process.env };
  for (const k of Object.values(ENV_KEYS)) delete process.env[k];
  const proxy = `http://127.0.0.1:${port}`;
  Object.assign(process.env, {
    DOCMAKER_HOME: home, DOCMAKER_PROJECTS: projects, DOCMAKER_OFFLINE: "1", HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy,
    NODE_USE_ENV_PROXY: "1", DOCMAKER_REPO_ROOT: REPO_ROOT, DOCMAKER_LOG_LEVEL: "warn",
    DOCMAKER_BROWSER_EXECUTABLE: process.env.DOCMAKER_BROWSER_EXECUTABLE ?? SHARED_CHROME,
  });
  delete process.env.NO_PROXY;
  delete process.env.no_proxy;
  return {
    home, projects, env: process.env, proxyConnections: () => connections,
    async restore() {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (!process.env.DOCMAKER_KEEP_E2E) rmSync(root, { recursive: true, force: true });
    },
  };
}
