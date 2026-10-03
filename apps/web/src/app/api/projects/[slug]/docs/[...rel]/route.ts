// GET → document + ETag · PUT (If-Match required; 412 on mismatch) → {etag, issues}. Allowlist: userEditable
// DOC_REGISTRY entries (outline, script, factcheck, plans, slices, user-picks, overrides, factsheet, entities, active take).
import { HttpError, handle, json, parseEtagList, parseOr400, quoteEtag, readJson } from "@/server/http";
import { projectCtx } from "@/server/context";
import { editableDoc } from "@/server/docs";
import { isDocmakerError } from "@docmaker/core";
import type { Engine } from "@docmaker/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; rel: string[] }> };

async function currentEtag(engine: Engine, slug: string, rel: string, schema: Parameters<Engine["readDoc"]>[2]): Promise<string | null> {
  try {
    return (await engine.readDoc(slug, rel, schema)).etag;
  } catch (e) {
    if (isDocmakerError(e) && e.code === "UPSTREAM_MISSING") return null;
    if ((e as { code?: unknown })?.code === "ENOENT") return null;
    throw e;
  }
}

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const p = await ctx.params;
  const { engine, slug } = await projectCtx(Promise.resolve(p));
  const { rel, entry } = editableDoc(p.rel);
  const { value, etag } = await engine.readDoc(slug, rel, entry.schema);
  const headers: Record<string, string> = etag ? { ETag: quoteEtag(etag) } : {};
  if (etag && parseEtagList(req.headers.get("if-none-match")).includes(etag)) return new Response(null, { status: 304, headers });
  return json(value, { headers });
});

export const PUT = handle(async (req: Request, ctx: Ctx) => {
  const p = await ctx.params;
  const { engine, slug } = await projectCtx(Promise.resolve(p));
  const { rel, entry } = editableDoc(p.rel);
  const ifMatch = parseEtagList(req.headers.get("if-match"));
  const ifNoneMatch = parseEtagList(req.headers.get("if-none-match"));
  if (!ifMatch.length && !ifNoneMatch.includes("*")) {
    throw new HttpError(428, "PRECONDITION_REQUIRED", "PUT needs If-Match (or If-None-Match: * to create the document)");
  }
  const current = await currentEtag(engine, slug, rel, entry.schema);
  const conflict = (msg: string) => new HttpError(412, "CONFLICT", msg, { etag: current }, current ? { ETag: quoteEtag(current) } : undefined);
  if (ifNoneMatch.includes("*") && current !== null) throw conflict(`${rel} already exists`);
  if (ifMatch.length && !(ifMatch.includes("*") ? current !== null : current !== null && ifMatch.includes(current))) {
    throw conflict(`${rel} changed since it was read`);
  }
  const value = parseOr400(entry.schema, await readJson(req), rel);
  try {
    const r = await engine.writeDoc(slug, rel, entry.schema, value as never, current);
    return json(r, { headers: { ETag: quoteEtag(r.etag) } });
  } catch (e) {
    if (isDocmakerError(e) && e.code === "CONFLICT") throw conflict(e.message);
    throw e;
  }
});
