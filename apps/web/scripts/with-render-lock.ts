// Runs a shell command under the machine-wide render lock (apps/web builds and Playwright runs; SPEC §0.4 rule 4).
import { spawn } from "node:child_process";
import { loadRuntime, withFileLock } from "@docmaker/core/node";
const cmd = process.argv.slice(2).join(" ");
const { config } = loadRuntime({ cwd: process.cwd() });
await withFileLock(config.renderLockFile, `w11-build:${process.pid}`, () => new Promise<void>((resolve, reject) => {
  const p = spawn("bash", ["-lc", cmd], { stdio: "inherit" });
  p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
}), { signal: new AbortController().signal, onWait: () => console.error("waiting for render lock…") });
