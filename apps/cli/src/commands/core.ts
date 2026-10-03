// M1 commands: demo, doctor, status, run, setup (§15.1–15.3).
import { readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { P, Project, QaReport, StageId, type Lang, type RenderPresetId } from "@docmaker/core";
import { ensureHome, loadRuntime } from "@docmaker/core/node";
import type { DemoOptions } from "@docmaker/engine";
import { UsageError, splitList, type CliContext } from "../context";
import { EXIT, followWithCancel, runJob } from "../jobrun";

export function parseLangs(v: string | undefined, allowAll = true): Lang[] {
  if (!v) return [];
  if (allowAll && v === "all") return ["en", "fr"];
  const out = splitList(v);
  for (const l of out) if (l !== "en" && l !== "fr") throw new UsageError(`unknown language ${l} (en, fr${allowAll ? ", all" : ""})`);
  return out as Lang[];
}
export function parseStage(v: string | undefined, flag: string): StageId | null {
  if (v === undefined) return null;
  const r = StageId.safeParse(v);
  if (!r.success) throw new UsageError(`${flag}: unknown stage ${v} (${StageId.options.join(", ")})`);
  return r.data;
}
export function parsePreset(v: string | undefined): RenderPresetId | null {
  if (v === undefined) return null;
  if (v !== "draft" && v !== "master") throw new UsageError(`--preset must be draft or master`);
  return v;
}
export function parseChapters(v: string | undefined): string[] | null {
  const xs = splitList(v).map((x) => x.toUpperCase());
  for (const x of xs) if (!/^CH\d+$/.test(x)) throw new UsageError(`invalid chapter id ${x} (CH1, CH2, …)`);
  return xs.length ? xs : null;
}

function qaSummary(file: string): string {
  try {
    const qa = QaReport.parse(JSON.parse(readFileSync(file, "utf8")));
    const errs = qa.checks.filter((c) => !c.ok && c.level === "error");
    const warns = qa.checks.filter((c) => !c.ok && c.level === "warn");
    const lines = [`QA: ${qa.checks.filter((c) => c.ok).length}/${qa.checks.length} checks ok, ${errs.length} error(s), ${warns.length} warning(s)`];
    for (const c of [...errs, ...warns].slice(0, 8)) lines.push(`  ${c.level === "error" ? "error" : "warn "} ${c.id}: ${c.message}`);
    if (qa.loudness) lines.push(`  loudness ${qa.loudness.integratedLufs.toFixed(1)} LUFS, true peak ${qa.loudness.truePeakDbtp.toFixed(2)} dBTP`);
    lines.push(`  ${qa.audioNotListenedNotice}`);
    return lines.join("\n");
  } catch {
    return "QA: no report";
  }
}

export function registerCore(program: Command, ctx: CliContext): void {
  program
    .command("demo")
    .description("full offline demo from a recorded fixture → MP4, NLE export, QA report")
    .option("--fixture <id>", "fixture id", "tulip-mania")
    .option("--lang <lang>", "en | fr | all", "en")
    .option("--offline", "offline assets (default)")
    .option("--online", "allow online asset providers")
    .option("--tts <tts>", "auto | synthetic | kokoro | piper", "auto")
    .option("--preset <preset>", "draft | master", "draft")
    .option("--only-chapters <ids>", "e.g. CH1,CH2")
    .option("--slug <slug>", "project slug (default demo-<fixture>-<timestamp>)")
    .option("--keep", "keep earlier demo projects of this fixture")
    .action(async (o: { fixture: string; lang: string; online?: boolean; offline?: boolean; tts: string; preset: string; onlyChapters?: string; slug?: string; keep?: boolean }) => {
      if (!["auto", "synthetic", "kokoro", "piper"].includes(o.tts)) throw new UsageError("--tts must be auto, synthetic, kokoro or piper");
      if (o.online && o.offline) throw new UsageError("--online and --offline are exclusive");
      const opts: DemoOptions = {
        fixture: o.fixture, langs: parseLangs(o.lang), offline: !o.online, tts: o.tts as DemoOptions["tts"], preset: parsePreset(o.preset) ?? "draft",
        onlyChapters: parseChapters(o.onlyChapters), slug: o.slug,
      };
      const engine = await ctx.engine();
      const d = await engine.startDemo(opts);
      if (!ctx.globals().json) ctx.io.out(`demo project ${d.slug} (${d.langs.join(", ")}, ${d.preset})\n`);
      const r = await followWithCancel(ctx, engine, d.jobId);
      if (r.status !== "succeeded") {
        if (r.lastError && !ctx.globals().json) ctx.io.err(`demo failed: ${r.lastError.code}: ${r.lastError.message}\n`);
        process.exitCode = r.status === "canceled" ? EXIT.canceled : r.status === "waiting-approval" ? EXIT.gate : EXIT.error;
        return;
      }
      if (!o.keep) {
        const re = new RegExp(`^demo-${o.fixture.replace(/[^a-z0-9-]/g, "")}-\\d{8}-\\d{6}$`);
        for (const name of readdirSync(engine.config.projectsDir)) {
          if (name === d.slug || !re.test(name)) continue;
          try {
            const p = Project.parse(JSON.parse(readFileSync(path.join(engine.config.projectsDir, name, P.project), "utf8")));
            if (p.llm.provider === "fixture" && p.llm.fixtureId === o.fixture) rmSync(path.join(engine.config.projectsDir, name), { recursive: true, force: true });
          } catch { /* not a demo project */ }
        }
      }
      if (ctx.globals().json) return;
      const projectDir = path.join(engine.config.projectsDir, d.slug);
      for (const lang of d.langs) {
        ctx.io.out(`\n${lang}:\n  video:  ${path.join(projectDir, P.renderFinal(lang, d.preset))}\n  export: ${path.join(projectDir, P.exportDir(lang))}\n`);
        ctx.io.out(qaSummary(path.join(projectDir, P.qaReport(lang, d.preset))).replace(/^/gm, "  ") + "\n");
      }
    });

  program
    .command("doctor")
    .description("environment report")
    .option("--json", "machine-readable output")
    .action(async (o: { json?: boolean }) => {
      const engine = await ctx.engine();
      const rep = await engine.doctor();
      if (o.json || ctx.globals().json) ctx.io.out(JSON.stringify(rep, null, 2) + "\n");
      else {
        for (const c of rep.checks) {
          const tag = c.ok ? " ok " : c.level === "error" ? "FAIL" : c.level === "warn" ? "warn" : "info";
          ctx.io.out(`[${tag}] ${c.id.padEnd(22)} ${c.value}${!c.ok && c.hint ? `  → ${c.hint}` : ""}\n`);
        }
        ctx.io.out(rep.blocking ? "\nblocking problems found\n" : "\nno blocking problem\n");
      }
      if (rep.blocking) process.exitCode = EXIT.error;
    });

  program
    .command("status [slug]")
    .description("stage table (stale/blocked reasons), costs, active job; without a slug: the project list")
    .action(async (slug: string | undefined) => {
      const engine = await ctx.engine();
      if (!slug) {
        const list = await engine.listProjects();
        if (ctx.globals().json) return void ctx.io.out(JSON.stringify(list) + "\n");
        if (list.length === 0) ctx.io.out(`no project in ${engine.config.projectsDir}\n`);
        for (const p of list) ctx.io.out(`${p.slug.padEnd(40)} ${p.languages.join(",").padEnd(6)} ${p.updatedAt.slice(0, 16)}${p.activeJobId ? `  running ${p.activeJobId}` : ""}  ${p.title}\n`);
        return;
      }
      const st = await engine.status(slug);
      if (ctx.globals().json) return void ctx.io.out(JSON.stringify(st) + "\n");
      for (const s of st.stages) {
        const what = s.status === "done" ? (s.stale ? "stale" : "done") : s.status;
        const block = s.blockedBy ? `  blocked: ${s.blockedBy} (${s.blockedReason})` : "";
        const err = s.status === "failed" && s.error ? `  ${s.error.slice(0, 100)}` : "";
        ctx.io.out(`${`${s.stage}${s.lang ? "." + s.lang : ""}${s.variant ? "@" + s.variant : ""}`.padEnd(22)} ${what.padEnd(8)} ${s.costUsd ? `$${s.costUsd.toFixed(2)}` : ""}${block}${err}\n`);
      }
      ctx.io.out(`\ncost so far: $${st.costUsd.toFixed(2)}${st.activeJobId ? `   active job: ${st.activeJobId}` : ""}${st.queued.length ? `   queued: ${st.queued.join(", ")}` : ""}\n`);
    });

  program
    .command("run <slug>")
    .description("run the pipeline (one estimate + approval); resume after a gate")
    .option("--from <stage>", "first stage (default research)")
    .option("--to <stage>", "last stage (default qa)")
    .option("--lang <langs>", "en | fr | en,fr | all (default: every project language)")
    .option("--preset <preset>", "render preset for render/qa")
    .option("--chapters <ids>", "only these chapters for layout → render (onlyChapters)")
    .option("--resume <jobId>", "resubmit a job after its gate was approved")
    .action(async (slug: string, o: { from?: string; to?: string; lang?: string; preset?: string; chapters?: string; resume?: string }) => {
      const g = ctx.globals();
      if (o.resume) {
        process.exitCode = await runJob(ctx, { resume: o.resume, slug });
        return;
      }
      process.exitCode = await runJob(ctx, {
        slug, kind: "pipeline", stage: null, from: parseStage(o.from, "--from"), to: parseStage(o.to, "--to"), langs: parseLangs(o.lang), force: g.force === true,
        options: {
          ...(parseChapters(o.chapters) ? { onlyChapters: parseChapters(o.chapters) } : {}),
          ...(g.newRequest ? { newRequest: true } : {}), ...(g.forceOverwriteEdits ? { forceOverwriteEdits: true } : {}),
        },
        preset: parsePreset(o.preset),
      });
    });

  program
    .command("setup")
    .description("download, install and verify optional components (idempotent)")
    .option("--all", "everything below")
    .option("--browser", "Chrome Headless Shell for Remotion")
    .option("--sfx [pack]", "generate an SFX pack (procedural | remotion)")
    .option("--tts <model>", "kokoro | piper:<voice>")
    .option("--python", "Python sidecar venv (uv)")
    .option("--yt-dlp", "yt-dlp")
    .option("--whisper <impl>", "faster-whisper | whisper-cpp")
    .option("--clip", "CLIP runtime (M3)")
    .action(async (o: Record<string, unknown>) => {
      const { runSetup } = await import("./setup");
      process.exitCode = await runSetup(ctx, o);
    });
}

/** Re-exported for the setup module. */
export function runtimeOf(ctx: CliContext) {
  const env = ctx.env();
  return loadRuntime({ cwd: env.DOCMAKER_REPO_ROOT ?? process.cwd(), env });
}
export { ensureHome };
