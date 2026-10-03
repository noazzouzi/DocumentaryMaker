// Uploads and local-directory imports. A declaration is mandatory; imports are never defaulted to USER-OWNED.
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { DocmakerError, LocalIndexDoc, UploadDeclaration } from "@docmaker/core";
import type { FrozenAsset } from "@docmaker/core";
import { ffprobeJson, sha256File } from "@docmaker/core/node";
import { conformAudio, conformImage, conformVideo } from "./conform";
import { freezeFile } from "./freeze";
import type { AssetsCtx } from "./types";
import { recordUserFrozen } from "./userfrozen";
import { extOf, kindOfExt, makeTmpDir, rmrf, tokensOf } from "./util";

/** Validates a declaration (400-equivalent VALIDATION when missing or malformed). */
export function requireDeclaration(d: unknown): UploadDeclaration {
  if (d === null || d === undefined) throw new DocmakerError("VALIDATION", "an upload declaration is required (own-work, licensed, third-party-quotation or ai-generated)");
  const r = UploadDeclaration.safeParse(d);
  if (!r.success) throw new DocmakerError("VALIDATION", `invalid upload declaration: ${r.error.issues.map((x) => x.message).join("; ")}`);
  const decl = r.data;
  if (decl.kind === "licensed" && (decl.license === null || decl.license === "USER-OWNED")) {
    throw new DocmakerError("VALIDATION", "a licensed upload must name its licence (use kind own-work for your own media)");
  }
  if ((decl.kind === "licensed" || decl.kind === "third-party-quotation") && decl.url.trim() === "" && decl.author.trim() === "") {
    throw new DocmakerError("VALIDATION", "licensed and third-party uploads need an author or a source URL");
  }
  return decl;
}

/** Kind by extension, then by content (ffprobe) for unknown extensions. */
export async function detectKind(file: string, ctx: Pick<AssetsCtx, "config" | "signal">): Promise<"image" | "video" | "audio"> {
  const byExt = kindOfExt(extOf(file));
  if (byExt) return byExt;
  const p = await ffprobeJson(file, { config: ctx.config, signal: ctx.signal });
  const v = p.streams.find((s) => s.codecType === "video");
  if (v && (p.durationSec > 0.5 || (v.nbFrames ?? 2) > 1)) return "video";
  if (v) return "image";
  if (p.streams.some((s) => s.codecType === "audio")) return "audio";
  throw new DocmakerError("VALIDATION", `${path.basename(file)} is not an image, video or audio file`);
}

export async function importUpload(i: { file: string; declaration: UploadDeclaration; projectDir: string }, ctx: AssetsCtx): Promise<FrozenAsset> {
  const declaration = requireDeclaration(i.declaration);
  const kind = await detectKind(i.file, ctx);
  const tmp = await makeTmpDir("upload");
  try {
    const conform = kind === "image" ? await conformImage(i.file, tmp, ctx)
      : kind === "video" ? await conformVideo(i.file, tmp, { fps: await projectFps(i.projectDir), inMs: null, outMs: null, handleMs: 0 }, ctx)
      : await conformAudio(i.file, tmp, { targetLufs: -18 }, ctx);
    const a = await freezeFile({ file: i.file, kind, role: "user", candidate: null, declaration, conform, projectDir: i.projectDir }, ctx);
    await recordUserFrozen(i.projectDir, a);
    return a;
  } finally {
    await rmrf(tmp);
  }
}

async function projectFps(projectDir: string): Promise<number> {
  try {
    const { readFile } = await import("node:fs/promises");
    const j = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")) as { video?: { fps?: number } };
    return j.video?.fps ?? 30;
  } catch {
    return 30;
  }
}

async function walk(dir: string, out: string[], depth = 0): Promise<void> {
  if (depth > 12) return;
  for (const name of (await readdir(dir)).sort()) {
    if (name.startsWith(".")) continue;
    const p = path.join(dir, name);
    const st = await lstat(p);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) await walk(p, out, depth + 1);
    else if (st.isFile() && kindOfExt(extOf(p))) out.push(p);
  }
}

/** Builds/merges assets/local-index.json (path, sha256, kind, filename tokens, tags, declaration). The engine writes it. */
export async function importLocalDir(i: { dir: string; declaration: UploadDeclaration; tags: string[]; projectDir: string; previous: LocalIndexDoc | null }, ctx: AssetsCtx): Promise<LocalIndexDoc> {
  const declaration = requireDeclaration(i.declaration);
  const root = path.resolve(i.dir);
  try {
    if (!(await lstat(root)).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new DocmakerError("VALIDATION", `${i.dir} is not a readable directory`);
  }
  const files: string[] = [];
  await walk(root, files);
  const bySha = new Map<string, LocalIndexDoc["files"][number]>((i.previous?.files ?? []).map((f) => [f.sha256, f]));
  const tags = [...new Set(i.tags.map((t) => t.trim()).filter(Boolean))];
  let n = 0;
  for (const f of files) {
    if (ctx.signal.aborted) throw new DocmakerError("CANCELED", "import canceled");
    ctx.progress(n++ / Math.max(1, files.length), `import ${path.basename(f)}`);
    const sha256 = await sha256File(f);
    const rel = path.relative(root, f).replace(/\.[^.]+$/, "");
    const prev = bySha.get(sha256);
    bySha.set(sha256, {
      path: f, sha256, kind: kindOfExt(extOf(f))!, tokens: [...new Set(tokensOf(rel.replace(/[_\-./\\]+/g, " ")))],
      tags: [...new Set([...(prev?.tags ?? []), ...tags])].sort(), declaration,
    });
  }
  return LocalIndexDoc.parse({ schemaVersion: 1, files: [...bySha.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) });
}
