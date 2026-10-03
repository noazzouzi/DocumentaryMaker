import { afterEach, describe, expect, it } from "vitest";
import { DocmakerError, hashJson, type LintIssue } from "@docmaker/core";
import { fakeEngine, params, req } from "./support/fake-engine";
import { setEngineForTests } from "../src/server/runtime";
import * as docsRoute from "../src/app/api/projects/[slug]/docs/[...rel]/route";
import * as historyRoute from "../src/app/api/projects/[slug]/history/[...rel]/route";

afterEach(() => setEngineForTests(null));

function docsEngine(initial: Record<string, unknown>) {
  const store = new Map<string, unknown>(Object.entries(initial));
  const writes: { rel: string; etag: string | null }[] = [];
  const etagOf = (v: unknown) => hashJson(v).slice(0, 16);
  fakeEngine({
    async readDoc(_slug, rel, schema) {
      if (!store.has(rel)) throw new DocmakerError("UPSTREAM_MISSING", `${rel} does not exist`);
      const value = (schema as { parse(v: unknown): unknown }).parse(store.get(rel));
      return { value, etag: etagOf(store.get(rel)) } as never;
    },
    async writeDoc(_slug, rel, _schema, value, etag) {
      const cur = store.has(rel) ? etagOf(store.get(rel)) : null;
      if (cur !== etag) throw new DocmakerError("CONFLICT", `${rel} changed since it was read`);
      writes.push({ rel, etag });
      store.set(rel, value);
      const issues: LintIssue[] = [{ level: "warn", rule: "TEST", where: "global", msg: "re-linted" }];
      return { etag: etagOf(value), issues };
    },
    async history() {
      return [{ file: "2026-10-03T10-00-00Z-abcd1234.json", at: "2026-10-03T10:00:00Z", etag: "abcd1234" }];
    },
    async revert(_s, _rel, file) {
      return { etag: `rev-${file.length}` };
    },
  });
  return { store, writes, etagOf };
}

const overrides = { schemaVersion: 1, lang: "en", overrides: [] };
const ctx = (rel: string) => params({ slug: "my-film", rel: rel.split("/") });

