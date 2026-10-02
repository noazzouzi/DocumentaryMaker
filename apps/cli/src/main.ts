// apps/cli/src/main.ts — `docmaker` CLI entry (P0 skeleton: prints the version; W10 adds every §15 command).
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
export const VERSION: string = pkg.version;

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("docmaker")
    .description("DocumentaryMaker — long-form narrated documentaries from an idea (offline-first).")
    .version(VERSION, "-v, --version", "print the version");
  return program;
}

/** Entry used by bin/docmaker.js and by `tsx apps/cli/src/main.ts`. */
export async function runCli(argv: string[]): Promise<void> {
  if (argv.length <= 2) {
    process.stdout.write(`docmaker ${VERSION}\n`);
    return;
  }
  await buildProgram().parseAsync(argv);
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
if (isMainModule()) await runCli(process.argv);
