// Remotion code hash for render staleness (§5.1 "remotion codeHash"). The engine never imports @docmaker/render, so it
// computes its own hash with the same inputs as render's computeCodeHash (§12.1): sorted [path, sha256(content)] of
// packages/remotion/src/** and packages/core/src/** (minus src/node/**) + the pinned remotion/@remotion/@fontsource
// versions. Only equality matters here (it decides whether render is stale), not equality with the bundle hash.
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

async function walk(root: string, rel: string, skip: (rel: string) => boolean, out: string[]): Promise<void> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (skip(r)) continue;
    if (e.isDirectory()) await walk(root, r, skip, out);
    else if (e.isFile()) out.push(r);
  }
}

let memo: { key: string; hash: string } | null = null;

export async function remotionCodeHash(repoRoot: string): Promise<string> {
  const files: string[] = [];
  await walk(repoRoot, "packages/remotion/src", () => false, files);
  await walk(repoRoot, "packages/core/src", (r) => r === "packages/core/src/node", files);
  files.sort();
  // cheap memo key: paths + sizes + mtimes (the content hash is recomputed only when one of them changes)
  const stats = await Promise.all(files.map(async (f) => {
    const s = await stat(path.join(repoRoot, f));
    return `${f}:${s.size}:${s.mtimeMs}`;
  }));
  const pkgText = await readFile(path.join(repoRoot, "packages/remotion/package.json"), "utf8").catch(() => "{}");
  const key = createHash("sha256").update(stats.join("\n")).update(pkgText).digest("hex");
  if (memo?.key === key) return memo.hash;
  const h = createHash("sha256");
  for (const f of files) {
    const c = await readFile(path.join(repoRoot, f));
    h.update(`${f}\0${createHash("sha256").update(c).digest("hex")}\n`);
  }
  const pkg = JSON.parse(pkgText) as { dependencies?: Record<string, string> };
  const pins = Object.entries(pkg.dependencies ?? {}).filter(([n]) => n === "remotion" || n.startsWith("@remotion/") || n.startsWith("@fontsource/")).sort();
  h.update(JSON.stringify(pins));
  const hash = h.digest("hex");
  memo = { key, hash };
  return hash;
}
