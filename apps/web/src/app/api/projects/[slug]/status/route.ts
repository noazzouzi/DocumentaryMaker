// GET → {stages, costUsd, activeJobId, queued}
import { handle, json } from "@/server/http";
import { projectCtx, type SlugCtx } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  return json(await engine.status(slug));
});
