// Operational commands (§15.1): jobs, cost, credits, keys, cache gc.
import { readFileSync } from "node:fs";
import type { Command } from "commander";
import { ENV_KEYS, type Lang } from "@docmaker/core";
import { maskSecret } from "@docmaker/core/node";
import { UsageError, type CliContext } from "../context";
import { EXIT } from "../jobrun";
import { parseLangs } from "./core";

type Opts = Record<string, string | boolean | undefined>;
const fmtBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GiB` : `${(n / 1024 ** 2).toFixed(1)} MiB`);

export function registerMisc(program: Command, ctx: CliContext): void {
  program
    .command("jobs <slug>")
    .description("list jobs; --cancel <jobId>")
    .option("--cancel <jobId>")
    .action(async (slug: string, o: Opts) => {
      const engine = await ctx.engine();
      if (typeof o.cancel === "string") {
        await engine.cancel(o.cancel);
        ctx.io.out(`canceled ${o.cancel}\n`);
        return;
      }
      const jobs = await engine.listJobs(slug);
      if (ctx.globals().json) return void ctx.io.out(JSON.stringify(jobs) + "\n");
      for (const j of jobs) {
        const r = j.request;
        const what = r.kind === "stage" ? `stage ${r.stage}` : `${r.kind} ${r.from ?? "research"}→${r.to ?? "qa"}`;
        ctx.io.out(`${j.id}  ${j.status.padEnd(16)} ${what}${r.langs.length ? ` [${r.langs.join(",")}]` : ""}${j.coalescedInto ? ` → ${j.coalescedInto}` : ""}${j.resumeOf ? ` (resumes ${j.resumeOf})` : ""}${j.error ? `  ${j.error.code}: ${j.error.message.slice(0, 80)}` : ""}\n`);
      }
      if (jobs.length === 0) ctx.io.out("no job yet\n");
    });

  program
    .command("cost <slug>")
    .description("estimates, receipts, total vs cap")
    .action(async (slug: string) => {
      const engine = await ctx.engine();
      const r = await engine.costReport(slug);
      if (ctx.globals().json) return void ctx.io.out(JSON.stringify(r) + "\n");
      ctx.io.out("spent:\n");
      for (const x of r.receipts) ctx.io.out(`  ${`${x.stage}${x.lang ? "." + x.lang : ""}`.padEnd(16)} $${x.usd.toFixed(4)} (${x.calls} call(s))\n`);
      if (r.receipts.length === 0) ctx.io.out("  nothing yet\n");
      ctx.io.out(`total $${r.totalUsd.toFixed(2)} of $${r.maxUsdTotal.toFixed(2)} (per-stage cap $${r.maxUsdPerStage.toFixed(2)})\nlatest estimates:\n`);
      for (const e of r.estimates) ctx.io.out(`  ${`${e.stage}${e.lang ? "." + e.lang : ""}`.padEnd(16)} $${e.totalUsd.toFixed(2)} (${e.confidence}) ${e.createdAt.slice(0, 16)}\n`);
      const pe = await engine.estimatePipeline(slug, { from: "research", to: "qa", langs: [] });
      ctx.io.out(`remaining pipeline estimate: $${pe.totalUsd.toFixed(2)}\n`);
    });

  program
    .command("credits <slug>")
    .description("print the credits of a language")
    .option("--lang <lang>")
    .action(async (slug: string, o: Opts) => {
      const engine = await ctx.engine();
      const p = await engine.getProject(slug);
      const lang = (parseLangs(typeof o.lang === "string" ? o.lang : undefined, false)[0] ?? p.primaryLang) as Lang;
      ctx.io.out((await engine.credits(slug, lang)) + "\n");
    });

  const keys = program.command("keys").description("API keys in <home>/.env (mode 0600)");
  keys
    .command("set <name>")
    .description("store a key (asked on a hidden prompt; non-interactive: read from stdin)")
    .action(async (name: string) => {
      const engine = await ctx.engine();
      let value: string;
      if (ctx.io.isTTY) value = await ctx.io.ask(`${name}: `, { hidden: true });
      else {
        value = readFileSync(0, "utf8").split(/\r?\n/)[0] ?? "";
      }
      if (!value.trim()) throw new UsageError("empty key");
      await engine.setSecret(name, value.trim());
      ctx.io.out(`stored ${name} in ${engine.config.paths.envFile}\n`);
    });
  keys
    .command("test <name>")
    .description("check a key against its provider")
    .action(async (name: string) => {
      const engine = await ctx.engine();
      const r = await engine.testKey(name);
      ctx.io.out(`${name}: ${r.ok ? "ok" : "not ok"} — ${r.message}\n`);
      if (!r.ok) process.exitCode = EXIT.error;
    });
  keys
    .command("list")
    .description("masked status of every key")
    .action(async () => {
      const engine = await ctx.engine();
      const { loadRuntime } = await import("@docmaker/core/node");
      const env = ctx.env();
      const { secrets } = loadRuntime({ cwd: env.DOCMAKER_REPO_ROOT ?? engine.config.repoRoot, env });
      for (const [k, envName] of Object.entries(ENV_KEYS)) ctx.io.out(`${k.padEnd(24)} ${envName.padEnd(24)} ${maskSecret(secrets[k as keyof typeof ENV_KEYS])}\n`);
    });

  program
    .command("cache")
    .description("cache maintenance: cache gc [--dry-run]")
    .argument("<action>", "gc")
    .option("--dry-run")
    .action(async (action: string, o: Opts) => {
      if (action !== "gc") throw new UsageError("cache gc [--dry-run]");
      const engine = await ctx.engine();
      const r = await engine.cacheGc({ dryRun: o.dryRun === true });
      ctx.io.out(`${o.dryRun ? "would remove" : "removed"} ${r.removed} blob(s), ${fmtBytes(r.freedBytes)} (cache ${fmtBytes(r.totalBytes)}, cap ${fmtBytes(r.capBytes)})\n`);
    });
}
