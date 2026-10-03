import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { computeCodeHash } from "../src/bundle";
import { repoRoot, tmpDir } from "./helpers";

/** A minimal fake repo: remotion/core sources + manifests pinning remotion/@fontsource. */
async function fakeRepo(dir: string): Promise<void> {
  await mkdir(path.join(dir, "packages/remotion/src/lib"), { recursive: true });
  await mkdir(path.join(dir, "packages/core/src/node"), { recursive: true });
  await mkdir(path.join(dir, "packages/core/src/util"), { recursive: true });
  await mkdir(path.join(dir, "packages/render"), { recursive: true });
  await writeFile(path.join(dir, "packages/remotion/src/entry.ts"), "registerRoot(Root);\n");
  await writeFile(path.join(dir, "packages/remotion/src/lib/a.ts"), "export const a = 1;\n");
  await writeFile(path.join(dir, "packages/core/src/util/x.ts"), "export const x = 1;\n");
  await writeFile(path.join(dir, "packages/core/src/node/store.ts"), "export const store = 1;\n");
  await writeFile(path.join(dir, "packages/remotion/package.json"), JSON.stringify({ dependencies: { remotion: "4.0.532", "@fontsource/inter": "5.3.0", "d3-geo": "3.1.1" } }));
  await writeFile(path.join(dir, "packages/render/package.json"), JSON.stringify({ dependencies: { "@remotion/renderer": "4.0.532", sharp: "0.35.5" } }));
}

describe("computeCodeHash (§12.1)", () => {
  it("is a stable sha256 of the real repo", async () => {
    const a = await computeCodeHash(repoRoot());
    const b = await computeCodeHash(repoRoot());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it("changes with remotion/core sources and pinned versions, ignores core/src/node and unpinned deps", async () => {
    const t = await tmpDir();
    try {
      await fakeRepo(t.dir);
      const h0 = await computeCodeHash(t.dir);
      expect(await computeCodeHash(t.dir)).toBe(h0);
      // core/src/node is excluded
      await writeFile(path.join(t.dir, "packages/core/src/node/store.ts"), "export const store = 2;\n");
      expect(await computeCodeHash(t.dir)).toBe(h0);
      // an unpinned dependency does not count
      await writeFile(path.join(t.dir, "packages/render/package.json"), JSON.stringify({ dependencies: { "@remotion/renderer": "4.0.532", sharp: "9.9.9" } }));
      expect(await computeCodeHash(t.dir)).toBe(h0);
      // a pinned version does
      await writeFile(path.join(t.dir, "packages/render/package.json"), JSON.stringify({ dependencies: { "@remotion/renderer": "4.0.533", sharp: "9.9.9" } }));
      const h1 = await computeCodeHash(t.dir);
      expect(h1).not.toBe(h0);
      // remotion source content
      await writeFile(path.join(t.dir, "packages/remotion/src/lib/a.ts"), "export const a = 2;\n");
      const h2 = await computeCodeHash(t.dir);
      expect(h2).not.toBe(h1);
      // core source content
      await writeFile(path.join(t.dir, "packages/core/src/util/x.ts"), "export const x = 2;\n");
      const h3 = await computeCodeHash(t.dir);
      expect(h3).not.toBe(h2);
      // a rename with identical content changes the hash (paths are hashed)
      await cp(path.join(t.dir, "packages/remotion/src/lib/a.ts"), path.join(t.dir, "packages/remotion/src/lib/b.ts"));
      await rm(path.join(t.dir, "packages/remotion/src/lib/a.ts"));
      expect(await computeCodeHash(t.dir)).not.toBe(h3);
    } finally {
      await t.cleanup();
    }
  });

  it("does not depend on the directory where the repo lives", async () => {
    const a = await tmpDir();
    const b = await tmpDir();
    try {
      await fakeRepo(a.dir);
      await fakeRepo(b.dir);
      expect(await computeCodeHash(a.dir)).toBe(await computeCodeHash(b.dir));
      expect(await readFile(path.join(a.dir, "packages/remotion/src/entry.ts"), "utf8")).toContain("registerRoot");
    } finally {
      await a.cleanup();
      await b.cleanup();
    }
  });

  it("refuses a repo without Remotion sources", async () => {
    const t = await tmpDir();
    try {
      await expect(computeCodeHash(t.dir)).rejects.toMatchObject({ code: "UPSTREAM_MISSING" });
    } finally {
      await t.cleanup();
    }
  });
});
