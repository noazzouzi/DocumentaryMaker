// Server-side listings the Engine API does not expose (takes of a language, export bundle files, small text files).
import "server-only";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Lang } from "@docmaker/core";

const TAKE_ID = /^(take|scratch)-[a-f0-9]{12}$/;

export async function listTakeIds(projectDir: string, lang: Lang): Promise<string[]> {
  try {
    const ents = await readdir(path.join(projectDir, "voice", lang), { withFileTypes: true });
    return ents.filter((e) => e.isDirectory() && TAKE_ID.test(e.name)).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

/** Files under export/<lang>/ (project-relative, sorted; media/ and stems/ summarised by count). */
export async function listExportFiles(projectDir: string, lang: Lang): Promise<{ rel: string; bytes: number }[]> {
  const root = path.join(projectDir, "export", lang);
  const out: { rel: string; bytes: number }[] = [];
  const walk = async (dir: string, depth: number) => {
    let ents;
    try {
      ents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 2) await walk(abs, depth + 1);
      } else if (e.isFile()) {
        const st = await stat(abs).catch(() => null);
        out.push({ rel: path.relative(projectDir, abs).split(path.sep).join("/"), bytes: st?.size ?? 0 });
      }
    }
  };
  await walk(root, 0);
  return out.sort((a, b) => a.rel.localeCompare(b.rel)).slice(0, 500);
}

/** A small project text file (≤ 1 MiB) or null; `rel` must be a fixed, code-chosen path. */
export async function readProjectText(projectDir: string, rel: string): Promise<string | null> {
  const abs = path.resolve(projectDir, rel);
  if (!abs.startsWith(path.resolve(projectDir) + path.sep)) return null;
  try {
    const st = await stat(abs);
    if (!st.isFile() || st.size > 1024 * 1024) return null;
    return await readFile(abs, "utf8");
  } catch {
    return null;
  }
}

export async function fileExists(projectDir: string, rel: string): Promise<boolean> {
  try {
    return (await stat(path.join(projectDir, rel))).isFile();
  } catch {
    return false;
  }
}
