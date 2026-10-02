// Loading a data-only style directory: style.json, STYLE.md, GUIDE.md, prompts.json, optional fonts/font.json.
import { readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import {
  BUILTIN_FONT_FAMILIES, DocmakerError, StyleData, StyleFont, StylePrompts, hashJson,
  type LintIssue, type PromptPack, type StylePlugin,
} from "@docmaker/core";
import { lintStyleData } from "./validate";
import { lintPromptPack } from "./promptPack";

export const STYLE_FILES = { data: "style.json", styleMd: "STYLE.md", guideMd: "GUIDE.md", prompts: "prompts.json", fontsDir: "fonts", fontJson: "fonts/font.json" } as const;
/** Font file types a style may ship (served by the asset server, loaded with @remotion/fonts). */
export const STYLE_FONT_EXTENSIONS: readonly string[] = [".woff2", ".woff", ".ttf", ".otf"];
/** font.json is either an array of StyleFont or { fonts: StyleFont[] } (zod is reached through core's schemas only). */
const FontList = StyleFont.array();

/** Everything read from a style dir, before deciding whether it is loadable. */
export interface StyleDirReport {
  dir: string;
  issues: LintIssue[]; // errors make loadStyleDir throw
  data: StyleData | null;
  promptPack: PromptPack | null;
  fonts: StyleFont[];
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}
async function readText(dir: string, rel: string, issues: LintIssue[]): Promise<string | null> {
  try {
    return await readFile(join(dir, rel), "utf8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    issues.push({ level: "error", rule: "STYLE_FILE_MISSING", where: rel, msg: code === "ENOENT" ? `${rel} is missing` : `${rel} is unreadable (${code ?? String(e)})` });
    return null;
  }
}
function parseJson(text: string, rel: string, issues: LintIssue[]): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    issues.push({ level: "error", rule: "STYLE_JSON", where: rel, msg: `${rel} is not valid JSON: ${(e as Error).message}` });
    return undefined;
  }
}
type SchemaError = { issues: readonly { path: readonly PropertyKey[]; message: string }[] };
const zodIssues = (rel: string, error: SchemaError): LintIssue[] =>
  error.issues.map((i) => ({ level: "error" as const, rule: "STYLE_SCHEMA", where: i.path.length ? `${rel}:${i.path.map(String).join(".")}` : rel, msg: i.message }));

async function readFonts(dir: string, issues: LintIssue[]): Promise<StyleFont[]> {
  const fontsDir = join(dir, STYLE_FILES.fontsDir);
  if (!(await exists(join(dir, STYLE_FILES.fontJson)))) {
    if (await exists(fontsDir)) issues.push({ level: "warn", rule: "STYLE_FONTS_UNDECLARED", where: STYLE_FILES.fontsDir, msg: "fonts/ exists but has no font.json; its files are ignored" });
    return [];
  }
  const text = await readText(dir, STYLE_FILES.fontJson, issues);
  if (text === null) return [];
  const raw = parseJson(text, STYLE_FILES.fontJson, issues);
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : raw !== null && typeof raw === "object" ? (raw as { fonts?: unknown }).fonts : undefined;
  if (!Array.isArray(list)) {
    issues.push({ level: "error", rule: "STYLE_SCHEMA", where: STYLE_FILES.fontJson, msg: "font.json must be an array of fonts or { \"fonts\": [...] }" });
    return [];
  }
  const parsed = FontList.safeParse(list);
  if (!parsed.success) { issues.push(...zodIssues(STYLE_FILES.fontJson, parsed.error)); return []; }
  const fonts = parsed.data;
  const keys = new Set<string>();
  for (const f of fonts) {
    const where = `${STYLE_FILES.fontJson}:${f.family}/${f.weight}/${f.style}`;
    const key = `${f.family}|${f.weight}|${f.style}`;
    if (keys.has(key)) issues.push({ level: "error", rule: "STYLE_FONT_DUPLICATE", where, msg: "the same family/weight/style is declared twice" });
    keys.add(key);
    // a font file is a plain name inside fonts/ (no traversal, no absolute path): the asset server mounts only that dir
    const norm = normalize(f.file);
    if (isAbsolute(f.file) || norm.startsWith("..") || norm.split(sep).includes("..") || f.file.includes("\\")) {
      issues.push({ level: "error", rule: "STYLE_FONT_PATH", where, msg: `font file "${f.file}" must be a relative path inside fonts/` });
      continue;
    }
    if (!STYLE_FONT_EXTENSIONS.includes(extname(f.file).toLowerCase())) {
      issues.push({ level: "error", rule: "STYLE_FONT_TYPE", where, msg: `font file "${f.file}" must be one of ${STYLE_FONT_EXTENSIONS.join(", ")}` });
      continue;
    }
    if (!(await exists(join(fontsDir, norm)))) {
      issues.push({ level: "error", rule: "STYLE_FONT_FILE", where, msg: `font file fonts/${f.file} does not exist` });
    }
  }
  return fonts;
}

