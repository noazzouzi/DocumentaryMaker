#!/usr/bin/env -S node --disable-warning=UNDICI-EHPA
// docmaker CLI shim (SPEC §15). Runs apps/cli/src/main.ts from source through tsx, from any working directory
// (tsx is registered in-process from this file's location instead of `node --import tsx`, which resolves from cwd).
// When a proxy variable is set, re-exec once with NODE_USE_ENV_PROXY=1 so the built-in fetch of Node honours it
// (TLS verification is never disabled).
import { spawnSync } from "node:child_process";

const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
const hasProxy = PROXY_VARS.some((k) => (process.env[k] ?? "") !== "");

if (hasProxy && process.env.NODE_USE_ENV_PROXY !== "1") {
  const r = spawnSync(process.execPath, ["--disable-warning=UNDICI-EHPA", ...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, NODE_USE_ENV_PROXY: "1" },
  });
  if (r.error) throw r.error;
  process.exit(r.status ?? 1);
} else {
  // the built-in proxy agent is experimental on Node 22: silence only that warning (as --disable-warning does on re-exec)
  const emit = process.emitWarning.bind(process);
  process.emitWarning = (warning, ...rest) => {
    const code = typeof rest[0] === "object" && rest[0] !== null ? rest[0].code : rest[1];
    if (code === "UNDICI-EHPA" || (typeof warning === "string" && warning.includes("EnvHttpProxyAgent is experimental"))) return;
    emit(warning, ...rest);
  };
  const { register } = await import("tsx/esm/api");
  register();
  const { runCli } = await import(new URL("../src/main.ts", import.meta.url).href);
  const code = await runCli(process.argv);
  process.exitCode = code;
  // let stdout drain; force the exit if a stray handle keeps the loop alive
  setTimeout(() => process.exit(code), 3000).unref();
}
