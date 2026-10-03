// GET ?mirror=1 → (re)generates voice/<lang>/teleprompter.html from the current script (engine.teleprompter, the same
// as `docmaker voice teleprompter`) and returns it as a download. The page carries an inline scroll script: it is only
// ever sent as an attachment, and sandboxed (opaque origin) should a browser render it in place.
import { readFile } from "node:fs/promises";
import type { EngineExt } from "@docmaker/engine";
import { HttpError, handle, langParam } from "@/server/http";
import { projectCtx } from "@/server/context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; lang: string }> };
type WithTeleprompter = Partial<Pick<EngineExt, "teleprompter">>;

export const GET = handle(async (req: Request, ctx: Ctx) => {
  const p = await ctx.params;
  const { engine, slug } = await projectCtx(Promise.resolve(p));
  const lang = langParam(p.lang);
  const mirror = new URL(req.url).searchParams.get("mirror") === "1";
  const ext = engine as unknown as WithTeleprompter;
  if (typeof ext.teleprompter !== "function") throw new HttpError(501, "NOT_IMPLEMENTED", "teleprompter unavailable");
  const html = await readFile(await ext.teleprompter(slug, lang, { mirror }));
  return new Response(new Uint8Array(html), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-${lang}-teleprompter${mirror ? "-mirror" : ""}.html"`,
      "Content-Length": String(html.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      "X-Frame-Options": "DENY",
    },
  });
});
