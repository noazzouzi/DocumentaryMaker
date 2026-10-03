// GET → project list · POST NewProjectInput → Project (201)
import { getEngine } from "@/server/runtime";
import { handle, json, parseOr400, readJsonObject } from "@/server/http";
import { NewProjectInput } from "@/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handle(async () => json(await (await getEngine()).listProjects()));

export const POST = handle(async (req: Request) => {
  const input = parseOr400(NewProjectInput, await readJsonObject(req), "new project");
  const project = await (await getEngine()).createProject(input);
  return json(project, { status: 201 });
});
