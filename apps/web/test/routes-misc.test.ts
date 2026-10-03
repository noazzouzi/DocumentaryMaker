import { afterEach, describe, expect, it } from "vitest";
import { DocmakerError, type Approval, type HomeConfig, type JobRequest } from "@docmaker/core";
import { fakeEngine, params, req, tempProjects, writeProjectFile } from "./support/fake-engine";
import { setEngineForTests } from "../src/server/runtime";
import { errorBody } from "../src/server/http";
import * as approvalsRoute from "../src/app/api/projects/[slug]/approvals/route";
import * as jobsRoute from "../src/app/api/projects/[slug]/jobs/route";
import * as homeRoute from "../src/app/api/home/route";
import * as keysRoute from "../src/app/api/keys/route";
import * as projectsRoute from "../src/app/api/projects/route";
import * as projectRoute from "../src/app/api/projects/[slug]/route";
import * as voicesRoute from "../src/app/api/voices/route";
import * as teleprompterRoute from "../src/app/api/projects/[slug]/teleprompter/[lang]/route";

afterEach(() => setEngineForTests(null));
const slug = params({ slug: "my-film" });
const post = (body: unknown) => req("/x", { method: "POST", body: JSON.stringify(body) });

describe("approvals", () => {
  it("forces by:web and passes per-item notes", async () => {
    const calls: { gate: string; a: Omit<Approval, "gate" | "approvedAt"> }[] = [];
    fakeEngine({ async approve(_s, gate, a) { calls.push({ gate, a }); } });
    const r = await approvalsRoute.POST(post({ gate: "factcheck-ack", stage: "voice", lang: "en", planHash: "b".repeat(64), note: "", items: ["FC-0000abcd"], itemNotes: { "FC-0000abcd": "attributed to the court record" }, by: "fixture" }), slug);
    expect(r.status).toBe(204);
    expect(calls[0]!.gate).toBe("factcheck-ack");
    expect(calls[0]!.a.by).toBe("web");
    expect(calls[0]!.a.itemNotes).toEqual({ "FC-0000abcd": "attributed to the court record" });
  });
  it("rejects unknown gates and fields; maps engine validation to 400", async () => {
    fakeEngine({ async approve() { throw new DocmakerError("VALIDATION", "note too short"); } });
    expect((await approvalsRoute.POST(post({ gate: "nope", stage: "voice", planHash: "b".repeat(64) }), slug)).status).toBe(400);
    expect((await approvalsRoute.POST(post({ gate: "cost", stage: "voice", planHash: "b".repeat(64), sneaky: 1 }), slug)).status).toBe(400);
    expect((await approvalsRoute.POST(post({ gate: "cost", stage: "voice", planHash: "b".repeat(64) }), slug)).status).toBe(400);
  });
});

describe("jobs", () => {
  it("fills request defaults; slug comes from the URL", async () => {
    const calls: JobRequest[] = [];
    fakeEngine({ async getProject() { return {} as never; }, async submit(r) { calls.push(r); return { jobId: "job-1", coalesced: false }; } });
    const r = await jobsRoute.POST(post({ kind: "pipeline", from: "layout", to: "mix" }), slug);
    expect(r.status).toBe(202);
    expect(calls[0]).toEqual({ slug: "my-film", kind: "pipeline", stage: null, from: "layout", to: "mix", langs: [], force: false, options: {}, preset: null });
    expect((await jobsRoute.POST(post({ kind: "setup" }), slug)).status).toBe(400);
    expect((await jobsRoute.POST(post({ kind: "stage" }), slug)).status).toBe(400);
    expect((await jobsRoute.POST(post({ slug: "other", kind: "stage", stage: "direct" }), slug)).status).toBe(400);
  });
});

