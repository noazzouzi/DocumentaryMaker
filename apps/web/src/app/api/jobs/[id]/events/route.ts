// GET → text/event-stream (§14.5): replay after Last-Event-ID, live events, `: ping` every 15 s, closes after job-end.
import { HttpError, handle, jobIdParam } from "@/server/http";
import { getEngine } from "@/server/runtime";
import { lastEventIdOf, sseResponse } from "@/server/sse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const id = jobIdParam((await ctx.params).id);
  const engine = await getEngine();
  if (!(await engine.getJob(id))) throw new HttpError(404, "UPSTREAM_MISSING", `job ${id} not found`);
  const after = lastEventIdOf(req);
  return sseResponse(engine.events(id, after ?? undefined), { signal: req.signal });
});
