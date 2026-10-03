// GET → Timeline (+ ETag); ?layout=1 → ProgramLayout
import { handle, json, langParam, parseEtagList, quoteEtag } from "@/server/http";
import { projectCtx } from "@/server/context";
import { P, ProgramLayout, Timeline } from "@docmaker/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; lang: string }> };

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const p = await ctx.params;
  const { engine, slug } = await projectCtx(Promise.resolve(p));
  const lang = langParam(p.lang);
  const layout = new URL(req.url).searchParams.get("layout") === "1";
  const { value, etag } = layout ? await engine.readDoc(slug, P.layout(lang), ProgramLayout) : await engine.readDoc(slug, P.timeline(lang), Timeline);
  const headers: Record<string, string> = etag ? { ETag: quoteEtag(etag) } : {};
  if (etag && parseEtagList(req.headers.get("if-none-match")).includes(etag)) return new Response(null, { status: 304, headers });
  return json(value, { headers });
});
