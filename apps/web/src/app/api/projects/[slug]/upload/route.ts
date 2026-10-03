// POST ?kind=asset|recording&lang=&segmentId= multipart (≤ 2 GiB, streamed to <project>/uploads/) + `declaration` (JSON,
// required for assets) → {rel, asset}. This route is excluded from the proxy (it would buffer the body): it runs the same
// Host/Origin guard itself.
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { HttpError, errorResponse, json, optionalLang, parseOr400, slugParam } from "@/server/http";
import { checkRequest, guardInputOf, portsFromEnv } from "@/server/guards";
import { getEngine, projectDirOf } from "@/server/runtime";
import { parseMultipart, type MultipartFile } from "@/server/multipart";
import { UploadDeclaration } from "@docmaker/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
const ASSET_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "bmp", "mp4", "mov", "m4v", "webm", "mkv", "avi", "wav", "mp3", "m4a", "flac", "ogg", "aac"]);
const RECORDING_EXT = new Set(["wav", "mp3", "m4a", "flac", "ogg", "opus", "webm", "aac", "mp4", "mov"]);

type Ctx = { params: Promise<{ slug: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const url = new URL(req.url);
  const g = checkRequest(guardInputOf(req, url.pathname), { ports: portsFromEnv(process.env) });
  if (!g.ok) return json({ error: { code: "FORBIDDEN", message: g.reason } }, { status: g.status });
  let file: MultipartFile | null = null;
  try {
    const slug = slugParam((await ctx.params).slug);
    const kind = url.searchParams.get("kind");
    if (kind !== "asset" && kind !== "recording") throw new HttpError(400, "VALIDATION", "kind must be asset or recording");
    const lang = optionalLang(url.searchParams.get("lang"));
    const segRaw = url.searchParams.get("segmentId");
    const segmentId = segRaw ? segRaw : null;
    if (segmentId !== null && !/^CH\d{1,2}-S\d{2,3}$/.test(segmentId)) throw new HttpError(400, "VALIDATION", "invalid segmentId");
    if (kind === "recording" && !lang) throw new HttpError(400, "VALIDATION", "a recording needs lang");
    const engine = await getEngine();
    await engine.getProject(slug); // 404 for an unknown project before accepting bytes
    const dir = path.join(projectDirOf(engine, slug), "uploads");
    await mkdir(dir, { recursive: true });
    const parsed = await parseMultipart(req.body, req.headers.get("content-type"), {
      dir, maxFileBytes: MAX_UPLOAD_BYTES, maxFiles: 1, allowedExt: kind === "asset" ? ASSET_EXT : RECORDING_EXT,
    });
    file = parsed.files[0] ?? null;
    if (!file || file.bytes === 0) throw new HttpError(400, "VALIDATION", "no file in the upload");
    let declaration: UploadDeclaration | null = null;
    if (kind === "asset") {
      const raw = parsed.fields.declaration;
      if (!raw) throw new HttpError(400, "DECLARATION_REQUIRED", "a licence declaration is required for every uploaded asset");
      let v: unknown;
      try {
        v = JSON.parse(raw);
      } catch {
        throw new HttpError(400, "DECLARATION_REQUIRED", "the declaration is not valid JSON");
      }
      declaration = parseOr400(UploadDeclaration, v, "licence declaration");
      if (declaration.kind === "licensed" && !declaration.license) throw new HttpError(400, "DECLARATION_REQUIRED", "a licensed upload needs its licence code");
      if ((declaration.kind === "licensed" || declaration.kind === "third-party-quotation") && !declaration.url.trim()) {
        throw new HttpError(400, "DECLARATION_REQUIRED", "say where the file comes from (URL)");
      }
    }
    const r = await engine.upload(slug, { tmpPath: file.path, kind, lang, declaration, segmentId });
    return json(r, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  } finally {
    if (file) await rm(file.path, { force: true }).catch(() => {});
  }
}
