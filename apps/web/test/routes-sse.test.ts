import { afterEach, describe, expect, it } from "vitest";
import type { JobEvent } from "@docmaker/core";
import { fakeEngine, params, req } from "./support/fake-engine";
import { setEngineForTests } from "../src/server/runtime";
import { sseFrame, sseResponse } from "../src/server/sse";
import * as eventsRoute from "../src/app/api/jobs/[id]/events/route";

afterEach(() => setEngineForTests(null));

const at = "2026-10-03T10:00:00.000Z";
const jobId = "job-20261003-100000-abc123";
const EVENTS: JobEvent[] = [
  { jobId, seq: 0, at, type: "stage-start", stage: "research", lang: null },
  { jobId, seq: 1, at, type: "progress", stage: "research", lang: null, pct: 0.5, message: "line one\nline two", detail: {} },
  { jobId, seq: 2, at, type: "stage-done", stage: "research", lang: null, durationMs: 12, outputsHash: "a".repeat(64) },
  { jobId, seq: 3, at, type: "job-end", status: "succeeded" },
  { jobId, seq: 4, at, type: "log", level: "info", message: "never sent", stage: null },
];

async function* replay(after?: number): AsyncGenerator<JobEvent> {
  for (const e of EVENTS) if (after === undefined || e.seq > after) yield e;
}

function parseSse(text: string): { id: string | null; event: string | null; data: string | null; comment: boolean }[] {
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const f = { id: null as string | null, event: null as string | null, data: null as string | null, comment: false };
      for (const line of block.split("\n")) {
        if (line.startsWith(":")) f.comment = true;
        else if (line.startsWith("id: ")) f.id = line.slice(4);
        else if (line.startsWith("event: ")) f.event = line.slice(7);
        else if (line.startsWith("data: ")) f.data = line.slice(6);
      }
      return f;
    });
}

describe("SSE framing", () => {
  it("one frame per event: id, event, single-line JSON data", () => {
    const f = sseFrame(EVENTS[1]!);
    expect(f).toBe(`id: 1\nevent: progress\ndata: ${JSON.stringify(EVENTS[1])}\n\n`);
    expect(f.split("\n")).toHaveLength(5); // the embedded newline is escaped inside the JSON
  });

  it("streams, then closes after job-end", async () => {
    fakeEngine({ async getJob() { return { id: jobId } as never; }, events: (_id, after) => replay(after) });
    const r = await eventsRoute.GET(req(`/api/jobs/${jobId}/events`), params({ id: jobId }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(r.headers.get("cache-control")).toBe("no-cache, no-transform");
    const frames = parseSse(await r.text()).filter((f) => f.event);
    expect(frames.map((f) => f.id)).toEqual(["0", "1", "2", "3"]);
    expect(frames.at(-1)!.event).toBe("job-end");
    expect(JSON.parse(frames[1]!.data!)).toEqual(EVENTS[1]);
  });

  it("replays after Last-Event-ID (header or ?lastEventId=)", async () => {
    const seen: (number | undefined)[] = [];
    fakeEngine({ async getJob() { return { id: jobId } as never; }, events: (_id, after) => (seen.push(after), replay(after)) });
    const r = await eventsRoute.GET(req(`/api/jobs/${jobId}/events`, { headers: { "last-event-id": "1" } }), params({ id: jobId }));
    expect(parseSse(await r.text()).filter((f) => f.event).map((f) => f.id)).toEqual(["2", "3"]);
    const r2 = await eventsRoute.GET(req(`/api/jobs/${jobId}/events?lastEventId=2`), params({ id: jobId }));
    expect(parseSse(await r2.text()).filter((f) => f.event).map((f) => f.id)).toEqual(["3"]);
    expect(seen).toEqual([1, 2]);
  });

  it("404 for an unknown job, 400 for a malformed id", async () => {
    fakeEngine({ async getJob() { return null; } });
    expect((await eventsRoute.GET(req("/x"), params({ id: jobId }))).status).toBe(404);
    expect((await eventsRoute.GET(req("/x"), params({ id: "../etc" }))).status).toBe(400);
  });

  it("sends `: ping` comments while waiting and stops on client abort", async () => {
    let returned = false;
    const live: AsyncIterable<JobEvent> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<JobEvent>>(() => {}), // a live job that never emits
          return: async () => ((returned = true), { done: true, value: undefined }),
        };
      },
    };
    const ac = new AbortController();
    const r = sseResponse(live, { signal: ac.signal, pingMs: 10 });
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    while (!text.includes(": ping")) text += dec.decode((await reader.read()).value);
    expect(text.startsWith("retry: 3000\n\n")).toBe(true);
    ac.abort();
    for (;;) if ((await reader.read()).done) break;
    expect(returned).toBe(true);
  });
});
