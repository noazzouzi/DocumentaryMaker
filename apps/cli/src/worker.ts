// apps/cli/src/worker.ts — the job worker the web app forks (SPEC §5.5, §14.1): an in-process engine with an
// InProcessRenderClient, driven over IPC by the host engine (runner {kind:"worker"}).
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createLogger, loadRuntime } from "@docmaker/core/node";
import { runJobWorker } from "@docmaker/engine";
import { InProcessRenderClient } from "@docmaker/render";

export async function main(): Promise<void> {
  const { config, secrets } = loadRuntime({ cwd: process.cwd() });
  const logger = createLogger({ level: config.logLevel, secrets, sink: (line) => process.stderr.write(line.endsWith("\n") ? line : line + "\n") });
  await runJobWorker({ renderClient: new InProcessRenderClient({ config, logger }), cwd: config.repoRoot });
}

function isMainModule(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return realpathSync(arg) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
if (isMainModule()) {
  main().then(
    () => process.exit(0),
    (e: unknown) => {
      process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
      process.exit(1);
    },
  );
}
