// EN + FR on the tulip-mania fixture: the secondary script follows the primary skeleton (parity), each language gets its
// own slices, take, layout and timeline; a pipeline for FR alone also runs the primary script/beatslice.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { P, Script, Timeline, validateLangParity } from "@docmaker/core";
import { fixtureProject, pipelineReq, runToEnd, testEngine, testEnv, type TestEnv } from "./helpers";
import type { EngineExt } from "../src/engine";

describe("bilingual project", () => {
  let t: TestEnv;
  let e: EngineExt;
  let slug: string;
  let dir: string;
  let order: string[] = [];

  beforeAll(async () => {
    t = testEnv("bilingual");
    e = await testEngine(t);
    slug = (await fixtureProject(e, "tulip-mania", "bi", ["en", "fr"])).slug;
    dir = path.join(t.env.DOCMAKER_PROJECTS!, slug);
    const r = await runToEnd(e, pipelineReq(slug, "research", "mix", { langs: ["fr"], options: { onlyChapters: ["CH1"] } }));
    expect(r.status).toBe("succeeded");
    order = r.events.filter((x) => x.type === "stage-done").map((x) => (x.type === "stage-done" ? `${x.stage}${x.lang ? "." + x.lang : ""}` : ""));
  });
  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("runs the primary script and slices for a FR-only request, then FR downstream only", () => {
    expect(order).toEqual(["research", "style", "outline", "script.en", "script.fr", "beats", "beatslice.en", "beatslice.fr", "factcheck.fr", "assets", "voice.fr", "layout.fr", "direct.fr", "mix.fr"]);
  });

  it("keeps the segment skeleton identical across languages", () => {
    const en = Script.parse(JSON.parse(readFileSync(path.join(dir, P.script("en")), "utf8")));
    const fr = Script.parse(JSON.parse(readFileSync(path.join(dir, P.script("fr")), "utf8")));
    expect(validateLangParity(en, fr)).toEqual([]);
    expect(fr.chapters[0]!.segments.filter((s) => s.type === "narration").every((s) => s.primaryHash !== null)).toBe(true);
  });

  it("builds a French timeline from the French take", () => {
    const tl = Timeline.parse(JSON.parse(readFileSync(path.join(dir, P.timeline("fr")), "utf8")));
    const active = JSON.parse(readFileSync(path.join(dir, P.activeTake("fr")), "utf8")) as { takeId: string };
    expect(tl.lang).toBe("fr");
    expect(tl.takeId).toBe(active.takeId);
    expect(tl.chapters.map((c) => c.id)).toEqual(["CH1"]);
  });

  it("transcreate validates its target and needs the LLM (no recorded fixture → FIXTURE_MISSING)", async () => {
    await expect(e.transcreate(slug, "en", "CH1-S01")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(e.transcreate(slug, "fr", "CH9-S01")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(e.transcreate(slug, "fr", "CH1-S01")).rejects.toMatchObject({ code: "FIXTURE_MISSING" });
  });
});
