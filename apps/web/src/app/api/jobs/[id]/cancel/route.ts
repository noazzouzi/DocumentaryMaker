// POST → 204 (aborts the job; partial caches are kept so a resume pays only for what is missing)
import { handle, jobIdParam, noContent } from "@/server/http";
import { getEngine } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const id = jobIdParam((await ctx.params).id);
  await (await getEngine()).cancel(id);
  return noContent();
});
