// GET → versions of a user-editable document · POST {file} → revert to that version ({etag})
import { handle, json, quoteEtag, readJsonObject } from "@/server/http";
import { projectCtx } from "@/server/context";
import { editableDoc, historyFileParam } from "@/server/docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; rel: string[] }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const p = await ctx.params;
  const { engine, slug } = await projectCtx(Promise.resolve(p));
  const { rel } = editableDoc(p.rel);
  return json(await engine.history(slug, rel));
});

export const POST = handle(async (req: Request, ctx: Ctx) => {
  const p = await ctx.params;
  const { engine, slug } = await projectCtx(Promise.resolve(p));
  const { rel } = editableDoc(p.rel);
  const file = historyFileParam((await readJsonObject(req)).file, rel);
  const r = await engine.revert(slug, rel, file);
  return json(r, { headers: { ETag: quoteEtag(r.etag) } });
});