describe("home + keys", () => {
  it("timestamps the Remotion licence choice server-side", async () => {
    let patch: Partial<HomeConfig> | null = null;
    fakeEngine({ async setHomeConfig(p) { patch = p; return p as HomeConfig; } });
    const r = await homeRoute.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ remotionLicense: { status: "individual-or-small-org", acknowledgedAt: "1999-01-01T00:00:00Z" } }) }));
    expect(r.status).toBe(200);
    expect(patch!.remotionLicense!.status).toBe("individual-or-small-org");
    expect(patch!.remotionLicense!.acknowledgedAt).not.toBe("1999-01-01T00:00:00Z");
    expect((await homeRoute.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ remotionLicense: { status: "free-for-all" } }) }))).status).toBe(400);
    expect((await homeRoute.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ schemaVersion: 2 }) }))).status).toBe(400);
  });
  it("requires consent and a single-line value; never echoes it", async () => {
    const set: [string, string][] = [];
    fakeEngine({ async setSecret(n, v) { set.push([n, v]); } });
    expect((await keysRoute.POST(post({ name: "anthropic", value: "sk-test" }))).status).toBe(400);
    expect((await keysRoute.POST(post({ name: "anthropic", value: "sk-a\nEVIL=1", consent: true }))).status).toBe(400);
    expect((await keysRoute.POST(post({ name: "PATH", value: "x", consent: true }))).status).toBe(400);
    const ok = await keysRoute.POST(post({ name: "elevenlabs", value: "  xi-123  ", consent: true }));
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe("");
    expect(set).toEqual([["elevenlabs", "xi-123"]]);
  });
});

describe("projects + errors", () => {
  it("validates new projects and refuses identity fields in PATCH", async () => {
    fakeEngine({ async createProject(i) { return { slug: "x", idea: i.idea } as never; }, async updateProject(_s, p) { return p as never; } });
    expect((await projectsRoute.POST(post({ idea: "ab" }))).status).toBe(400);
    expect((await projectsRoute.POST(post({ idea: "The tulip mania of 1637", languages: ["en", "fr"] }))).status).toBe(201);
    expect((await projectRoute.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ slug: "renamed" }) }), slug)).status).toBe(400);
    expect((await projectRoute.PATCH(req("/x", { method: "PATCH", body: JSON.stringify({ targetMinutes: 12 }) }), slug)).status).toBe(200);
  });
  it("maps engine errors to HTTP statuses", () => {
    expect(errorBody(new DocmakerError("INTERNAL", "not implemented: engine.createEngine")).status).toBe(501);
    expect(errorBody(new DocmakerError("UPSTREAM_MISSING", "x")).status).toBe(404);
    expect(errorBody(new DocmakerError("LOCKED", "x")).status).toBe(409);
    expect(errorBody(new DocmakerError("POLICY_DENIED", "x")).status).toBe(403);
    expect(errorBody(new Error("boom")).status).toBe(500);
  });
  it("an engine that is not implemented yields 501 with notImplemented", async () => {
    fakeEngine({});
    const r = await projectsRoute.GET();
    expect(r.status).toBe(501);
    expect((await r.json()).error.notImplemented).toBe(true);
  });
  it("voices degrade to [] when the engine has no listing", async () => {
    fakeEngine({ listVoices: undefined } as never);
    setEngineForTests({} as never);
    const r = await voicesRoute.GET(req("/x?provider=kokoro&lang=fr"));
    expect(await r.json()).toEqual([]);
    expect(r.headers.get("x-docmaker-degraded")).toBe("voices-unavailable");
  });
});

describe("teleprompter", () => {
  it("generates the page through the engine and sends it as a sandboxed attachment", async () => {
    const root = await tempProjects();
    const calls: { slug: string; lang: string; mirror: boolean }[] = [];
    fakeEngine({
      async teleprompter(s, lang, o) {
        calls.push({ slug: s, lang, mirror: o.mirror });
        return writeProjectFile(root, s, `voice/${lang}/teleprompter.html`, "<!doctype html><title>t</title><script>scroll()</script>");
      },
    });
    const ctx = params({ slug: "my-film", lang: "fr" });
    const r = await teleprompterRoute.GET(req("/api/projects/my-film/teleprompter/fr?mirror=1"), ctx);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(r.headers.get("content-disposition")).toBe('attachment; filename="my-film-fr-teleprompter-mirror.html"');
    expect(r.headers.get("content-security-policy")).toMatch(/^sandbox allow-scripts;.*frame-ancestors 'none'/);
    expect(await r.text()).toContain("<script>scroll()</script>");
    await teleprompterRoute.GET(req("/api/projects/my-film/teleprompter/fr"), ctx);
    expect(calls).toEqual([{ slug: "my-film", lang: "fr", mirror: true }, { slug: "my-film", lang: "fr", mirror: false }]);
  });
  it("404 without a script; 400 on a bad language", async () => {
    fakeEngine({ async teleprompter() { throw new DocmakerError("UPSTREAM_MISSING", "no en script yet"); } });
    expect((await teleprompterRoute.GET(req("/x"), params({ slug: "my-film", lang: "en" }))).status).toBe(404);
    expect((await teleprompterRoute.GET(req("/x"), params({ slug: "my-film", lang: "de" }))).status).toBe(400);
  });
});
