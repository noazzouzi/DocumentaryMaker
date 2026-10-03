// POST → {jobId}: "Approve & continue" resubmits the original request (JobRecord.resumeOf)
import { handle, jobIdParam, json } from "@/server/http";
import { getEngine } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const id = jobIdParam((await ctx.params).id);
  return json(await (await getEngine()).resume(id), { status: 202 });
});
