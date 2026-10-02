// Style discovery: built-in dirs + <home>/styles/* at runtime (no registration, no rebuild).
import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DocmakerError, hashJson, isDocmakerError, type LintIssue, type StylePlugin } from "@docmaker/core";
import { STYLE_FILES, loadStyleDir } from "./load";
import type { RejectedStyle, StyleRegistry, StyleSummary } from "./types";

/** <repoRoot>/packages/styles/builtin — never located through import.meta.resolve. */
export function builtinStylesDir(repoRoot: string): string {
  return join(resolve(repoRoot), "packages", "styles", "builtin");
}

/** Sub-directories of `root` that contain a style.json, sorted by name. Hidden (".x") and "_x" dirs are skipped. */
export async function listStyleDirs(root: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const out: string[] = [];
  for (const ent of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (ent.name.startsWith(".") || ent.name.startsWith("_")) continue;
    const dir = join(root, ent.name);
    let isDir = ent.isDirectory();
    if (ent.isSymbolicLink()) isDir = await stat(dir).then((s) => s.isDirectory(), () => false);
    if (!isDir) continue;
    if (await stat(join(dir, STYLE_FILES.data)).then((s) => s.isFile(), () => false)) out.push(dir);
  }
  return out;
}

export function summarize(p: StylePlugin): StyleSummary {
  const m = p.data.manifest;
  return {
    id: m.id, version: m.version, names: { ...m.names }, description: { ...m.description }, category: m.category,
    previewColor: m.previewColor, bestFor: [...m.bestFor], source: p.source, dir: p.dir,
  };
}

/** Registry hash: hashJson of the (id, dataHash) pairs sorted by id. */
export function registryHash(plugins: readonly StylePlugin[]): string {
  return hashJson([...plugins].map((p) => ({ id: p.data.manifest.id, dataHash: p.dataHash })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

/** Builds an immutable registry from loaded plugins. Duplicate ids → DocmakerError("VALIDATION"). */
export function createRegistry(plugins: readonly StylePlugin[], rejected: readonly RejectedStyle[] = []): StyleRegistry {
  const byId = new Map<string, StylePlugin>();
  for (const p of plugins) {
    const id = p.data.manifest.id;
    const prev = byId.get(id);
    if (prev) {
      throw new DocmakerError("VALIDATION", `duplicate style id "${id}": ${prev.dir} and ${p.dir}`, {
        hint: "user styles cannot shadow another style; rename manifest.id (and the directory) of one of them",
        details: { id, dirs: [prev.dir, p.dir] },
      });
    }
    byId.set(id, p);
  }
  const ids = [...byId.keys()].sort();
  const hash = registryHash(plugins);
  const frozenRejected = Object.freeze(rejected.map((r) => Object.freeze({ dir: r.dir, issues: [...r.issues] })));
  return Object.freeze({
    hash,
    rejected: frozenRejected,
    has: (id: string) => byId.has(id),
    get(id: string): StylePlugin {
      const p = byId.get(id);
      if (!p) {
        throw new DocmakerError("VALIDATION", `unknown style "${id}"`, { hint: `available styles: ${ids.join(", ") || "(none)"}`, details: { id, available: ids } });
      }
      return p;
    },
    list: () => ids.map((id) => summarize(byId.get(id)!)),
  });
}

/** builtin dirs + <home>/styles/* (user dirs shadow nothing: a duplicate id is a VALIDATION error). */
export async function discoverStyles(o: { repoRoot: string; userStylesDir: string | null }): Promise<StyleRegistry> {
  const plugins: StylePlugin[] = [];
  const builtinRoot = builtinStylesDir(o.repoRoot);
  const builtinDirs = await listStyleDirs(builtinRoot);
  if (builtinDirs.length === 0) {
    throw new DocmakerError("VALIDATION", `no built-in styles found in ${builtinRoot}`, { hint: "is repoRoot the DocumentaryMaker checkout?" });
  }
  // built-in styles ship with the code: any defect is a hard error
  for (const dir of builtinDirs) plugins.push(await loadStyleDir(dir, "builtin"));

  const rejected: RejectedStyle[] = [];
  if (o.userStylesDir !== null) {
    const userRoot = resolve(o.userStylesDir);
    if (userRoot === resolve(builtinRoot)) {
      throw new DocmakerError("VALIDATION", "userStylesDir must not be the built-in styles directory");
    }
    for (const dir of await listStyleDirs(userRoot)) {
      try {
        plugins.push(await loadStyleDir(dir, "user"));
      } catch (e) {
        // a broken user style must not take the app down: skip it and report why
        if (!isDocmakerError(e) || e.code !== "VALIDATION") throw e;
        const issues = (e.details as { issues?: LintIssue[] } | undefined)?.issues
          ?? [{ level: "error" as const, rule: "STYLE_LOAD", where: dir, msg: e.message }];
        rejected.push({ dir, issues });
      }
    }
  }
  return createRegistry(plugins, rejected);
}
