// apps/cli/src/main.ts — `docmaker` CLI (§15). commander; the engine runs in-process with an InProcessRenderClient.
// Exit codes: 0 ok · 1 error · 2 usage · 3 waiting for approval (gate) · 4 canceled.
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command, CommanderError } from "commander";
import { isDocmakerError } from "@docmaker/core";
import { exitCodeOf, makeContext, processIo, realEngineFactory, type CliContext, type EngineFactory, type GlobalOpts, type Io } from "./context";
import { registerCore } from "./commands/core";
import { registerProject } from "./commands/project";
import { registerMisc } from "./commands/misc";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
export const VERSION: string = pkg.version;

export function buildProgram(o: { io?: Io; factory?: EngineFactory; cwd?: string; baseEnv?: NodeJS.ProcessEnv } = {}): { program: Command; ctx: CliContext } {
  const io = o.io ?? processIo;
  const program = new Command();
  const ctx = makeContext({ io, globals: () => program.opts<GlobalOpts>(), factory: o.factory ?? realEngineFactory, cwd: o.cwd, baseEnv: o.baseEnv });
  program
    .name("docmaker")
    .description("DocumentaryMaker — long-form narrated documentaries from an idea (offline-first).")
    .version(VERSION, "-v, --version", "print the version")
    .option("--projects-dir <dir>", "projects directory (DOCMAKER_PROJECTS)")
    .option("--home <dir>", "DocumentaryMaker home (DOCMAKER_HOME)")
    .option("--log-level <lvl>", "debug | info | warn | error")
    .option("--json", "NDJSON job events / JSON output")
    .option("-y, --yes", "approve COST and style-confirm gates (never editorial gates)")
    .option("--max-cost <usd>", "approve the cost gate when the estimate is at most this amount")
    .option("--force", "re-run stages even when up to date")
    .option("--new-request", "bypass paid-call receipts once")
    .option("--force-overwrite-edits", "allow regenerating user-edited or locked chapters")
    .showHelpAfterError("(docmaker --help for usage)")
    .configureOutput({ writeOut: (s) => io.out(s), writeErr: (s) => io.err(s) })
    .exitOverride();
  registerCore(program, ctx);
  registerProject(program, ctx);
  registerMisc(program, ctx);
  for (const c of program.commands) c.exitOverride().configureOutput({ writeOut: (s) => io.out(s), writeErr: (s) => io.err(s) });
  return { program, ctx };
}

/** Parses and runs; returns the process exit code (never calls process.exit). */
export async function runCli(argv: string[], o: { io?: Io; factory?: EngineFactory; cwd?: string; baseEnv?: NodeJS.ProcessEnv } = {}): Promise<number> {
  const io = o.io ?? processIo;
  if (argv.length <= 2) {
    io.out(`docmaker ${VERSION}\n(docmaker --help for the commands)\n`);
    return 0;
  }
  const { program, ctx } = buildProgram(o);
  const prev = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync(argv);
    const code = typeof process.exitCode === "number" ? process.exitCode : 0;
    return code;
  } catch (e) {
    if (e instanceof CommanderError) {
      if (e.code === "commander.helpDisplayed" || e.code === "commander.version" || e.code === "commander.help") return 0;
      return 2;
    }
    const code = exitCodeOf(e);
    if (isDocmakerError(e)) io.err(`error ${e.code}: ${e.message}${e.hint ? `\n  hint: ${e.hint}` : ""}\n`);
    else io.err(`${code === 2 ? "usage" : "error"}: ${e instanceof Error ? e.message : String(e)}\n`);
    return code;
  } finally {
    process.exitCode = prev;
    await ctx.close().catch(() => undefined);
  }
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
if (isMainModule()) process.exit(await runCli(process.argv));
