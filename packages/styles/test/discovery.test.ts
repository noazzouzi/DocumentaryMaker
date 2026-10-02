import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DocmakerError, hashJson, stableStringify, type StyleData } from "@docmaker/core";
import { builtinStylesDir, discoverStyles, inspectStyleDir, loadStyleDir, styleFontAssets } from "../src/index";
import { BUILTIN, REPO_ROOT, tempDir } from "./helpers";

const DRAMA = join(BUILTIN, "drama-commentary");

/** Copies drama into <root>/<id> with manifest.id = id (and an optional data tweak). */
async function userStyle(root: string, id: string, tweak?: (d: StyleData) => void): Promise<string> {
  const dir = join(root, id);
  await cp(DRAMA, dir, { recursive: true });
  const d = JSON.parse(await readFile(join(dir, "style.json"), "utf8")) as StyleData;
  d.manifest.id = id;
  tweak?.(d);
  await writeFile(join(dir, "style.json"), stableStringify(d));
  return dir;
}
async function expectValidation(p: Promise<unknown>, re: RegExp): Promise<DocmakerError> {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(DocmakerError);
  expect((e as DocmakerError).code).toBe("VALIDATION");
  expect((e as DocmakerError).message).toMatch(re);
  return e as DocmakerError;
}

describe("builtinStylesDir", () => {
  it("is <repoRoot>/packages/styles/builtin", () => {
    expect(builtinStylesDir("/repo")).toBe("/repo/packages/styles/builtin");
    expect(builtinStylesDir(REPO_ROOT)).toBe(BUILTIN);
  });
});

describe("loadStyleDir", () => {
  it("loads a style with a deterministic dataHash = hashJson({data, promptPack, fonts})", async () => {
    const a = await loadStyleDir(DRAMA, "builtin");
    const b = await loadStyleDir(DRAMA, "builtin");
    expect(a.dataHash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.dataHash).toBe(b.dataHash);
    expect(a.dataHash).toBe(hashJson({ data: a.data, promptPack: a.promptPack, fonts: a.fonts }));
    expect(a.source).toBe("builtin");
    expect(a.dir).toBe(DRAMA);
    expect(a.fonts).toEqual([]);
    expect(Object.isFrozen(a.data.manifest)).toBe(true);
  });

  it("dataHash changes with the prompt pack", async () => {
    const root = await tempDir();
    const dir = await userStyle(root, "drama-commentary");
    const before = (await loadStyleDir(dir, "user")).dataHash;
    await writeFile(join(dir, "GUIDE.md"), (await readFile(join(dir, "GUIDE.md"), "utf8")) + "\nOne more rule.\n");
    expect((await loadStyleDir(dir, "user")).dataHash).not.toBe(before);
  });

  it("rejects missing files, bad JSON and invalid data with VALIDATION and an issue list", async () => {
    const root = await tempDir();
    const dir = await userStyle(root, "broken");
    await rm(join(dir, "GUIDE.md"));
    const e1 = await expectValidation(loadStyleDir(dir, "user"), /invalid style directory/);
    expect((e1.details as { issues: { rule: string }[] }).issues.map((i) => i.rule)).toContain("STYLE_FILE_MISSING");
    await writeFile(join(dir, "GUIDE.md"), "# Guide\n");
    await writeFile(join(dir, "prompts.json"), "{ nope");
    await expectValidation(loadStyleDir(dir, "user"), /STYLE_JSON/);
    await cp(join(DRAMA, "prompts.json"), join(dir, "prompts.json"));
    const d = JSON.parse(await readFile(join(dir, "style.json"), "utf8")) as StyleData;
    d.tokens.fonts.body = "Papyrus";
    await writeFile(join(dir, "style.json"), stableStringify(d));
    await expectValidation(loadStyleDir(dir, "user"), /STYLE_FONT_UNKNOWN/);
  });

  it("reports (as warnings) a terse GUIDE.md and a dir name ≠ manifest.id", async () => {
    const root = await tempDir();
    const dir = await userStyle(root, "terse");
    await writeFile(join(dir, "GUIDE.md"), "# Guide\n\nBe good.\n");
    await rm(join(dir, "fonts"), { recursive: true, force: true });
    const renamed = join(root, "other-name");
    await cp(dir, renamed, { recursive: true });
    const rep = await inspectStyleDir(renamed);
    expect(rep.issues.filter((i) => i.level === "error")).toEqual([]);
    const rules = rep.issues.map((i) => i.rule);
    expect(rules).toContain("STYLE_GUIDE_SECTION");
    expect(rules).toContain("STYLE_DIR_NAME");
    await expect(loadStyleDir(renamed, "user")).resolves.toBeTruthy();
  });

  it("style fonts (M2): declared OFL fonts extend the allowed families and map to asset-server paths", async () => {
    const root = await tempDir();
    const dir = await userStyle(root, "noir", (d) => { d.tokens.fonts.headline = "Bebas Neue"; });
    await expectValidation(loadStyleDir(dir, "user"), /Bebas Neue/);
    await mkdir(join(dir, "fonts"), { recursive: true });
    await writeFile(join(dir, "fonts", "BebasNeue-Regular.woff2"), new Uint8Array([0x77, 0x4f, 0x46, 0x32]));
    await writeFile(join(dir, "fonts", "font.json"), JSON.stringify([{ family: "Bebas Neue", weight: 400, style: "normal", file: "BebasNeue-Regular.woff2", license: "OFL-1.1" }]));
    const p = await loadStyleDir(dir, "user");
    expect(p.fonts).toHaveLength(1);
    expect(styleFontAssets(p)).toEqual([{ family: "Bebas Neue", weight: 400, style: "normal", relPath: "styles/noir/fonts/BebasNeue-Regular.woff2" }]);
    expect(styleFontAssets(await loadStyleDir(DRAMA, "builtin"))).toEqual([]);

    await writeFile(join(dir, "fonts", "font.json"), JSON.stringify({ fonts: [{ family: "Bebas Neue", weight: 400, style: "normal", file: "../../escape.woff2", license: "OFL-1.1" }] }));
    await expectValidation(loadStyleDir(dir, "user"), /STYLE_FONT_PATH/);
    await writeFile(join(dir, "fonts", "font.json"), JSON.stringify([{ family: "Bebas Neue", weight: 400, style: "normal", file: "missing.woff2", license: "OFL-1.1" }]));
    await expectValidation(loadStyleDir(dir, "user"), /STYLE_FONT_FILE/);
    await writeFile(join(dir, "fonts", "font.json"), JSON.stringify([{ family: "Bebas Neue", weight: 400, style: "normal", file: "BebasNeue-Regular.woff2", license: "Proprietary" }]));
    await expectValidation(loadStyleDir(dir, "user"), /STYLE_SCHEMA/);
  });
});

