// GET → active + queued + recent JobRecords · POST JobRequest (defaults filled) → {jobId, coalesced}
import { handle, json, readJsonObject } from "@/server/http";
import { projectCtx, type SlugCtx } from "@/server/context";
import { jobRequestFrom } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  return json(await engine.listJobs(slug));
});

export const POST = handle(async (req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  const request = jobRequestFrom(slug, await readJsonObject(req));
  await engine.getProject(slug); // 404 before queuing anything for an unknown project
  return json(await engine.submit(request), { status: 202 });
});
