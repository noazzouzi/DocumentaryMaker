// Test helpers: repo root (tests only — source code receives repoRoot from RuntimeConfig) and temp dirs.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach } from "vitest";

export const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
export const BUILTIN = join(REPO_ROOT, "packages", "styles", "builtin");

const dirs: string[] = [];
export async function tempDir(prefix = "styles-test-"): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

/** Real reference channel/creator names that must never appear in shipped style data. */
export const FORBIDDEN_NAMES = [
  "magnatesmedia", "magnates media", "sunnyv2", "sunny v2", "patrick cc", "internet anarchist", "lemmino", "johnny harris",
  "gaspard g", "vox", "netflix", "jcs", "moon",
];
