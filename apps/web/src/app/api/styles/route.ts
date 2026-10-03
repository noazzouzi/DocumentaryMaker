// GET → StyleSummary[] (built-in + user styles)
import { handle, json } from "@/server/http";
import { getEngine } from "@/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => json(await (await getEngine()).listStyles()));
