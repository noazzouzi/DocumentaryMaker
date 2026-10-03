// Project commands (§15.1): new, research, style, outline, script, beats, factcheck, approve, persons, assets, voice, layout,
// direct, mix, preview, render, export, qa. `--yes` / `--max-cost` never satisfy editorial gates; factcheck `--ack all`
// is interactive only (non-interactive use requires --ack-file with a note per item).
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Command } from "commander";
import {
  ApprovalsDoc, FactCheck, GateId, LicenseCode, Outline, P, StyleSuggestion, docHash, type FactCheckItem, type JobOptions, type JobRequest, type Lang,
  type Project, type StageId, type UploadDeclaration,
} from "@docmaker/core";
import { NOTE_MIN, ackCoverage, changedSinceAck, gatingItems, fixOnly } from "@docmaker/engine";
import { UsageError, splitList, type CliContext } from "../context";
import { EXIT, runJob } from "../jobrun";
import { parseChapters, parseLangs, parsePreset, parseStage } from "./core";

type Opts = Record<string, string | boolean | undefined>;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function stageJob(ctx: CliContext, slug: string, stage: StageId, o: { langs?: Lang[]; options?: JobOptions; preset?: JobRequest["preset"] }): JobRequest {
  const g = ctx.globals();
  return {
    slug, kind: "stage", stage, from: null, to: null, langs: o.langs ?? [], force: g.force === true, preset: o.preset ?? null,
    options: { ...(o.options ?? {}), ...(g.newRequest ? { newRequest: true } : {}), ...(g.forceOverwriteEdits ? { forceOverwriteEdits: true } : {}) },
  };
}
const pipelineJob = (ctx: CliContext, slug: string, from: StageId, to: StageId, o: { langs?: Lang[]; options?: JobOptions; preset?: JobRequest["preset"] } = {}): JobRequest =>
  ({ ...stageJob(ctx, slug, from, o), kind: "pipeline", stage: null, from, to });

