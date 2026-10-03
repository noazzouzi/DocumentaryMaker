// POST {beatId, slot, provider, providerAssetId} → {asset, issues}. Only the candidate REFERENCE is read: the server
// re-derives the candidate (and its licence) from its own cache; licence data sent by the client is ignored.
import { handle, json, readJsonObject } from "@/server/http";
import { projectCtx, type SlugCtx } from "@/server/context";
import { freezeFrom } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  return json(await engine.freeze(slug, freezeFrom(await readJsonObject(req))));
});