/** Reads and lints a style directory without throwing (for `docmaker style validate` and the web gallery). */
export async function inspectStyleDir(dir: string): Promise<StyleDirReport> {
  const abs = resolve(dir);
  const issues: LintIssue[] = [];
  const fonts = await readFonts(abs, issues);

  let data: StyleData | null = null;
  const dataText = await readText(abs, STYLE_FILES.data, issues);
  if (dataText !== null) {
    const raw = parseJson(dataText, STYLE_FILES.data, issues);
    if (raw !== undefined) {
      const lint = lintStyleData(raw, { fontFamilies: BUILTIN_FONT_FAMILIES, styleFonts: fonts });
      issues.push(...lint.map((i) => ({ ...i, where: `${STYLE_FILES.data}:${i.where}` })));
      const parsed = StyleData.safeParse(raw);
      if (parsed.success) data = parsed.data;
    }
  }

  let prompts: StylePrompts | null = null;
  const promptsText = await readText(abs, STYLE_FILES.prompts, issues);
  if (promptsText !== null) {
    const raw = parseJson(promptsText, STYLE_FILES.prompts, issues);
    if (raw !== undefined) {
      const parsed = StylePrompts.safeParse(raw);
      if (parsed.success) prompts = parsed.data;
      else issues.push(...zodIssues(STYLE_FILES.prompts, parsed.error));
    }
  }
  const styleMd = await readText(abs, STYLE_FILES.styleMd, issues);
  const guideMd = await readText(abs, STYLE_FILES.guideMd, issues);
  let promptPack: PromptPack | null = null;
  if (prompts && styleMd !== null && guideMd !== null) {
    promptPack = {
      qualityDirective: prompts.qualityDirective,
      visualGrammar: prompts.visualGrammar,
      narratorPersona: { en: prompts.narratorPersona.en, fr: prompts.narratorPersona.fr },
      styleMd: styleMd.replace(/^﻿/, ""),
      guideMd: guideMd.replace(/^﻿/, ""),
    };
    issues.push(...lintPromptPack(promptPack));
  }
  if (data && data.manifest.id !== basename(abs)) {
    issues.push({ level: "warn", rule: "STYLE_DIR_NAME", where: STYLE_FILES.data, msg: `manifest.id "${data.manifest.id}" differs from the directory name "${basename(abs)}"` });
  }
  return { dir: abs, issues, data, promptPack, fonts };
}

/** Deep-freezes plain data so a shared StylePlugin cannot be mutated by one consumer behind another's back. */
function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v as Record<string, unknown>)) deepFreeze(x);
  }
  return v;
}

export function formatIssues(issues: readonly LintIssue[]): string {
  return issues.map((i) => `  ${i.level} ${i.rule} @ ${i.where}: ${i.msg}`).join("\n");
}

/** Reads style.json (StyleData), STYLE.md, GUIDE.md, prompts.json (StylePrompts), optional fonts/font.json; validates. */
export async function loadStyleDir(dir: string, source: "builtin" | "user"): Promise<StylePlugin> {
  const rep = await inspectStyleDir(dir);
  const errors = rep.issues.filter((i) => i.level === "error");
  if (errors.length > 0 || !rep.data || !rep.promptPack) {
    throw new DocmakerError("VALIDATION", `invalid style directory ${rep.dir} (${errors.length} error(s))\n${formatIssues(errors)}`, {
      hint: "run `docmaker style validate <dir>` for the full report",
      details: { dir: rep.dir, issues: rep.issues },
    });
  }
  const data = rep.data, promptPack = rep.promptPack, fonts = rep.fonts;
  const dataHash = hashJson({ data, promptPack, fonts });
  return deepFreeze({ data, promptPack, dir: rep.dir, source, fonts, dataHash });
}
