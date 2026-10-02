import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StyleData } from "@docmaker/core";
import { discoverStyles, loadStyleDir, scaffoldStyle } from "../src/index";
import { REPO_ROOT, tempDir } from "./helpers";

describe("scaffoldStyle", () => {
  it("round trip: copy → rewritten manifest → discovered as a user style", async () => {
    const home = await tempDir();
    const stylesRoot = join(home, "styles"); // does not exist yet
    const registry = await discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: stylesRoot });
    const dir = await scaffoldStyle({ registry, fromId: "drama-commentary", newId: "my-drama", destDir: stylesRoot });
    expect(dir).toBe(join(stylesRoot, "my-drama"));
    expect((await readdir(dir)).sort()).toEqual(["GUIDE.md", "STYLE.md", "prompts.json", "style.json"]);
    expect(await readdir(stylesRoot)).toEqual(["my-drama"]); // no temp dir left behind

    const data = StyleData.parse(JSON.parse(await readFile(join(dir, "style.json"), "utf8")));
    const base = registry.get("drama-commentary");
    expect(data.manifest.id).toBe("my-drama");
    expect(data.manifest.names).toEqual({ en: "My drama", fr: "My drama" });
    expect(data.manifest.description.en).toContain("Based on Drama / commentary");
    expect({ ...data, manifest: null }).toEqual({ ...base.data, manifest: null });
    expect(await readFile(join(dir, "STYLE.md"), "utf8")).toBe(base.promptPack.styleMd);

    const p = await loadStyleDir(dir, "user");
    expect(p.source).toBe("user");
    const again = await discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: stylesRoot });
    expect(again.has("my-drama")).toBe(true);
    expect(again.get("my-drama").dataHash).toBe(p.dataHash);
    expect(again.hash).not.toBe(registry.hash);
  });

  it("refuses invalid ids, existing ids, unknown bases and existing targets", async () => {
    const stylesRoot = await tempDir();
    const registry = await discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: stylesRoot });
    const run = (newId: string, fromId = "drama-commentary") => scaffoldStyle({ registry, fromId, newId, destDir: stylesRoot });
    for (const bad of ["My Style", "-x", "a--b", "x/../y", ""]) await expect(run(bad)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(run("drama-commentary")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(run("new-one", "no-such-style")).rejects.toMatchObject({ code: "VALIDATION" });
    await run("taken");
    const before = await stat(join(stylesRoot, "taken", "style.json"));
    await expect(run("taken")).rejects.toMatchObject({ code: "VALIDATION" }); // registry is stale, the dir check still guards
    expect((await stat(join(stylesRoot, "taken", "style.json"))).mtimeMs).toBe(before.mtimeMs);
  });
});