describe("documents: ETag / If-Match", () => {
  it("GET returns the document with a quoted ETag; If-None-Match → 304", async () => {
    const { etagOf } = docsEngine({ "timeline/en.overrides.json": overrides });
    const r = await docsRoute.GET(req("/api/projects/my-film/docs/timeline/en.overrides.json"), ctx("timeline/en.overrides.json"));
    expect(r.status).toBe(200);
    expect(r.headers.get("etag")).toBe(`"${etagOf(overrides)}"`);
    expect(await r.json()).toEqual(overrides);
    const r2 = await docsRoute.GET(req("/x", { headers: { "if-none-match": `"${etagOf(overrides)}"` } }), ctx("timeline/en.overrides.json"));
    expect(r2.status).toBe(304);
  });

  it("PUT with a stale If-Match → 412 with the current etag; nothing written", async () => {
    const { writes, etagOf } = docsEngine({ "timeline/en.overrides.json": overrides });
    const r = await docsRoute.PUT(
      req("/x", { method: "PUT", headers: { "if-match": `"0000000000000000"`, "content-type": "application/json" }, body: JSON.stringify(overrides) }),
      ctx("timeline/en.overrides.json"),
    );
    expect(r.status).toBe(412);
    expect(r.headers.get("etag")).toBe(`"${etagOf(overrides)}"`);
    expect((await r.json()).error.code).toBe("CONFLICT");
    expect(writes).toHaveLength(0);
  });

  it("PUT without a precondition → 428", async () => {
    docsEngine({ "timeline/en.overrides.json": overrides });
    const r = await docsRoute.PUT(req("/x", { method: "PUT", body: JSON.stringify(overrides) }), ctx("timeline/en.overrides.json"));
    expect(r.status).toBe(428);
  });

  it("PUT with the current etag writes and returns {etag, issues}", async () => {
    const { etagOf, store } = docsEngine({ "timeline/en.overrides.json": overrides });
    const next = { ...overrides, lang: "en" as const, overrides: [] };
    const r = await docsRoute.PUT(req("/x", { method: "PUT", headers: { "if-match": `"${etagOf(overrides)}"` }, body: JSON.stringify(next) }), ctx("timeline/en.overrides.json"));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.etag).toBe(etagOf(next));
    expect(body.issues[0].rule).toBe("TEST");
    expect(store.get("timeline/en.overrides.json")).toEqual(next);
  });

  it("If-None-Match: * creates a missing document and refuses an existing one", async () => {
    docsEngine({ "timeline/en.overrides.json": overrides });
    const created = await docsRoute.PUT(req("/x", { method: "PUT", headers: { "if-none-match": "*" }, body: JSON.stringify({ ...overrides, lang: "fr" }) }), ctx("timeline/fr.overrides.json"));
    expect(created.status).toBe(200);
    const again = await docsRoute.PUT(req("/x", { method: "PUT", headers: { "if-none-match": "*" }, body: JSON.stringify(overrides) }), ctx("timeline/en.overrides.json"));
    expect(again.status).toBe(412);
  });

  it("an engine CONFLICT (write raced by a job) also maps to 412", async () => {
    const { etagOf } = docsEngine({ "timeline/en.overrides.json": overrides });
    fakeEngine({
      async readDoc() {
        return { value: overrides, etag: etagOf(overrides) } as never;
      },
      async writeDoc() {
        throw new DocmakerError("CONFLICT", "timeline/en.overrides.json changed since it was read");
      },
    });
    const r = await docsRoute.PUT(req("/x", { method: "PUT", headers: { "if-match": `"${etagOf(overrides)}"` }, body: JSON.stringify(overrides) }), ctx("timeline/en.overrides.json"));
    expect(r.status).toBe(412);
  });

  it("invalid documents → 400 with issues", async () => {
    const { etagOf } = docsEngine({ "timeline/en.overrides.json": overrides });
    const r = await docsRoute.PUT(req("/x", { method: "PUT", headers: { "if-match": `"${etagOf(overrides)}"` }, body: JSON.stringify({ schemaVersion: 1, lang: "de" }) }), ctx("timeline/en.overrides.json"));
    expect(r.status).toBe(400);
    const b = await r.json();
    expect(b.error.code).toBe("VALIDATION");
    expect(Array.isArray(b.error.details)).toBe(true);
  });

  it("only allowlisted documents (403), no traversal", async () => {
    docsEngine({});
    for (const rel of ["state.json", "project.json", "approvals.json", "jobs/index.json", "assets/picks.json", "timeline/en.json"]) {
      const r = await docsRoute.GET(req("/x"), ctx(rel));
      expect(r.status, rel).toBe(403);
    }
    const t = await docsRoute.GET(req("/x"), params({ slug: "my-film", rel: ["..", "..", "etc", "passwd"] }));
    expect(t.status).toBe(403);
    const bad = await docsRoute.GET(req("/x"), params({ slug: "../evil", rel: ["outline", "outline.json"] }));
    expect(bad.status).toBe(400);
  });

  it("missing document → 404", async () => {
    docsEngine({});
    const r = await docsRoute.GET(req("/x"), ctx("outline/outline.json"));
    expect(r.status).toBe(404);
  });

  it("history lists versions and reverts by file name only", async () => {
    docsEngine({});
    const h = await historyRoute.GET(req("/x"), ctx("outline/outline.json"));
    expect((await h.json())[0].file).toMatch(/\.json$/);
    const ok = await historyRoute.POST(req("/x", { method: "POST", body: JSON.stringify({ file: "2026-10-03T10-00-00Z-abcd1234.json" }) }), ctx("outline/outline.json"));
    expect(ok.status).toBe(200);
    const bad = await historyRoute.POST(req("/x", { method: "POST", body: JSON.stringify({ file: "../../project.json" }) }), ctx("outline/outline.json"));
    expect(bad.status).toBe(400);
  });
});
