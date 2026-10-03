// Server-sent events for job streams (SPEC §14.5): `id: <seq>\nevent: <type>\ndata: <JSON>\n\n`, replay after
// Last-Event-ID (the engine replays jobs/<id>.ndjson then live events), `: ping` every 15 s, close after job-end.
import "server-only";
import type { JobEvent } from "@docmaker/core";

export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};
export const PING_MS = 15_000;

/** One SSE frame. JSON.stringify never emits raw newlines, so `data:` stays one line. */
export function sseFrame(ev: JobEvent): string {
  return `id: ${ev.seq}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

/** Last-Event-ID header (EventSource reconnects) or ?lastEventId= (manual reattach); null when absent/invalid. */
export function lastEventIdOf(req: Request): number | null {
  const raw = req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("lastEventId");
  if (raw === null || raw.trim() === "") return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

/** Streams an engine event iterable as SSE; stops on job-end, client abort or stream cancel. */
export function sseResponse(events: AsyncIterable<JobEvent>, o: { signal?: AbortSignal; pingMs?: number } = {}): Response {
  const enc = new TextEncoder();
  const it = events[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  // never awaits the iterator: return() on a generator parked on a live wait settles only after its next event
  const stop = () => {
    if (closed) return;
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    void Promise.resolve(it.return?.()).catch(() => undefined);
  };
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(s));
        } catch {
          stop();
        }
      };
      write("retry: 3000\n\n");
      timer = setInterval(() => write(": ping\n\n"), o.pingMs ?? PING_MS);
      const onAbort = () => {
        stop();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      if (o.signal) {
        if (o.signal.aborted) return onAbort();
        o.signal.addEventListener("abort", onAbort, { once: true });
      }
      void (async () => {
        try {
          for (;;) {
            const r = await it.next();
            if (r.done || closed) break;
            write(sseFrame(r.value));
            if (r.value.type === "job-end") break;
          }
        } catch (e) {
          write(`event: stream-error\ndata: ${JSON.stringify({ message: e instanceof Error ? e.message : String(e) })}\n\n`);
        } finally {
          o.signal?.removeEventListener("abort", onAbort);
          stop();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      })();
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
}
