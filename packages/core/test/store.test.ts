import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FactSheet, P, Project, Script, Timeline, UserPicksDoc, isDocmakerError, registerMigration } from "../src/index";
import { ProjectStore, listLangFiles } from "../src/node/index";
import { makeFactSheet, makeProject, makeScript, makeTimeline } from "../src/testing/index";

let root: string;
let store: ProjectStore;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "docmaker-store-"));
  store = await ProjectStore.create(root, makeProject());
});
afterEach(() => undefined);

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return isDocmakerError(e) ? e.code : String(e);
  }
};

describe("ProjectStore", () => {
  it("create/open round trip; refuses duplicates and unknown slugs", async () => {
    expect(store.slug).toBe("tulip-mania");
    const again = await ProjectStore.open(root, "tulip-mania");
    expect((await again.readJson(P.project, Project)).slug).toBe("tulip-mania");
    expect(await code(ProjectStore.create(root, makeProject()))).toBe("VALIDATION");
    expect(await code(ProjectStore.open(root, "nope"))).toBe("UPSTREAM_MISSING");
    expect(await code(ProjectStore.open(root, "../etc"))).toBe("VALIDATION");
  });
  it("writes atomically with stable formatting and compacts large generated docs", async () => {
    const s = makeScript();
    const r = await store.writeJson(P.script("en"), Script, s, { writer: "stage", stage: "script" });
    expect(r.changed).toBe(true);
    const text = await readFile(store.abs(P.script("en")), "utf8");
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.split("\n")[1]).toMatch(/^ {2}"/);
    const files = await readdir(path.dirname(store.abs(P.script("en"))));
    expect(files.filter((f) => f.includes(".tmp-"))).toEqual([]);
    await store.writeJson(P.timeline("en"), Timeline, makeTimeline({ seconds: 5 }), { writer: "stage", stage: "direct" });
    const t = await readFile(store.abs(P.timeline("en")), "utf8");
    expect(t.split("\n").length).toBe(2);
    expect(await store.etag(P.script("en"))).toBe(r.etag);
  });
  it("skips the write when only volatile fields changed (docHash rule)", async () => {
    const s = makeScript();
    const a = await store.writeJson(P.script("en"), Script, s, { writer: "stage", stage: "script" });
    const m1 = (await stat(store.abs(P.script("en")))).mtimeMs;
    await new Promise((r) => setTimeout(r, 15));
    const b = await store.writeJson(P.script("en"), Script, { ...s, updatedAt: "2030-01-01T00:00:00.000Z" }, { writer: "stage", stage: "script" });
    expect(b).toEqual({ etag: a.etag, docHash: a.docHash, changed: false });
    expect((await stat(store.abs(P.script("en")))).mtimeMs).toBe(m1);
    const c = await store.writeJson(P.script("en"), Script, { ...s, title: "Other" }, { writer: "stage", stage: "script" });
    expect(c.changed).toBe(true);
    expect(await store.docHashOf(P.script("en"))).toBe(c.docHash);
  });
  it("refuses writes by non-owners", async () => {
    expect(await code(store.writeJson(P.script("en"), Script, makeScript(), { writer: "stage", stage: "beats" }))).toBe("VALIDATION");
    expect(await code(store.writeJson(P.timeline("en"), Timeline, makeTimeline({ seconds: 5 }), { writer: "user" }))).toBe("VALIDATION");
    expect(await code(store.writeJson(P.userPicks, UserPicksDoc, { schemaVersion: 1, picks: [], portraits: [], clips: [] }, { writer: "stage", stage: "assets" }))).toBe("VALIDATION");
    expect(await code(store.writeJson(P.userPicks, UserPicksDoc, { schemaVersion: 1, picks: [], portraits: [], clips: [] }, { writer: "user" }))).toBe("ok");
    expect(await code(store.writeJson(P.state, Script, makeScript(), { writer: "engine" }))).toBe("VALIDATION"); // schema mismatch
  });
  it("rejects invalid values with VALIDATION", async () => {
    expect(await code(store.writeJson(P.factsheet, FactSheet, { ...makeFactSheet(), asOf: "yesterday" }, { writer: "stage", stage: "research" }))).toBe("VALIDATION");
  });
  it("keeps the last 20 versions of user-edited docs and can revert", async () => {
    const s = makeScript();
    await store.writeJson(P.script("en"), Script, s, { writer: "stage", stage: "script" });
    for (let i = 0; i < 23; i++) await store.writeJson(P.script("en"), Script, { ...s, title: `v${i}` }, { writer: "user" });
    const h = await store.history(P.script("en"));
    expect(h).toHaveLength(20);
    expect(h[0]!.file.startsWith(".history/script/en/script.json/")).toBe(true);
    expect(h[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const prev = JSON.parse(await readFile(store.abs(h[0]!.file), "utf8")) as Script;
    expect(prev.title).toBe("v21");
    await store.revert(P.script("en"), h[0]!.file);
    expect((await store.readJson(P.script("en"), Script)).title).toBe("v21");
    expect(await code(store.revert(P.script("en"), ".history/../project.json"))).toBe("VALIDATION");
  });
  it("optimistic concurrency on byte etags", async () => {
    const s = makeScript();
    expect(await code(store.writeJson(P.script("en"), Script, s, { writer: "user", ifMatch: "0".repeat(64) }))).toBe("CONFLICT");
    const a = await store.writeJson(P.script("en"), Script, s, { writer: "user", ifMatch: null });
    expect(await code(store.writeJson(P.script("en"), Script, s, { writer: "user", ifMatch: null }))).toBe("CONFLICT");
    const b = await store.writeJson(P.script("en"), Script, { ...s, title: "x" }, { writer: "user", ifMatch: a.etag });
    expect(await code(store.writeJson(P.script("en"), Script, { ...s, title: "y" }, { writer: "user", ifMatch: a.etag }))).toBe("CONFLICT");
    expect(b.changed).toBe(true);
  });
  it("reads with migration and refuses paths outside the project", async () => {
    registerMigration("factsheet", 0, (r) => ({ ...r, gaps: r.gaps ?? [] }));
    const fs = makeFactSheet() as Record<string, unknown>;
    delete fs.gaps;
    await mkdir(path.dirname(store.abs(P.factsheet)), { recursive: true });
    await writeFile(store.abs(P.factsheet), JSON.stringify({ ...fs, schemaVersion: 0 }));
    const read = await store.readJson(P.factsheet, FactSheet);
    expect(read.gaps).toEqual([]);
    expect(JSON.parse(await readFile(store.abs(P.factsheet), "utf8")).schemaVersion).toBe(0); // never written back
    expect(() => store.abs("../outside.json")).toThrow();
    expect(await store.readJsonOrNull(P.outline, FactSheet)).toBeNull();
    expect(await code(store.readJson(P.outline, FactSheet))).toBe("UPSTREAM_MISSING");
  });
  it("job lock: exclusive, stale pid takeover", async () => {
    const release = await store.lock("cli", "job-1");
    expect(await code(store.lock("web", "job-2"))).toBe("LOCKED");
    await release();
    const r2 = await store.lock("web", "job-2");
    await r2();
    await writeFile(store.abs(P.lock), JSON.stringify({ pid: 2 ** 22 + 12345, owner: "dead", jobId: "job-0", at: "2026-01-01T00:00:00Z" }));
    const r3 = await store.lock("cli", "job-3");
    expect(JSON.parse(await readFile(store.abs(P.lock), "utf8")).jobId).toBe("job-3");
    await r3();
    expect(await store.exists(P.lock)).toBe(false);
  });
  it("appendNdjson, linkOrCopy and listLangFiles", async () => {
    await store.appendNdjson(P.jobEvents("job-1"), { a: 1 });
    await store.appendNdjson(P.jobEvents("job-1"), { a: 2 });
    expect((await readFile(store.abs(P.jobEvents("job-1")), "utf8")).trim().split("\n")).toHaveLength(2);
    const src = path.join(root, "src.bin");
    await writeFile(src, "data");
    await store.linkOrCopy(src, "media/x.bin");
    await store.linkOrCopy(src, "media/x.bin");
    expect(await readFile(store.abs("media/x.bin"), "utf8")).toBe("data");
    await store.writeJson(P.timeline("en"), Timeline, makeTimeline({ seconds: 5 }), { writer: "stage", stage: "direct" });
    await writeFile(store.abs("timeline/fr.json"), "{}");
    await writeFile(store.abs("timeline/en.lint.json"), "{}");
    expect((await listLangFiles(store.abs("timeline"), "en")).map((f) => path.basename(f))).toEqual(["en.json", "en.lint.json"]);
    expect(await listLangFiles(store.abs("nope"), "en")).toEqual([]);
  });
});
