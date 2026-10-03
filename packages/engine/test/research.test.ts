// Research resume (§5.6): saved research turns are resumed only for the same request; a changed idea / as-of date or a
// new request starts over (old turns discarded); a forced re-run of the same request replays the completed turns.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DocmakerError, P, ResearchDossier, type JobEvent } from "@docmaker/core";
import { REAL_DEPS, type LlmApi } from "../src/deps";
import type { EngineExt } from "../src/engine";
import { skeletonDeps } from "./fakes";
import { collect, deferred, fixtureProject, stageReq, testEngine, testEnv, type TestEnv } from "./helpers";

type Turn = { stop_reason: string; content: { type: "text"; text: string }[] };
const stop = (t: unknown) => (t as Turn).stop_reason;

/**
 * runResearch fake with the Anthropic client's resume semantics: resumed turns are replayed, a completed resume (last turn
 * not pause_turn) makes no new call; otherwise turns are produced until `plan.turns` (the last one ends the research).
 * Every call records the resumeTurns it was given.
 */
function recordingResearch(base: LlmApi) {
  const calls: { topic: string; asOf: string; resumeTurns: Turn[]; newTurns: number }[] = [];
  const plan = { turns: 3, pauseAfter: null as number | null };
  let paused = deferred();
  const runResearch: LlmApi["runResearch"] = async (ctx, i) => {
    const call = { topic: i.topic, asOf: i.asOf, resumeTurns: structuredClone(i.resumeTurns) as Turn[], newTurns: 0 };
    calls.push(call);
    const turns = [...i.resumeTurns];
    let done = turns.length > 0 && stop(turns.at(-1)) !== "pause_turn";
    while (!done) {
      const n = turns.length + 1;
      if (plan.pauseAfter !== null && n === plan.pauseAfter + 1) {
        plan.pauseAfter = null;
        paused.resolve();
        await new Promise<never>((_, rej) => {
          if (ctx.signal.aborted) rej(new DocmakerError("CANCELED", "canceled"));
          ctx.signal.addEventListener("abort", () => rej(new DocmakerError("CANCELED", "canceled")), { once: true });
        });
      }
      const msg: Turn = { stop_reason: n < plan.turns ? "pause_turn" : "end_turn", content: [{ type: "text", text: `turn ${n}: ${i.topic} as of ${i.asOf}` }] };
      turns.push(msg);
      call.newTurns++;
      await i.onTurn(n, msg);
      done = msg.stop_reason !== "pause_turn";
    }
    const r = await base.runResearch(ctx, { ...i, resumeTurns: [] });
    return { ...r, turns: turns.length };
  };
  return { calls, plan, runResearch, nextPause: () => (paused = deferred()).promise };
}

