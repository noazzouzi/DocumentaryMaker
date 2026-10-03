// GET → JobRecord (additive; the job page polls it after job-end)
import { HttpError, handle, jobIdParam, json } from "@/server/http";
import { getEngine } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const id = jobIdParam((await ctx.params).id);
  const job = await (await getEngine()).getJob(id);
  if (!job) throw new HttpError(404, "UPSTREAM_MISSING", `job ${id} not found`);
  return json(job);
});
