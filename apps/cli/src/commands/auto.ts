// docmaker auto: idea → final video with no human step. The project is created (or switched) in autopilot: the runner
// approves every editorial gate itself (by "autopilot", recorded in approvals.json and the editorial report); between
// runs the engine fixes what no approval settles (fix-only fact-check items), a stale fact-check is re-run, and a failed
// run is retried. Minors and private victims are still never named or shown; no AI image depicts a real person.
import path from "node:path";
import type { Command } from "commander";
import { P, type JobEvent, type JobRequest, type Lang, type RenderPresetId } from "@docmaker/core";
import { UsageError, type CliContext } from "../context";
import { EXIT, followWithCancel } from "../jobrun";
import { parseLangs, parsePreset, qaSummary } from "./core";

type Need = Extract<JobEvent, { type: "needs-approval" }>;
const MAX_ROUNDS = 10;
const MAX_RETRIES = 2;

/** A failure worth retrying at once (not a subscription limit, which resets hours later, nor a configuration error). */
export function retryableNow(e: { code: string; message: string; retryable?: boolean } | null): boolean {
  return !!e && e.retryable === true && !/subscription limit/i.test(e.message);
}

/** Stale fact-checks (re-run them) vs needs the autopilot cannot settle. */
export function triageNeeds(needs: readonly Need[]): { staleFactcheck: Lang[]; other: Need[] } {
  const staleFactcheck = [...new Set(needs.filter((n) => n.gate === "factcheck-ack" && n.reason === "stale").map((n) => n.lang as Lang))];
  return { staleFactcheck, other: needs.filter((n) => !(n.gate === "factcheck-ack" && n.reason === "stale")) };
}

export function registerAuto(program: Command, ctx: CliContext): void {
  program
    .command("auto [idea...]")
    .description("idea → final video, no human step (autopilot: every editorial gate approves itself)")
    .option("--project <slug>", "continue an existing project in autopilot")
    .option("--lang <langs>", "en | fr | en,fr (new project)")
    .option("--minutes <n>", "target length (new project)")
    .option("--slug <slug>", "project slug (new project)")
    .option("--preset <preset>", "render preset: master (default) | draft", "master")
    .action(async (words: string[], o: { project?: string; lang?: string; minutes?: string; slug?: string; preset: string }) => {
      const idea = words.join(" ").trim();
      if (!o.project && idea.length < 3) throw new UsageError("give the subject (docmaker auto \"Le terrible secret de Johnny Depp\") or --project <slug>");
      if (o.project && idea) throw new UsageError("give either a subject or --project, not both");
      const preset = parsePreset(o.preset) as RenderPresetId;
      const minutes = o.minutes !== undefined ? Number(o.minutes) : undefined;
      if (minutes !== undefined && !(minutes >= 1 && minutes <= 60)) throw new UsageError("--minutes must be between 1 and 60");
      const engine = await ctx.engine();
      const json = ctx.globals().json === true;
      const say = (s: string) => {
        if (!json) ctx.io.out(s);
      };

      let slug: string;
      if (o.project) {
        const p = await engine.getProject(o.project);
        slug = p.slug;
        if (p.editorial.autopilot !== true) await engine.updateProject(slug, { editorial: { ...p.editorial, autopilot: true } });
      } else {
        const langs = parseLangs(o.lang, false);
        const p = await engine.createProject({ idea, slug: o.slug, ...(langs.length ? { languages: langs } : {}), targetMinutes: minutes, autopilot: true });
        slug = p.slug;
        say(`created ${slug} (${p.languages.join(", ")}, ${p.targetMinutes} min, LLM ${p.llm.provider})\n`);
      }
      const voices = Object.entries((await engine.getProject(slug)).voice ?? {}).filter(([, v]) => v?.provider === "synthetic").map(([l]) => l);
      if (voices.length) say(`[auto] warning: ${voices.join(", ")} voice is the synthetic placeholder; for a real voice: docmaker setup --tts kokoro (free) or docmaker keys set ELEVENLABS_API_KEY, before running auto\n`);
      say(`autopilot: every approval is automatic and recorded (approvals.json, editorial report); you remain responsible for what you publish\n`);

      let replanChapters: string[] = [];
      let retries = 0;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const req: JobRequest = {
          slug, kind: "pipeline", stage: null, from: null, to: null, langs: [], force: false, preset,
          options: replanChapters.length ? { replanChapters } : {},
        };
        const r = await followWithCancel(ctx, engine, (await engine.submit(req)).jobId);
        replanChapters = [];
        if (r.status === "succeeded") {
          if (json) return;
          const p = await engine.getProject(slug);
          const dir = path.join(engine.config.projectsDir, slug);
          for (const lang of p.languages) {
            ctx.io.out(`\n${lang}:\n  video:  ${path.join(dir, P.renderFinal(lang, preset))}\n  export: ${path.join(dir, P.exportDir(lang))}\n`);
            ctx.io.out(qaSummary(path.join(dir, P.qaReport(lang, preset))).replace(/^/gm, "  ") + "\n");
          }
          return;
        }
        if (r.status === "canceled") {
          process.exitCode = EXIT.canceled;
          return;
        }
        if (r.status !== "waiting-approval") {
          if (retryableNow(r.lastError) && retries < MAX_RETRIES) {
            retries++;
            say(`[auto] retrying after ${r.lastError!.code} (${retries}/${MAX_RETRIES})\n`);
            continue;
          }
          if (r.lastError) ctx.io.err(`failed: ${r.lastError.code}: ${r.lastError.message}${r.lastError.hint ? `\n  hint: ${r.lastError.hint}` : ""}\n  resume later: docmaker auto --project ${slug}\n`);
          process.exitCode = EXIT.error;
          return;
        }
        // what the runner could not approve: a stale fact-check (re-run it) or fix-only fact-check items (fix them)
        const { staleFactcheck, other } = triageNeeds(r.needs);
        for (const lang of staleFactcheck) {
          say(`[auto] ${lang}: the fact-check is stale, re-running it\n`);
          const f = await followWithCancel(ctx, engine, (await engine.submit({ slug, kind: "stage", stage: "factcheck", from: null, to: null, langs: [lang], force: true, options: {}, preset: null })).jobId);
          if (f.status !== "succeeded") {
            if (f.lastError) ctx.io.err(`failed: ${f.lastError.code}: ${f.lastError.message}\n  resume later: docmaker auto --project ${slug}\n`);
            process.exitCode = f.status === "canceled" ? EXIT.canceled : EXIT.error;
            return;
          }
        }
        if (other.length) {
          const fixes = await engine.autopilotFixes(slug);
          for (const a of fixes.actions) say(`[auto] ${a}\n`);
          replanChapters = fixes.replanChapters;
          if (fixes.actions.length === 0 && staleFactcheck.length === 0) {
            ctx.io.err(`autopilot cannot settle: ${other.map((n) => `${n.gate} (${n.summary})`).join("; ")}\n`);
            process.exitCode = EXIT.gate;
            return;
          }
        }
      }
      ctx.io.err(`autopilot: still not finished after ${MAX_ROUNDS} runs; resume with docmaker auto --project ${slug}\n`);
      process.exitCode = EXIT.error;
    });
}
