// apps/cli/src/worker.ts — the job worker the web app forks (SPEC §5.5, §14.1). P0 stub: W10 wires
// runJobWorker({ renderClient: new InProcessRenderClient({ config, logger }), cwd: repoRoot }).
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DocmakerError } from "@docmaker/core";

export async function main(): Promise<void> {
  throw new DocmakerError("INTERNAL", "not implemented: cli.worker", { hint: "the job worker lands with W10" });
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
  main().catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}
