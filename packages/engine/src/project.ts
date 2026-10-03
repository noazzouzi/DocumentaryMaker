// Project creation / update / listing (§4.2 defaults, LOCKED_AFTER_START, style confirmation, fixture projects).
import { existsSync, readdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  DocmakerError, LOCKED_AFTER_START, NewProjectInput, P, Project, canonicalJson, defaultProject, slugify, type Lang,
  type NewProjectInput as NewProjectInputT,
} from "@docmaker/core";
import { ProjectStore, readHomeConfig } from "@docmaker/core/node";
import type { Runtime } from "./runtime";
import { readState } from "./state";
import { nowIso } from "./util";

/** Installed local TTS models (presence only): <models>/kokoro/*, <models>/piper/<voice>/. */
export function detectModels(modelsDir: string): { kokoro: boolean; piper: boolean } {
  const has = (sub: string) => {
    try {
      return readdirSync(path.join(/*turbopackIgnore: true*/ modelsDir, sub), { withFileTypes: true }).some((d) => d.isDirectory());
    } catch {
      return false;
    }
  };
  return { kokoro: has("kokoro"), piper: has("piper") };
}

function uniqueSlug(projectsDir: string, base: string): string {
  const root = base || "project";
  if (!existsSync(path.join(/*turbopackIgnore: true*/ projectsDir, root, P.project))) return root;
  for (let n = 2; n < 1000; n++) {
    const s = `${root.slice(0, 44)}-${n}`;
    if (!existsSync(path.join(/*turbopackIgnore: true*/ projectsDir, s, P.project))) return s;
  }
  throw new DocmakerError("VALIDATION", `cannot find a free slug for ${root}`);
}

export async function createProjectIn(rt: Runtime, input: NewProjectInputT, extra?: (p: Project) => Project): Promise<Project> {
  const parsed = NewProjectInput.parse(input);
  const hc = await readHomeConfig(rt.config).catch(() => null);
  const models = detectModels(rt.config.paths.models);
  const explicitSlug = parsed.slug !== undefined;
  const slug = explicitSlug ? parsed.slug! : uniqueSlug(rt.config.projectsDir, slugify(parsed.idea));
  if (explicitSlug && existsSync(path.join(/*turbopackIgnore: true*/ rt.config.projectsDir, slug, P.project))) throw new DocmakerError("VALIDATION", `project ${slug} already exists`);
  let p = defaultProject({ ...input, slug, styleId: input.styleId ?? hc?.defaults.styleId ?? null }, new Date(), {
    hasElevenLabs: !!rt.secrets.elevenlabs, kokoro: models.kokoro, piper: models.piper,
    homeDefaults: hc ? { languages: hc.defaults.languages, targetMinutes: hc.defaults.targetMinutes } : null,
  });
  if (input.styleId === undefined && p.styleId !== null) p = { ...p, styleConfirmed: false }; // a home default is a suggestion, not a confirmation
  if (p.styleId) {
    const reg = await rt.styles();
    const style = reg.get(p.styleId); // unknown id → VALIDATION
    p = { ...p, captions: style.data.captionDNA.defaultMode };
  }
  if (p.llm.provider === "fixture") {
    const fx = await rt.fixture(p.llm.fixtureId);
    if (!fx) throw new DocmakerError("FIXTURE_MISSING", `fixture ${p.llm.fixtureId ?? "(none)"} not found under ${path.join(rt.config.repoRoot, "fixtures")}`);
    p = { ...p, editorial: { ...p.editorial, asOf: fx.asOf } };
  }
  if (extra) p = extra(p);
  const project = Project.parse(p);
  await ProjectStore.create(rt.config.projectsDir, project);
  return project;
}

/** True once any stage produced output (then LOCKED_AFTER_START fields are frozen). */
export async function projectStarted(store: ProjectStore): Promise<boolean> {
  const st = await readState(store);
  return st.stages.some((s) => s.status === "done" || s.artifacts.length > 0) || (await store.exists(P.dossier));
}

export async function updateProjectIn(rt: Runtime, slug: string, patch: Partial<Project>): Promise<Project> {
  const store = await ProjectStore.open(rt.config.projectsDir, slug);
  const cur = await store.readJson(P.project, Project);
  const started = await projectStarted(store);
  for (const k of LOCKED_AFTER_START) {
    if (!(k in patch)) continue;
    const v = (patch as Record<string, unknown>)[k];
    if (canonicalJson(v) === canonicalJson((cur as Record<string, unknown>)[k])) continue;
    if (k === "slug") throw new DocmakerError("VALIDATION", "the slug of a project cannot change");
    if (started) throw new DocmakerError("VALIDATION", `${k} cannot change once the pipeline has produced output`, { hint: "create a new project instead" });
  }
  const next: Record<string, unknown> = { ...cur, ...patch };
  for (const k of ["schemaVersion", "formatVersion", "slug", "createdAt"] as const) next[k] = cur[k];
  next.updatedAt = nowIso();
  if (patch.styleId !== undefined && patch.styleId !== cur.styleId) {
    if (patch.styleId !== null) (await rt.styles()).get(patch.styleId);
    next.styleConfirmed = patch.styleConfirmed ?? false;
  }
  if (patch.languages && !("primaryLang" in patch) && !patch.languages.includes(cur.primaryLang)) next.primaryLang = patch.languages[0];
  if (patch.languages) {
    const voice = { ...(next.voice as Project["voice"]) };
    for (const l of Object.keys(voice) as Lang[]) if (!patch.languages.includes(l)) delete voice[l];
    for (const l of patch.languages) if (!voice[l]) voice[l] = cur.voice[cur.primaryLang] ?? Object.values(cur.voice)[0];
    next.voice = voice;
  }
  const parsed = Project.safeParse(next);
  if (!parsed.success) throw new DocmakerError("VALIDATION", "invalid project settings", { details: parsed.error.issues });
  if (!parsed.data.languages.includes(parsed.data.primaryLang)) throw new DocmakerError("VALIDATION", `primaryLang ${parsed.data.primaryLang} is not a project language`);
  await store.writeJson(P.project, Project, parsed.data, { writer: "user" });
  return parsed.data;
}

export async function listProjectsIn(rt: Runtime): Promise<{ slug: string; title: string; updatedAt: string; languages: Lang[] }[]> {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await readdir(rt.config.projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: { slug: string; title: string; updatedAt: string; languages: Lang[] }[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const p = Project.safeParse(JSON.parse(await readFile(path.join(/*turbopackIgnore: true*/ rt.config.projectsDir, e.name, P.project), "utf8")));
      if (p.success && p.data.slug === e.name) out.push({ slug: p.data.slug, title: p.data.title, updatedAt: p.data.updatedAt, languages: p.data.languages });
    } catch { /* not a project */ }
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : a.slug < b.slug ? -1 : 1));
}