/** "own-work" | "licensed:<CODE>:<author>:<url>" | "third-party:<url>" | "ai-generated" */
export function parseDeclaration(v: string | undefined): UploadDeclaration {
  if (!v) throw new UsageError("--declare is required: own-work | licensed:<CODE>:<author>:<url> | third-party:<url> | ai-generated");
  if (v === "own-work") return { kind: "own-work", license: null, author: "", url: "", note: "" };
  if (v === "ai-generated") return { kind: "ai-generated", license: "AI-GENERATED", author: "", url: "", note: "" };
  if (v.startsWith("third-party:")) {
    const url = v.slice("third-party:".length);
    if (!/^https?:\/\//.test(url)) throw new UsageError("third-party:<url> needs the source URL");
    return { kind: "third-party-quotation", license: null, author: "", url, note: "" };
  }
  if (v.startsWith("licensed:")) {
    const [, code, author, ...rest] = v.split(":");
    const url = rest.join(":");
    const c = LicenseCode.safeParse(code);
    if (!c.success) throw new UsageError(`unknown licence code ${code} (${LicenseCode.options.join(", ")})`);
    if (!author || !/^https?:\/\//.test(url)) throw new UsageError("licensed:<CODE>:<author>:<url> needs an author and a URL");
    return { kind: "licensed", license: c.data, author, url, note: "" };
  }
  throw new UsageError(`unknown declaration ${v}`);
}

export function parseMmSs(v: string | undefined, flag: string): number {
  if (!v) throw new UsageError(`${flag} is required (mm:ss or seconds)`);
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(v.trim());
  if (!m) throw new UsageError(`${flag}: expected mm:ss (got ${v})`);
  return Math.round(((m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])) * 1000);
}

export function parseRange(v: string | undefined): [number, number] | null {
  if (!v) return null;
  const m = /^(\d+):(\d+)$/.exec(v);
  if (!m || Number(m[1]) > Number(m[2])) throw new UsageError("--range must be <fromFrame>:<toFrame>");
  return [Number(m[1]), Number(m[2])];
}

function printItems(ctx: CliContext, items: readonly FactCheckItem[], gating: Set<string>, review: ReadonlySet<string> = new Set()) {
  for (const it of items) {
    const tag = review.has(it.id) ? "REVIEW: verdict/risk changed since acknowledged" : gating.has(it.id) ? (it.resolution === "open" ? "BLOCKING" : it.resolution.toUpperCase()) : it.resolution;
    ctx.io.out(`${it.id}  ${it.risk.padEnd(6)} ${it.verdict.padEnd(26)} ${it.where.padEnd(10)} [${tag}]${fixOnly(it) ? " (fix only)" : ""}\n    ${it.sentence}\n    ${it.problem}${it.suggestedRewrite ? `\n    suggestion: ${it.suggestedRewrite}` : ""}${it.note ? `\n    note: ${it.note}` : ""}\n`);
  }
}

async function confirmYes(ctx: CliContext, q: string): Promise<boolean> {
  return /^y(es)?$/i.test((await ctx.io.ask(`${q} [y/N] `)).trim());
}

export function registerProject(program: Command, ctx: CliContext): void {
  // ------------------------------------------------------------------ new
  program
    .command("new <idea>")
    .description("create a project; prints the slug and the pipeline estimate")
    .option("--slug <slug>")
    .option("--lang <langs>", "en | fr | en,fr")
    .option("--primary <lang>")
    .option("--minutes <n>")
    .option("--style <style>", "auto | <id> (an id confirms the style)", "auto")
    .option("--llm <provider>", "anthropic | fixture")
    .option("--fixture <id>")
    .option("--seed <n>")
    .action(async (idea: string, o: Opts) => {
      const engine = await ctx.engine();
      const langs = parseLangs(str(o.lang), false);
      const llm = str(o.llm) ?? (o.fixture ? "fixture" : undefined);
      if (llm && llm !== "anthropic" && llm !== "fixture") throw new UsageError("--llm must be anthropic or fixture");
      if (llm === "fixture" && !o.fixture) throw new UsageError("--llm fixture needs --fixture <id>");
      const minutes = o.minutes !== undefined ? Number(o.minutes) : undefined;
      if (minutes !== undefined && !(minutes >= 1 && minutes <= 60)) throw new UsageError("--minutes must be between 1 and 60");
      const style = str(o.style) ?? "auto";
      const p = await engine.createProject({
        idea, slug: str(o.slug), ...(langs.length ? { languages: langs } : {}), primaryLang: parseLangs(str(o.primary), false)[0], targetMinutes: minutes,
        styleId: style === "auto" ? null : style, llm: llm as "anthropic" | "fixture" | undefined, fixtureId: str(o.fixture) ?? null,
        seed: o.seed !== undefined ? Number(o.seed) : undefined,
      });
      ctx.io.out(`created ${p.slug} (${p.languages.join(", ")}, ${p.targetMinutes} min)\n`);
      if (style === "auto") {
        const s = await engine.suggestStyleForIdea(idea, { useLlm: false });
        ctx.io.out("suggested styles:\n" + s.ranked.map((r) => `  ${r.styleId.padEnd(22)} ${(r.score * 100).toFixed(0)}  ${r.why}`).join("\n") + "\n");
        if (ctx.io.isTTY) {
          const a = (await ctx.io.ask(`style for this project [${s.recommendedStyleId}] (Enter to accept, or an id): `)).trim() || s.recommendedStyleId;
          await engine.updateProject(p.slug, { styleId: a });
          await engine.approve(p.slug, "style-confirm", { stage: "outline", lang: null, planHash: "", by: "cli", note: "chosen at creation", items: [], itemNotes: {} });
          ctx.io.out(`style ${a} confirmed\n`);
        } else if (ctx.globals().yes) {
          await engine.updateProject(p.slug, { styleId: s.recommendedStyleId });
          await engine.approve(p.slug, "style-confirm", { stage: "outline", lang: null, planHash: "", by: "flag", note: "--yes", items: [], itemNotes: {} });
          ctx.io.out(`style ${s.recommendedStyleId} confirmed (--yes)\n`);
        } else ctx.io.out(`confirm later: docmaker style ${p.slug} --pick <id> | --confirm\n`);
      }
      const pe = await engine.estimatePipeline(p.slug, { from: "research", to: "qa", langs: [] });
      ctx.io.out(`pipeline estimate: $${pe.totalUsd.toFixed(2)}${pe.stages.length ? ` (${pe.stages.map((s) => `${s.stage}${s.lang ? "." + s.lang : ""} $${s.totalUsd.toFixed(2)}`).join(", ")})` : ""}\nnext: docmaker run ${p.slug}\n`);
    });

  // ------------------------------------------------------------------ style
  program
    .command("style <target> [arg]")
    .description("style <slug> [--pick <id>] [--confirm] [--llm] | style new <id> --from <base> | style validate <dir> | style preview <id>")
    .option("--pick <id>")
    .option("--confirm")
    .option("--llm", "refine the suggestion with the LLM (needs a key)")
    .option("--from <baseId>", "base style for `style new`", "drama-commentary")
    .action(async (target: string, arg: string | undefined, o: Opts) => {
      const styles = await import("@docmaker/styles");
      const engine = await ctx.engine();
      if (target === "new") {
        if (!arg) throw new UsageError("style new <id>");
        const registry = await styles.discoverStyles({ repoRoot: engine.config.repoRoot, userStylesDir: engine.config.paths.styles });
        const dir = await styles.scaffoldStyle({ registry, fromId: str(o.from) ?? "drama-commentary", newId: arg, destDir: engine.config.paths.styles });
        ctx.io.out(`created ${dir}\nedit style.json / STYLE.md, then: docmaker style validate ${dir}\n`);
        return;
      }
      if (target === "validate") {
        if (!arg) throw new UsageError("style validate <dir>");
        const rep = await styles.inspectStyleDir(arg);
        for (const i of rep.issues) ctx.io.out(`${i.level.padEnd(5)} ${i.rule} ${i.where}: ${i.msg}\n`);
        const errs = rep.issues.filter((i) => i.level === "error").length;
        ctx.io.out(errs ? `${errs} error(s)\n` : "valid\n");
        if (errs) process.exitCode = EXIT.error;
        return;
      }
      if (target === "preview") {
        ctx.io.err("style preview: the StyleSpecimen contact sheet renderer is not exposed by @docmaker/render yet; use the web styles gallery (pnpm dev:web → /styles)\n");
        process.exitCode = EXIT.error;
        return;
      }
      const slug = target;
      const p = await engine.getProject(slug);
      let sug: StyleSuggestion;
      try {
        sug = (await engine.readDoc(slug, P.styleSuggestion, StyleSuggestion)).value;
      } catch {
        sug = await engine.suggestStyleForIdea(p.idea, { useLlm: o.llm === true });
      }
      if (o.llm && sug.source === "offline") sug = await engine.suggestStyleForIdea(p.idea, { useLlm: true });
      ctx.io.out(`current: ${p.styleId ?? "(none)"}${p.styleConfirmed ? " (confirmed)" : " (not confirmed)"}\nranking (${sug.source}):\n` + sug.ranked.map((r) => `  ${r.styleId.padEnd(22)} ${(r.score * 100).toFixed(0)}  ${r.why}`).join("\n") + "\n");
      if (sug.riskFlags.some((f) => f !== "none")) ctx.io.out(`risk flags: ${sug.riskFlags.join(", ")}\n`);
      if (o.pick) {
        await engine.updateProject(slug, { styleId: str(o.pick)! });
        await engine.approve(slug, "style-confirm", { stage: "outline", lang: null, planHash: "", by: "cli", note: `picked ${o.pick}`, items: [], itemNotes: {} });
        ctx.io.out(`style ${o.pick} picked and confirmed\n`);
      } else if (o.confirm) {
        await engine.approve(slug, "style-confirm", { stage: "outline", lang: null, planHash: "", by: "cli", note: "confirmed", items: [], itemNotes: {} });
        ctx.io.out(`style ${(await engine.getProject(slug)).styleId} confirmed\n`);
      }
    });

  // ------------------------------------------------------------------ research
  program
    .command("research <slug>")
    .description("research stage (cost gate: --yes / --max-cost); saved turns of an interrupted run of the same request are reused")
    .option("--resume", "continue the interrupted research from its saved turns (never starts a new paid research)")
    .action(async (slug: string, o: Opts) => {
      const g = ctx.globals();
      if (o.resume && g.newRequest) throw new UsageError("--resume and --new-request are exclusive");
      const engine = await ctx.engine();
      const info = await engine.researchResume(slug);
      const json = g.json === true;
      if (o.resume) {
        if (!info.saved) {
          ctx.io.err(`nothing to resume: ${slug} has no saved research turns\n  run: docmaker research ${slug}\n`);
          return void (process.exitCode = EXIT.error);
        }
        if (!info.matches) {
          ctx.io.err(`nothing to resume: the ${info.saved} saved research turn(s) belong to an earlier request (the idea, languages, length, as-of date or provider changed)\n  start a new research: docmaker research ${slug}\n`);
          return void (process.exitCode = EXIT.error);
        }
      }
      if (!json && info.saved && info.matches && !g.newRequest) {
        ctx.io.out(info.complete
          ? `the saved research (${info.saved} turn(s)) is complete: it is reused, no new research call (--new-request starts over)\n`
          : `continuing the interrupted research from ${info.saved} saved turn(s) (--new-request starts over)\n`);
      } else if (!json && info.saved && !o.resume) {
        ctx.io.out(`${info.saved} saved research turn(s) ${g.newRequest ? "will be discarded (--new-request)" : "belong to an earlier request and will be discarded"}\n`);
      }
      // a new request is an explicit ask for a new paid research: run the stage even when it is up to date
      const req = stageJob(ctx, slug, "research", {});
      const code = await runJob(ctx, g.newRequest ? { ...req, force: true } : req);
      process.exitCode = code;
      if (code !== EXIT.ok || json) return;
      const { ResearchDossier, FactSheet } = await import("@docmaker/core");
      const d = await engine.readDoc(slug, P.dossier, ResearchDossier).then((x) => x.value).catch(() => null);
      const f = await engine.readDoc(slug, P.factsheet, FactSheet).then((x) => x.value).catch(() => null);
      if (d && f) {
        ctx.io.out(`research: ${f.sources.length} source(s), ${f.claims.length} claim(s), ${f.people.length} person(s), ${f.quotes.length} quote(s); ${d.searchesUsed} search(es), ${d.fetchesUsed} fetch(es), ${d.turns} turn(s)\n`);
        ctx.io.out(`dossier: ${path.join(engine.config.projectsDir, slug, P.dossierMd)}\nnext: docmaker outline ${slug}\n`);
      }
    });

  // ------------------------------------------------------------------ outline
  program
    .command("outline <slug>")
    .description("write/show the outline; --confirm-thesis then --approve")
    .option("--approve")
    .option("--confirm-thesis")
    .option("--note <text>")
    .action(async (slug: string, o: Opts) => {
      const engine = await ctx.engine();
      let doc = await engine.readDoc(slug, P.outline, Outline).catch(() => null);
      if (!doc) {
        const code = await runJob(ctx, pipelineJob(ctx, slug, "research", "outline"));
        if (code !== EXIT.ok) return void (process.exitCode = code);
        doc = await engine.readDoc(slug, P.outline, Outline);
      }
      if (o.confirmThesis && !doc.value.thesisConfirmed) {
        await engine.writeDoc(slug, P.outline, Outline, { ...doc.value, thesisConfirmed: true }, doc.etag);
        doc = await engine.readDoc(slug, P.outline, Outline);
        ctx.io.out("thesis confirmed\n");
      }
      const v = doc.value;
      ctx.io.out(`${v.title}\nthesis${v.thesisConfirmed ? "" : " (NOT confirmed)"}: ${v.thesis}\n` + v.chapters.map((c) => `  ${c.id} [${c.act}] ${c.title} — ${c.targetWords} words`).join("\n") + "\n");
      if (o.approve) {
        if (!v.thesisConfirmed) throw new UsageError("confirm the thesis first (--confirm-thesis) or edit it");
        await engine.approve(slug, "outline-approval", { stage: "outline", lang: null, planHash: docHash(v), by: "cli", note: str(o.note) ?? "", items: [], itemNotes: {} });
        ctx.io.out("outline approved\n");
      }
    });

  // ------------------------------------------------------------------ script / beats / layout / direct / mix / qa
  program
    .command("script <slug>")
    .description("write or rewrite chapters (user-edited chapters need --force-overwrite-edits)")
    .option("--lang <langs>")
    .option("--chapter <ids>")
    .option("--transcreate <segmentIds>", "secondary language: re-transcreate out-of-sync segments from the primary")
    .action(async (slug: string, o: Opts) => {
      if (o.transcreate) {
        const lang = parseLangs(str(o.lang), false)[0];
        if (!lang) throw new UsageError("--transcreate needs --lang <secondary language>");
        const engine = await ctx.engine();
        for (const id of splitList(str(o.transcreate)).map((x) => x.toUpperCase())) {
          const r = await engine.transcreate(slug, lang, id);
          ctx.io.out(`${id}: ${r.displayText}\n`);
          for (const i of r.issues.filter((x) => x.where.startsWith(id))) ctx.io.out(`  ${i.level} ${i.rule}: ${i.msg}\n`);
        }
        return;
      }
      const chapters = parseChapters(str(o.chapter));
      process.exitCode = await runJob(ctx, stageJob(ctx, slug, "script", { langs: parseLangs(str(o.lang)), options: chapters ? { chapters } : {} }));
    });
  program
    .command("beats <slug>")
    .description("beat plans (+ slices for every language)")
    .option("--replan <ids>", "LLM re-plan of these chapters")
    .action(async (slug: string, o: Opts) => {
      const replan = parseChapters(str(o.replan));
      process.exitCode = await runJob(ctx, pipelineJob(ctx, slug, "beats", "beatslice", { options: replan ? { replanChapters: replan } : {} }));
    });
  for (const stage of ["layout", "direct", "mix"] as const) {
    program
      .command(`${stage} <slug>`)
      .description(`run the ${stage} stage`)
      .option("--lang <langs>")
      .option("--chapters <ids>", "only these chapters (onlyChapters)")
      .action(async (slug: string, o: Opts) => {
        const only = parseChapters(str(o.chapters));
        process.exitCode = await runJob(ctx, stageJob(ctx, slug, stage, { langs: parseLangs(str(o.lang)), options: only ? { onlyChapters: only } : {} }));
      });
  }
  program
    .command("qa <slug>")
    .description("QA report of a render")
    .option("--lang <langs>")
    .option("--preset <preset>")
    .action(async (slug: string, o: Opts) => {
      process.exitCode = await runJob(ctx, stageJob(ctx, slug, "qa", { langs: parseLangs(str(o.lang)), preset: parsePreset(str(o.preset)) }));
    });

  // ------------------------------------------------------------------ factcheck
  program
    .command("factcheck <slug>")
    .description("audit; acknowledge (--ack on a terminal, --ack-file otherwise); dismiss; recheck pending statuses")
    .option("--lang <lang>")
    .option("--ack <ids>", "FC ids, or 'all' (interactive terminal only)")
    .option("--ack-file <json>", "{\"FC-…\": \"note\"} (non-interactive)")
    .option("--dismiss <ids>")
    .option("--note <text>", "note for --dismiss / a shared note for --ack")
    .option("--recheck", "re-research pending claim statuses")
    .action(async (slug: string, o: Opts) => {
      const engine = await ctx.engine();
      const project = await engine.getProject(slug);
      if (o.recheck) {
        const r = await engine.recheckClaims(slug);
        ctx.io.out(r.checked.length ? `rechecked ${r.checked.join(", ")}; changed: ${r.changed.join(", ") || "none"}\n` : "no pending claim to recheck\n");
        return;
      }
      const lang = (parseLangs(str(o.lang), false)[0] ?? project.primaryLang) as Lang;
      const ackFile = str(o.ackFile);
      const ack = str(o.ack);
      if (ack && !ctx.io.isTTY) throw new UsageError("--ack needs an interactive terminal (it asks per item); non-interactive use requires --ack-file <json> with a note per item");
      let fc = await engine.readDoc(slug, P.factcheck(lang), FactCheck).catch(() => null);
      if (!fc || (!ack && !ackFile && !o.dismiss)) {
        const code = await runJob(ctx, pipelineJob(ctx, slug, "research", "factcheck", { langs: [lang] }));
        if (code !== EXIT.ok) return void (process.exitCode = code);
        fc = await engine.readDoc(slug, P.factcheck(lang), FactCheck);
      }
      const sugg = await engine.readDoc(slug, P.styleSuggestion, StyleSuggestion).then((d) => d.value.riskFlags).catch(() => []);
      const approvals = await engine.readDoc(slug, P.approvals, ApprovalsDoc).then((d) => d.value).catch((): ApprovalsDoc => ({ schemaVersion: 1, approvals: [] }));
      let gating = gatingItems(fc.value, sugg);
      const gatingIds = new Set(gating.map((i) => i.id));
      // acknowledged/dismissed items whose verdict or risk changed since their approval: they need a new review
      const reviewIds = () => new Set(changedSinceAck(gating, ackCoverage(approvals, lang)).map((i) => i.id));
      if (o.dismiss) {
        const ids = new Set(splitList(str(o.dismiss)));
        const note = (str(o.note) ?? "").trim();
        if (note.length < 10) throw new UsageError("--dismiss needs --note with at least 10 characters");
        const next = { ...fc.value, items: fc.value.items.map((i) => (ids.has(i.id) ? { ...i, resolution: "dismissed" as const, note } : i)) };
        await engine.writeDoc(slug, P.factcheck(lang), FactCheck, next, fc.etag);
        fc = await engine.readDoc(slug, P.factcheck(lang), FactCheck);
        gating = gatingItems(fc.value, sugg);
        ctx.io.out(`dismissed ${[...ids].join(", ")}\n`);
      }
      const review = reviewIds();
      if (!ack && !ackFile) {
        printItems(ctx, fc.value.items, gatingIds, review);
        const open = gating.filter((i) => i.resolution === "open");
        ctx.io.out(open.length ? `\n${open.length} blocking item(s) open\n` : "\nno blocking item open\n");
        if (review.size) ctx.io.out(`${review.size} acknowledged item(s) changed since their approval and need a new review: ${[...review].join(", ")}\n`);
        if (o.dismiss && !open.length) ctx.io.out(`record the acknowledgement: docmaker factcheck ${slug} --lang ${lang} --ack-file <json>   (or --ack <ids> on a terminal)\n`);
        return;
      }
      // itemNotes holds only notes written for this approval (per item); a shared --note travels as `note`, so the engine
      // can tell an explicitly shared note from accidentally identical per-item notes
      const shared = (str(o.note) ?? "").trim();
      const itemNotes: Record<string, string> = {};
      const acked = new Set<string>();
      if (ackFile) {
        let raw: unknown;
        try {
          raw = JSON.parse(await readFile(ackFile, "utf8"));
        } catch (err) {
          throw new UsageError(`--ack-file: ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new UsageError("--ack-file must hold a JSON object {\"FC-…\": \"note\"}");
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          acked.add(k);
          const note = String(v ?? "").trim();
          if (note) itemNotes[k] = note;
        }
      } else {
        const wanted = ack === "all" ? gating.filter((i) => i.resolution === "open" || review.has(i.id)) : fc.value.items.filter((i) => splitList(ack).includes(i.id));
        const unknown = ack === "all" ? [] : splitList(ack).filter((id) => !fc!.value.items.some((i) => i.id === id));
        if (unknown.length) throw new UsageError(`unknown fact-check item(s): ${unknown.join(", ")}`);
        for (const it of wanted) {
          printItems(ctx, [it], gatingIds, review);
          if (!(await confirmYes(ctx, `acknowledge ${it.id}?`))) continue;
          acked.add(it.id);
          if (shared) {
            itemNotes[it.id] = shared;
            continue;
          }
          const keep = it.note.trim().length >= NOTE_MIN;
          const answer = (await ctx.io.ask(keep ? "note (Enter keeps the current note): " : `note (≥ ${NOTE_MIN} characters): `)).trim();
          if (answer || !keep) itemNotes[it.id] = answer;
        }
      }
      // blocking items acknowledged or dismissed earlier keep their recorded notes (no copy into itemNotes) and are covered
      // by this approval, except those whose verdict or risk changed since: they must be reviewed explicitly
      const unreviewed = [...review].filter((id) => !acked.has(id));
      if (unreviewed.length) {
        ctx.io.err(`${unreviewed.join(", ")}: the verdict or risk changed since the acknowledgement; review ${unreviewed.length > 1 ? "them" : "it"} explicitly (--ack <ids> on a terminal, or list ${unreviewed.length > 1 ? "them" : "it"} in --ack-file)\n`);
        return void (process.exitCode = EXIT.error);
      }
      for (const it of gating) if (it.resolution !== "open" && it.resolution !== "rewritten") acked.add(it.id);
      const items = [...acked].sort();
      await engine.approve(slug, "factcheck-ack", { stage: "factcheck", lang, planHash: "", by: "cli", note: shared, items, itemNotes });
      ctx.io.out(`acknowledged ${items.length} item(s) for ${lang}\n`);
    });

  // ------------------------------------------------------------------ approve / persons
  program
    .command("approve <slug> <gate>")
    .description("generic approval with per-gate validation")
    .option("--stage <stage>")
    .option("--lang <lang>")
    .option("--items <ids>")
    .option("--item-notes <json>")
    .option("--note <text>")
    .option("--plan <hash>", "plan hash (cost gate: the estimate's planHash)")
    .action(async (slug: string, gate: string, o: Opts) => {
      const g = GateId.safeParse(gate);
      if (!g.success) throw new UsageError(`unknown gate ${gate} (${GateId.options.join(", ")})`);
      const engine = await ctx.engine();
      let notes: Record<string, string> = {};
      if (o.itemNotes) {
        try {
          notes = JSON.parse(str(o.itemNotes)!) as Record<string, string>;
        } catch {
          throw new UsageError("--item-notes must be a JSON object");
        }
      }
      let planHash = str(o.plan) ?? "";
      if (g.data === "outline-approval" && !planHash) planHash = docHash((await engine.readDoc(slug, P.outline, Outline)).value);
      if (g.data === "cost" && !/^[a-f0-9]{64}$/.test(planHash)) throw new UsageError("approve cost needs --plan <planHash> (shown by the waiting job)");
      const lang = parseLangs(str(o.lang), false)[0] ?? null;
      const stage = parseStage(str(o.stage), "--stage") ?? ({ "style-confirm": "outline", "outline-approval": "outline", "factcheck-ack": "factcheck", "person-ack": "assets", recheck: "render", cost: "research", "fair-use": "assets" } as const)[g.data];
      await engine.approve(slug, g.data, { stage, lang, planHash, by: "cli", note: str(o.note) ?? "", items: splitList(str(o.items)), itemNotes: notes });
      ctx.io.out(`${g.data} approved\n`);
    });
  program
    .command("persons <slug>")
    .description("people of the fact sheet; --ack <id> --note for non-public persons")
    .option("--ack <ids>")
    .option("--note <text>")
    .action(async (slug: string, o: Opts) => {
      const engine = await ctx.engine();
      if (o.ack) {
        await engine.approve(slug, "person-ack", { stage: "assets", lang: null, planHash: "", by: "cli", note: str(o.note) ?? "", items: splitList(str(o.ack)), itemNotes: {} });
        ctx.io.out(`acknowledged ${o.ack}\n`);
        return;
      }
      const { FactSheet } = await import("@docmaker/core");
      const fs = (await engine.readDoc(slug, P.factsheet, FactSheet)).value;
      const acks = new Set((await engine.readDoc(slug, P.approvals, ApprovalsDoc).then((d) => d.value.approvals).catch(() => [])).filter((a) => a.gate === "person-ack").flatMap((a) => a.items));
      for (const p of fs.people) {
        const status = p.isMinorOrPrivateVictim ? "never shown or named (minor / private victim)" : p.publicFigure ? "public figure" : acks.has(p.id) ? "non-public, acknowledged" : "non-public — needs person-ack before appearing";
        ctx.io.out(`${p.id.padEnd(4)} ${p.name.padEnd(30)} ${status}\n`);
      }
    });

  // ------------------------------------------------------------------ assets
  program
    .command("assets <target> [args...]")
    .description("assets <slug> [--offline] [--providers a,b] [--no-youtube] [--allow-paid] | assets import <slug> <dir> --declare … | assets clip <slug> <segmentId> --url|--file …")
    .option("--offline", "use only local + procedural providers (project setting)")
    .option("--providers <ids>", "enabled providers in priority order (project setting)")
    .option("--beat <id>", "show one beat's picks and candidates")
    .option("--no-youtube", "disable YouTube clips (project setting)")
    .option("--allow-paid", "paid providers allowed for this run")
    .option("--declare <decl>", "import: own-work | licensed:<CODE>:<author>:<url> | third-party:<url> | ai-generated")
    .option("--tags <tags>")
    .option("--url <url>")
    .option("--file <file>")
    .option("--from <mm:ss>")
    .option("--to <mm:ss>")
    .option("--channel <name>", "", "")
    .option("--title <title>", "", "")
    .action(async (target: string, args: string[], o: Opts) => {
      const engine = await ctx.engine();
      if (target === "import") {
        const [slug, dir] = args;
        if (!slug || !dir) throw new UsageError("assets import <slug> <dir> --declare …");
        const doc = await engine.importLocalDir(slug, { dir, declaration: parseDeclaration(str(o.declare)), tags: splitList(str(o.tags)) });
        ctx.io.out(`indexed ${doc.files.length} file(s); they are searched by the next assets run\n`);
        return;
      }
      if (target === "clip") {
        const [slug, segmentId] = args;
        if (!slug || !segmentId) throw new UsageError("assets clip <slug> <segmentId> --url U | --file F --from mm:ss --to mm:ss");
        if (!o.url === !o.file) throw new UsageError("give exactly one of --url and --file");
        let uploadRel: string | null = null;
        if (o.file) {
          const src = path.resolve(str(o.file)!);
          uploadRel = `${P.uploads}${segmentId}${path.extname(src).toLowerCase()}`;
          const dest = path.join(engine.config.projectsDir, slug, uploadRel);
          await mkdir(path.dirname(dest), { recursive: true });
          await copyFile(src, dest);
        }
        const r = await engine.resolveClip(slug, {
          segmentId: segmentId.toUpperCase(), url: str(o.url) ?? null, uploadRel, startMs: parseMmSs(str(o.from), "--from"), endMs: parseMmSs(str(o.to), "--to"),
          channel: str(o.channel) ?? "", title: str(o.title) ?? "",
        });
        for (const i of r.issues) ctx.io.out(`${i.level} ${i.rule}: ${i.msg}\n`);
        ctx.io.out(`clip ${segmentId} resolved manually; re-run: docmaker run ${slug} --from assets\n`);
        return;
      }
      const slug = target;
      const p = await engine.getProject(slug);
      const patch: Partial<Project> = {};
      if (o.offline) patch.assets = { ...p.assets, offline: true };
      if (o.providers) {
        const ids = splitList(str(o.providers));
        const { AssetProviderId } = await import("@docmaker/core");
        for (const id of ids) if (!AssetProviderId.safeParse(id).success) throw new UsageError(`unknown provider ${id}`);
        patch.assets = { ...(patch.assets ?? p.assets), providers: ids as Project["assets"]["providers"] };
      }
      if (o.youtube === false) patch.assets = { ...(patch.assets ?? p.assets), providers: (patch.assets ?? p.assets).providers.filter((x) => x !== "youtube") };
      if (Object.keys(patch).length) {
        await engine.updateProject(slug, patch);
        ctx.io.out("project asset settings updated\n");
      }
      if (o.beat) {
        const { PicksDoc } = await import("@docmaker/core");
        const picks = await engine.readDoc(slug, P.picks, PicksDoc).then((d) => d.value).catch(() => null);
        const beat = str(o.beat)!.toUpperCase();
        for (const pk of picks?.picks.filter((x) => x.beatId === beat) ?? []) ctx.io.out(`${pk.beatId}#${pk.slot} ${pk.assetId.slice(0, 12)} ${pk.pickedBy} score ${pk.score.total.toFixed(2)}\n`);
        return;
      }
      process.exitCode = await runJob(ctx, stageJob(ctx, slug, "assets", { options: o.allowPaid ? { allowPaid: true } : {} }));
    });

  // ------------------------------------------------------------------ voice
  program
    .command("voice <target> [args...]")
    .description("voice <slug> [--scratch] [--provider …] | voice import <slug> <files…> | voice calibrate <slug> | voice teleprompter <slug>")
    .option("--lang <lang>")
    .option("--scratch", "free synthetic scratch take")
    .option("--provider <p>", "elevenlabs | kokoro | piper | synthetic")
    .option("--voice <id>")
    .option("--model <id>")
    .option("--speed <x>")
    .option("--segments <ids>")
    .option("--retry-bad")
    .option("--consent <statement>", "required for cloned ElevenLabs voices")
    .option("--per-segment", "import: files are named <segmentId>.*")
    .option("--aligner <a>", "import: faster-whisper | whisper-cpp | auto", "auto")
    .option("--pickup-tts <provider>", "import: fill missing segments with this TTS")
    .option("--out <file>", "teleprompter: output file")
    .option("--mirror", "teleprompter: mirrored text")
    .action(async (target: string, args: string[], o: Opts) => {
      const engine = await ctx.engine();
      const sub = ["import", "calibrate", "teleprompter"].includes(target) ? target : null;
      const slug = sub ? args[0] : target;
      if (!slug) throw new UsageError(`voice ${target} <slug>`);
      const project = await engine.getProject(slug);
      const lang = (parseLangs(str(o.lang), false)[0] ?? project.primaryLang) as Lang;
      if (sub === "calibrate") {
        const r = await engine.calibrate(slug, lang);
        ctx.io.out(`${lang}: ${r.charsPerSec.toFixed(2)} characters/second (saved in the project voice settings)\n`);
        return;
      }
      if (sub === "teleprompter") {
        const file = await engine.teleprompter(slug, lang, { mirror: o.mirror === true });
        if (o.out) await copyFile(file, path.resolve(str(o.out)!));
        ctx.io.out(`${o.out ? path.resolve(str(o.out)!) : file}\n`);
        return;
      }
      const cur = project.voice[lang];
      if (!cur) throw new UsageError(`${lang} is not a project language`);
      if (sub === "import") {
        const files = args.slice(1);
        if (files.length === 0) throw new UsageError("voice import <slug> <files…>");
        for (const f of files) {
          const seg = o.perSegment ? path.basename(f).replace(/\.[^.]+$/, "").toUpperCase() : null;
          if (seg && !/^CH\d+-S\d+$/.test(seg)) throw new UsageError(`--per-segment: ${path.basename(f)} is not named <segmentId>.<ext>`);
          await engine.upload(slug, { tmpPath: path.resolve(f), kind: "recording", lang, declaration: null, segmentId: seg });
        }
        const pickup = str(o.pickupTts);
        if (pickup && !["elevenlabs", "kokoro", "piper", "synthetic"].includes(pickup)) throw new UsageError("--pickup-tts must be elevenlabs, kokoro, piper or synthetic");
        await engine.updateProject(slug, { voice: { ...project.voice, [lang]: { ...cur, provider: "recording", pickupProvider: (pickup ?? cur.pickupProvider) as typeof cur.pickupProvider } } });
        process.exitCode = await runJob(ctx, stageJob(ctx, slug, "voice", { langs: [lang], options: { takeKind: "final", ...(pickup ? { pickupTts: true } : {}) } }));
        return;
      }
      const patch = { ...cur };
      let changed = false;
      if (o.provider) {
        if (!["elevenlabs", "kokoro", "piper", "synthetic"].includes(str(o.provider)!)) throw new UsageError("--provider must be elevenlabs, kokoro, piper or synthetic");
        patch.provider = str(o.provider) as typeof cur.provider;
        changed = true;
      }
      if (o.voice) { patch.voiceId = str(o.voice)!; changed = true; }
      if (o.model) { patch.modelId = str(o.model)!; changed = true; }
      if (o.speed) {
        const sp = Number(o.speed);
        if (!(sp >= 0.7 && sp <= 1.2)) throw new UsageError("--speed must be between 0.7 and 1.2");
        patch.speed = sp;
        changed = true;
      }
      if (o.consent) {
        const st = str(o.consent)!.trim();
        if (st.length < 20) throw new UsageError("--consent needs a statement of at least 20 characters");
        patch.cloneConsent = { declaredAt: new Date().toISOString(), statement: st };
        changed = true;
      }
      if (changed) await engine.updateProject(slug, { voice: { ...project.voice, [lang]: patch } });
      const segments = splitList(str(o.segments)).map((s) => s.toUpperCase());
      process.exitCode = await runJob(ctx, stageJob(ctx, slug, "voice", {
        langs: [lang], options: { takeKind: o.scratch ? "scratch" : "final", ...(segments.length ? { segments } : {}), ...(o.retryBad ? { retryBad: true } : {}) },
      }));
    });

  // ------------------------------------------------------------------ preview / render / export
  program
    .command("preview <slug>")
    .description("stills and a contact sheet of the current timeline")
    .option("--lang <lang>")
    .option("--sheet", "one contact sheet instead of separate stills")
    .option("--frames <list>", "frame numbers, e.g. 0,120,300")
    .option("--studio", "Remotion Studio with the timeline")
    .option("--web", "open the web preview")
    .action(async (slug: string, o: Opts) => {
      const engine = await ctx.engine();
      const project = await engine.getProject(slug);
      const lang = (parseLangs(str(o.lang), false)[0] ?? project.primaryLang) as Lang;
      if (o.studio || o.web) {
        ctx.io.out(o.web ? `pnpm dev:web, then open /projects/${slug}/preview\n` : "Remotion Studio: pnpm --filter @docmaker/remotion exec remotion studio src/entry.ts (load the timeline from the props panel)\n");
        return;
      }
      const { Timeline } = await import("@docmaker/core");
      const t = (await engine.readDoc(slug, P.timeline(lang), Timeline)).value;
      const frames = o.frames ? splitList(str(o.frames)).map(Number) : [0, Math.floor(t.durationInFrames / 2), t.durationInFrames - 1];
      if (frames.some((f) => !Number.isInteger(f) || f < 0 || f >= t.durationInFrames)) throw new UsageError(`--frames must be within 0…${t.durationInFrames - 1}`);
      const { InProcessRenderClient } = await import("@docmaker/render");
      const { loadRuntime, createLogger } = await import("@docmaker/core/node");
      const env = ctx.env();
      const { config } = loadRuntime({ cwd: env.DOCMAKER_REPO_ROOT ?? process.cwd(), env });
      const client = new InProcessRenderClient({ config, logger: createLogger({ level: "warn" }) });
      try {
        const outDir = path.join(engine.config.projectsDir, slug, "preview", lang);
        const files = await client.renderStills({ projectDir: path.join(engine.config.projectsDir, slug), timelineRel: P.timeline(lang), frames, outDir, scale: 0.5, sheet: o.sheet ? { cols: 4, width: 640, label: true } : null }, { onEvent: () => {}, signal: new AbortController().signal });
        for (const f of files) ctx.io.out(`${f}\n`);
      } finally {
        await client.close().catch(() => undefined);
      }
    });
  program
    .command("render <slug>")
    .description("render (editorial gates apply)")
    .option("--lang <langs>")
    .option("--preset <preset>")
    .option("--gl <mode>", "auto | swangle | angle | angle-egl (project setting)")
    .option("--concurrency <n>", "(project setting)")
    .option("--chunk-seconds <n>", "(project setting)")
    .option("--range <a:b>", "frame range")
    .option("--chapters <ids>")
    .action(async (slug: string, o: Opts) => {
      const engine = await ctx.engine();
      const p = await engine.getProject(slug);
      const render = { ...p.render };
      if (o.gl) {
        if (!["auto", "swangle", "angle", "angle-egl"].includes(str(o.gl)!)) throw new UsageError("--gl must be auto, swangle, angle or angle-egl");
        render.gl = str(o.gl) as typeof render.gl;
      }
      if (o.concurrency) {
        const n = Number(o.concurrency);
        if (!Number.isInteger(n) || n < 1) throw new UsageError("--concurrency must be a positive integer");
        render.concurrency = n;
      }
      if (o.chunkSeconds) {
        const n = Number(o.chunkSeconds);
        if (!Number.isInteger(n) || n < 10 || n > 600) throw new UsageError("--chunk-seconds must be 10…600");
        render.chunkSeconds = n;
      }
      if (JSON.stringify(render) !== JSON.stringify(p.render)) await engine.updateProject(slug, { render });
      const only = parseChapters(str(o.chapters));
      const range = parseRange(str(o.range));
      process.exitCode = await runJob(ctx, stageJob(ctx, slug, "render", {
        langs: parseLangs(str(o.lang)), preset: parsePreset(str(o.preset)), options: { ...(only ? { onlyChapters: only } : {}), ...(range ? { frameRange: range } : {}) },
      }));
    });
  program
    .command("export <slug>")
    .description("NLE export (no render needed)")
    .option("--lang <langs>")
    .option("--formats <list>", "(project setting)")
    .option("--overlays", "ProRes 4444 overlays (M3)")
    .option("--export-root <path>", "path prefix on the editing machine (project setting)")
    .option("--fcpxml-version <v>", "1.10 | 1.11 | 1.13 (project setting)")
    .action(async (slug: string, o: Opts) => {
      const engine = await ctx.engine();
      const p = await engine.getProject(slug);
      const ex = { ...p.export };
      if (o.formats) {
        const { ExportFormat } = await import("@docmaker/core");
        const fs = splitList(str(o.formats));
        for (const f of fs) if (!ExportFormat.safeParse(f).success) throw new UsageError(`unknown format ${f} (${ExportFormat.options.join(", ")})`);
        ex.formats = fs as typeof ex.formats;
      }
      if (o.exportRoot) ex.exportRoot = str(o.exportRoot)!;
      if (o.fcpxmlVersion) {
        if (!["1.10", "1.11", "1.13"].includes(str(o.fcpxmlVersion)!)) throw new UsageError("--fcpxml-version must be 1.10, 1.11 or 1.13");
        ex.fcpxmlVersion = str(o.fcpxmlVersion) as typeof ex.fcpxmlVersion;
      }
      if (JSON.stringify(ex) !== JSON.stringify(p.export)) await engine.updateProject(slug, { export: ex });
      process.exitCode = await runJob(ctx, stageJob(ctx, slug, "export", { langs: parseLangs(str(o.lang)), options: o.overlays ? { overlays: true } : {} }));
    });
}
