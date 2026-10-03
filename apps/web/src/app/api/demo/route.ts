// POST {fixture?, langs?, onlyChapters?} → 202 {slug, jobId} (additive): starts the offline demo (fixture LLM, offline assets, draft) in
// the background and returns as soon as its job is queued, so the overview page can attach to the live log.
import { HttpError, handle, json, readJsonObject } from "@/server/http";
import { getEngine } from "@/server/runtime";
import { langsParam } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pad = (n: number) => String(n).padStart(2, "0");
function demoSlugFor(fixture: string, d: Date): string {
  return `demo-${fixture}-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

export const POST = handle(async (req: Request) => {
  const body = req.headers.get("content-length") === "0" ? {} : await readJsonObject(req).catch(() => ({}) as Record<string, unknown>);
  const fixture = typeof body.fixture === "string" ? body.fixture : "tulip-mania";
  if (!/^[a-z0-9-]{1,40}$/.test(fixture)) throw new HttpError(400, "VALIDATION", "invalid fixture id");
  const langs = Array.isArray(body.langs) ? langsParam(body.langs.join(",")) : ["en" as const];
  const only = Array.isArray(body.onlyChapters) ? body.onlyChapters.map(String) : null;
  if (only && (only.length > 60 || only.some((c) => !/^CH\d{1,2}$/.test(c)))) throw new HttpError(400, "VALIDATION", "onlyChapters must be chapter ids (CH1, CH2…)");
  const engine = await getEngine();
  const slug = demoSlugFor(fixture, new Date());
  let failure: unknown = null;
  engine
    .runDemo({ fixture, langs, offline: true, tts: "auto", preset: "draft", onlyChapters: only && only.length ? only : null, slug })
    .catch((e: unknown) => {
      failure = e;
      console.error(`[docmaker-web] demo ${slug} ended with an error`, e instanceof Error ? e.message : e);
    });
  // wait (≤ 20 s) until the project exists and its job is visible
  for (let i = 0; i < 100; i++) {
    if (failure) throw failure;
    const s = await engine.status(slug).catch(() => null);
    if (s?.activeJobId) return json({ slug, jobId: s.activeJobId }, { status: 202 });
    const jobs = s ? await engine.listJobs(slug).catch(() => []) : [];
    if (jobs.length) return json({ slug, jobId: jobs[0]!.id }, { status: 202 });
    await new Promise((r) => setTimeout(r, 200));
  }
  return json({ slug, jobId: null }, { status: 202 });
});
