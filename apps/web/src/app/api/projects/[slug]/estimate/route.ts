// GET ?stage=&lang= → CostEstimate | null
import { handle, json, optionalLang } from "@/server/http";
import { projectCtx, type SlugCtx } from "@/server/context";
import { stageParam } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  const q = new URL(req.url).searchParams;
  return json(await engine.estimate(slug, stageParam(q.get("stage")), optionalLang(q.get("lang"))));
});
