// GET ?from=&to=&langs= → PipelineEstimate (whole-pipeline cost shown before submitting)
import { handle, json } from "@/server/http";
import { projectCtx, type SlugCtx } from "@/server/context";
import { langsParam, stageParam } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  const q = new URL(req.url).searchParams;
  return json(await engine.estimatePipeline(slug, { from: stageParam(q.get("from"), "from"), to: stageParam(q.get("to"), "to"), langs: langsParam(q.get("langs")) }));
});
