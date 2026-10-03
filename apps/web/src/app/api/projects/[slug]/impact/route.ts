// POST Partial<Project> | {doc} → ImpactReport (shown before edits that stale downstream work)
import { HttpError, handle, json, parseOr400, readJsonObject } from "@/server/http";
import { projectCtx, type SlugCtx } from "@/server/context";
import { ProjectPatch } from "@/server/validate";
import { docEntryFor, type Project } from "@docmaker/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = handle(async (req: Request, ctx: SlugCtx) => {
  const { engine, slug } = await projectCtx(ctx.params);
  const body = await readJsonObject(req);
  if (typeof body.doc === "string") {
    if (Object.keys(body).length !== 1) throw new HttpError(400, "VALIDATION", "{doc} takes no other field");
    if (!docEntryFor(body.doc)?.userEditable) throw new HttpError(400, "VALIDATION", "unknown document");
    return json(await engine.impact(slug, { doc: body.doc }));
  }
  return json(await engine.impact(slug, parseOr400(ProjectPatch, body, "project patch") as Partial<Project>));
});