describe("discoverStyles", () => {
  it("finds the built-in styles; a missing or null user dir is fine", async () => {
    const a = await discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: null });
    const b = await discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: join(await tempDir(), "does-not-exist") });
    expect(a.has("drama-commentary")).toBe(true);
    expect(a.list().every((s) => s.source === "builtin")).toBe(true);
    expect(a.hash).toBe(b.hash);
    const ids = a.list().map((s) => s.id);
    expect(ids).toEqual([...ids].sort());
    expect(a.get("drama-commentary").data.manifest.id).toBe("drama-commentary");
    expect(() => a.get("nope")).toThrowError(expect.objectContaining({ code: "VALIDATION" }) as unknown as Error);
  });

  it("registry.hash = hashJson of sorted (id, dataHash)", async () => {
    const r = await discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: null });
    const expected = hashJson(r.list().map((s) => ({ id: s.id, dataHash: r.get(s.id).dataHash })));
    expect(r.hash).toBe(expected);
  });

  it("adds user styles, skips hidden/_ dirs and loose files, and changes the hash", async () => {
    const root = await tempDir();
    await userStyle(root, "my-drama");
    await userStyle(root, "_draft");
    await mkdir(join(root, ".cache"));
    await writeFile(join(root, "notes.txt"), "x");
    await mkdir(join(root, "empty-dir"));
    const base = await discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: null });
    const r = await discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: root });
    expect(r.has("my-drama")).toBe(true);
    expect(r.has("_draft")).toBe(false);
    expect(r.list().find((s) => s.id === "my-drama")).toMatchObject({ source: "user", dir: join(root, "my-drama"), category: "commentary" });
    expect(r.hash).not.toBe(base.hash);
    expect(r.rejected).toEqual([]);
  });

  it("a duplicate id (user shadowing a built-in, or two user dirs) is a VALIDATION error", async () => {
    const root = await tempDir();
    await userStyle(root, "drama-commentary");
    await expectValidation(discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: root }), /duplicate style id "drama-commentary"/);
    const root2 = await tempDir();
    await userStyle(root2, "a-style");
    await userStyle(root2, "b-style", (d) => { d.manifest.id = "a-style"; });
    await expectValidation(discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: root2 }), /duplicate style id "a-style"/);
  });

  it("an invalid user style is skipped and reported, not fatal", async () => {
    const root = await tempDir();
    await userStyle(root, "good-one");
    await userStyle(root, "bad-one", (d) => { d.scriptProfile.storyShapes[0]!.acts[0]!.share = 0.5; });
    const r = await discoverStyles({ repoRoot: REPO_ROOT, userStylesDir: root });
    expect(r.has("good-one")).toBe(true);
    expect(r.has("bad-one")).toBe(false);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected![0]!.dir).toBe(join(root, "bad-one"));
    expect(r.rejected![0]!.issues.map((i) => i.rule)).toContain("STYLE_ACT_SHARES");
  });

  it("fails loudly when repoRoot has no built-in styles", async () => {
    await expectValidation(discoverStyles({ repoRoot: await tempDir(), userStylesDir: null }), /no built-in styles/);
  });
});
