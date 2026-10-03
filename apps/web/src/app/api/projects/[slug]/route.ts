// GET → Project · PATCH partial Project (validated; identity fields refused; LOCKED_AFTER_START enforced by the engine)
import { handle, json, parseOr400, readJsonObject } from "@/server/http";
import { projectCtx, type SlugCtx } from "@/server/context";
import { ProjectPatch } from "@/server/validate";
import type { Project } from "@docmaker/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  return json(await engine.getProject(slug));
});

export const PATCH = handle(async (req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  const patch = parseOr400(ProjectPatch, await readJsonObject(req), "project patch") as Partial<Project>;
  return json(await engine.updateProject(slug, patch));
});
