// CLI context: global options → environment overrides, lazy engine (in-process, InProcessRenderClient), output helpers.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";
import { DocmakerError, type Logger } from "@docmaker/core";
import { createLogger, loadRuntime } from "@docmaker/core/node";
import type { EngineExt } from "@docmaker/engine";

export interface Io {
  out(s: string): void;
  err(s: string): void;
  readonly isTTY: boolean;
  /** Asks a question on the terminal (only called when isTTY). */
  ask(question: string, o?: { hidden?: boolean }): Promise<string>;
}

export const processIo: Io = {
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  get isTTY() {
    return !!process.stdin.isTTY && !!process.stdout.isTTY;
  },
  async ask(question, o) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    try {
      if (o?.hidden) {
        const w = (rl as unknown as { _writeToOutput?: (s: string) => void });
        const orig = w._writeToOutput;
        w._writeToOutput = (s: string) => {
          if (s.startsWith(question)) orig?.call(rl, s);
        };
        const a = await rl.question(question);
        process.stdout.write("\n");
        return a;
      }
      return await rl.question(question);
    } finally {
      rl.close();
    }
  },
};

export interface GlobalOpts {
  projectsDir?: string; home?: string; logLevel?: string; json?: boolean; yes?: boolean; maxCost?: string; force?: boolean; newRequest?: boolean;
  forceOverwriteEdits?: boolean;
}

/** The repository this CLI file belongs to (used when the working directory is outside any checkout). */
export const CLI_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function hasWorkspaceAbove(dir: string): boolean {
  let d = path.resolve(dir);
  for (;;) {
    if (existsSync(path.join(d, "pnpm-workspace.yaml"))) return true;
    const p = path.dirname(d);
    if (p === d) return false;
    d = p;
  }
}

/** Thrown for bad command-line usage → exit code 2. */
export class UsageError extends Error {}

export interface CliContext {
  io: Io;
  globals(): GlobalOpts;
  env(): NodeJS.ProcessEnv;
  engine(): Promise<EngineExt>;
  close(): Promise<void>;
}

export type EngineFactory = (o: { env: NodeJS.ProcessEnv; cwd: string; logger: Logger }) => Promise<EngineExt>;

/** Real engine: in-process runner + InProcessRenderClient (the CLI is where @docmaker/render is wired in). */
export const realEngineFactory: EngineFactory = async ({ env, cwd, logger }) => {
  const { config } = loadRuntime({ cwd, env });
  const [{ createEngineImpl }, { InProcessRenderClient }] = await Promise.all([import("@docmaker/engine"), import("@docmaker/render")]);
  return createEngineImpl({ cwd, env, logger, renderClient: new InProcessRenderClient({ config, logger }) });
};

export function makeContext(o: { io: Io; globals: () => GlobalOpts; factory: EngineFactory; cwd?: string; baseEnv?: NodeJS.ProcessEnv }): CliContext {
  let engine: Promise<EngineExt> | null = null;
  const env = (): NodeJS.ProcessEnv => {
    const g = o.globals();
    const e: NodeJS.ProcessEnv = { ...(o.baseEnv ?? process.env) };
    if (g.home) e.DOCMAKER_HOME = path.resolve(g.home);
    if (g.projectsDir) e.DOCMAKER_PROJECTS = path.resolve(g.projectsDir);
    if (!e.DOCMAKER_REPO_ROOT && !hasWorkspaceAbove(o.cwd ?? process.cwd())) e.DOCMAKER_REPO_ROOT = CLI_REPO_ROOT;
    if (g.logLevel) {
      if (!["debug", "info", "warn", "error"].includes(g.logLevel)) throw new UsageError(`--log-level must be debug|info|warn|error`);
      e.DOCMAKER_LOG_LEVEL = g.logLevel;
    }
    return e;
  };
  return {
    io: o.io,
    globals: o.globals,
    env,
    engine() {
      if (!engine) {
        const e = env();
        const level = (e.DOCMAKER_LOG_LEVEL as "debug" | "info" | "warn" | "error" | undefined) ?? "warn";
        const logger = createLogger({ level, sink: (line) => o.io.err(line.endsWith("\n") ? line : line + "\n") });
        engine = o.factory({ env: e, cwd: o.cwd ?? process.cwd(), logger });
      }
      return engine;
    },
    async close() {
      if (engine) await (await engine).close();
    },
  };
}

export function parseMaxCost(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new UsageError(`--max-cost must be a non-negative number of USD (got ${v})`);
  return n;
}

export function splitList(v: string | undefined): string[] {
  return (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
}

export function exitCodeOf(e: unknown): number {
  if (e instanceof UsageError) return 2;
  if (e instanceof DocmakerError && e.code === "CANCELED") return 4;
  if (e instanceof DocmakerError && e.code === "GATE_REQUIRED") return 3;
  return 1;
}
