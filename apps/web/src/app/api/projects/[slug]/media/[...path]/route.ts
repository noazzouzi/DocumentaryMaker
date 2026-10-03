// GET/HEAD static media with Range (206). Allowlist: media/ program/ voice/ render/ export/ qa/, plus styles/<dir>/fonts/*
// (user-style fonts from <home>/styles, as the render asset server mounts them); traversal guard; ?v= ignored.
import { handle } from "@/server/http";
import { projectCtx } from "@/server/context";
import { projectDirOf } from "@/server/runtime";
import { fileResponse, resolveMediaPath } from "@/server/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; path: string[] }> };

const serve = handle(async (req: Request, ctx: Ctx) => {
  const p = await ctx.params;
  const { engine, slug } = await projectCtx(Promise.resolve(p));
  const f = await resolveMediaPath(projectDirOf(engine, slug), p.path, engine.config.paths?.styles);
  return fileResponse(req, f, { download: new URL(req.url).searchParams.get("download") === "1" });
});
export const GET = serve;
export const HEAD = serve;