describe("research resume", () => {
  let t: TestEnv;
  let e: EngineExt;
  let slug: string;
  let fake: ReturnType<typeof recordingResearch>;
  const rawDir = () => path.join(t.env.DOCMAKER_PROJECTS!, slug, "research/raw");
  const turnFiles = () => (existsSync(rawDir()) ? readdirSync(rawDir()).filter((f) => /^turn-\d+\.json$/.test(f)).sort() : []);
  const readTurn = (n: number) => JSON.parse(readFileSync(path.join(rawDir(), `turn-${n}.json`), "utf8")) as Turn;
  const run = async (over: Parameters<typeof stageReq>[2] = {}) => {
    const { jobId } = await e.submit(stageReq(slug, "research", over));
    const events = await collect(e, jobId);
    return { jobId, status: (await e.waitForJob(jobId)).status, events };
  };
  const logs = (events: JobEvent[]) => events.flatMap((x) => (x.type === "log" ? [x.message] : []));

  beforeAll(async () => {
    t = testEnv("research");
    const base = skeletonDeps();
    fake = recordingResearch(REAL_DEPS.llm);
    e = await testEngine(t, { deps: { ...base, llm: { ...base.llm, runResearch: fake.runResearch } } });
    slug = (await fixtureProject(e, "tulip-mania", "rs")).slug;
  });
  afterAll(async () => {
    await e?.close();
    t?.cleanup();
  });

  it("a canceled research resumes from its saved turns", async () => {
    fake.plan.turns = 3;
    fake.plan.pauseAfter = 2;
    const pausedAt = fake.nextPause();
    const { jobId } = await e.submit(stageReq(slug, "research"));
    await pausedAt;
    await e.cancel(jobId);
    expect((await e.waitForJob(jobId)).status).toBe("canceled");
    expect(turnFiles()).toEqual(["turn-1.json", "turn-2.json"]);
    expect(await e.researchResume(slug)).toEqual({ saved: 2, matches: true, complete: false });

    const r = await run();
    expect(r.status).toBe("succeeded");
    const call = fake.calls.at(-1)!;
    expect(call.resumeTurns.map(stop)).toEqual(["pause_turn", "pause_turn"]);
    expect(call.newTurns).toBe(1);
    expect(logs(r.events)).toContain("resuming research from 2 saved turn(s)");
    expect(turnFiles()).toEqual(["turn-1.json", "turn-2.json", "turn-3.json"]);
    const dossier = (await e.readDoc(slug, P.dossier, ResearchDossier)).value;
    expect(dossier.turns).toBe(3);
    expect(dossier.rawFiles).toEqual([P.researchTurn(1), P.researchTurn(2), P.researchTurn(3)]);
    expect(await e.researchResume(slug)).toEqual({ saved: 3, matches: true, complete: true });
  });

  it("a forced re-run of the same request replays the completed turns (no new call)", async () => {
    const before = readFileSync(path.join(t.env.DOCMAKER_PROJECTS!, slug, P.dossier), "utf8");
    const r = await run({ force: true });
    expect(r.status).toBe("succeeded");
    const call = fake.calls.at(-1)!;
    expect(call.resumeTurns).toHaveLength(3);
    expect(call.newTurns).toBe(0);
    expect(readFileSync(path.join(t.env.DOCMAKER_PROJECTS!, slug, P.dossier), "utf8")).toBe(before);
  });

  it("a changed as-of date starts a new research and discards the old turns", async () => {
    await e.updateProject(slug, { editorial: { ...(await e.getProject(slug)).editorial, asOf: "2026-09-01" } });
    expect(await e.researchResume(slug)).toMatchObject({ saved: 3, matches: false });
    fake.plan.turns = 1; // fewer turns than before: no stale turn-2/turn-3 may survive
    const r = await run();
    expect(r.status).toBe("succeeded");
    const call = fake.calls.at(-1)!;
    expect(call.asOf).toBe("2026-09-01");
    expect(call.resumeTurns).toEqual([]);
    expect(call.newTurns).toBe(1);
    expect(logs(r.events).some((m) => /discarded 3 saved research turn\(s\): the research request changed/.test(m))).toBe(true);
    expect(turnFiles()).toEqual(["turn-1.json"]);
    expect(readTurn(1).content[0]!.text).toContain("as of 2026-09-01");
    expect((await e.readDoc(slug, P.dossier, ResearchDossier)).value.rawFiles).toEqual([P.researchTurn(1)]);
  });

  it("a changed idea starts a new research", async () => {
    await e.updateProject(slug, { idea: "The tulip mania of 1637, told through the Haarlem auctions" });
    fake.plan.turns = 2;
    const r = await run();
    expect(r.status).toBe("succeeded");
    const call = fake.calls.at(-1)!;
    expect(call.topic).toContain("Haarlem auctions");
    expect(call.resumeTurns).toEqual([]);
    expect(turnFiles()).toEqual(["turn-1.json", "turn-2.json"]);
    expect(readTurn(1).content[0]!.text).toContain("Haarlem auctions");
  });

  it("--new-request discards the saved turns of the same request", async () => {
    fake.plan.turns = 1;
    const r = await run({ force: true, options: { newRequest: true } });
    expect(r.status).toBe("succeeded");
    expect(fake.calls.at(-1)!.resumeTurns).toEqual([]);
    expect(fake.calls.at(-1)!.newTurns).toBe(1);
    expect(turnFiles()).toEqual(["turn-1.json"]);
  });
});
