// POST {segmentId, url?, uploadRel?, startMs, endMs, channel, title} → {issues} (manual clip resolution)
import { handle, json, readJsonObject } from "@/server/http";
import { projectCtx, type SlugCtx } from "@/server/context";
import { clipResolveFrom } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  return json(await engine.resolveClip(slug, clipResolveFrom(await readJsonObject(req))));
});
