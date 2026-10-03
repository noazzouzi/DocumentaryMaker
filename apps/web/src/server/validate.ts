// Request-body schemas derived from the core contract (the web app has no direct zod dependency) + small validators.
import "server-only";
import {
  Approval, AssetKind, AssetProviderId, ENV_KEYS, GateId, HomeConfig, JobOptions, JobRequest, Lang, NewProjectInput, Project,
  RenderPresetId, StageId, type SecretName,
} from "@docmaker/core";
import { HttpError, parseOr400 } from "./http";

/** PATCH /api/projects/[slug]: identity and bookkeeping fields are never patchable (LOCKED_AFTER_START is the engine's). */
export const ProjectPatch = Project.omit({ schemaVersion: true, formatVersion: true, slug: true, createdAt: true, updatedAt: true }).partial().strict();
export const HomePatch = HomeConfig.omit({ schemaVersion: true }).partial().strict();
/** The client never chooses `by`: web approvals are always by "web" (editorial gates refuse flag/auto-threshold anyway). */
export const ApprovalBody = Approval.omit({ gate: true, approvedAt: true, by: true }).strict();
export { NewProjectInput };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function str(v: unknown, what: string, o: { min?: number; max?: number; optional?: false } = {}): string {
  if (typeof v !== "string") throw new HttpError(400, "VALIDATION", `${what} must be a string`);
  if (v.length < (o.min ?? 0)) throw new HttpError(400, "VALIDATION", `${what} is too short`);
  if (v.length > (o.max ?? 10_000)) throw new HttpError(400, "VALIDATION", `${what} is too long`);
  return v;
}
export function int(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, "VALIDATION", `${what} must be an integer in [${min}, ${max}]`);
  return v;
}
export function enumOf<T extends string>(schema: { options: readonly T[] }, v: unknown, what: string): T {
  if (typeof v !== "string" || !(schema.options as readonly string[]).includes(v)) {
    throw new HttpError(400, "VALIDATION", `${what} must be one of ${schema.options.join(", ")}`);
  }
  return v as T;
}

export const SECRET_NAMES = Object.keys(ENV_KEYS) as SecretName[];
export function secretNameParam(v: unknown): SecretName {
  if (typeof v !== "string" || !(SECRET_NAMES as string[]).includes(v)) throw new HttpError(400, "VALIDATION", `unknown key name (one of ${SECRET_NAMES.join(", ")})`);
  return v as SecretName;
}
/** Secret values are single-line printable strings (a newline would inject extra lines into <home>/.env). */
export function secretValue(v: unknown): string {
  const s = str(v, "value", { min: 1, max: 4096 }).trim();
  if (!s || /[\r\n\0]/.test(s) || /[^\x20-\x7e]/.test(s)) throw new HttpError(400, "VALIDATION", "the key must be a single line of printable ASCII");
  return s;
}

/** Fills defaults so the UI can post partial requests; the URL slug wins. Only stage/pipeline jobs come from the web. */
export function jobRequestFrom(slug: string, body: Record<string, unknown>): JobRequest {
  if (body.slug !== undefined && body.slug !== slug) throw new HttpError(400, "VALIDATION", "slug mismatch");
  const req = parseOr400(JobRequest, {
    slug,
    kind: body.kind ?? "pipeline",
    stage: body.stage ?? null,
    from: body.from ?? null,
    to: body.to ?? null,
    langs: body.langs ?? [],
    force: body.force ?? false,
    options: body.options ?? {},
    preset: body.preset ?? null,
  }, "job request");
  if (req.kind !== "stage" && req.kind !== "pipeline") {
    throw new HttpError(400, "VALIDATION", req.kind === "setup" ? "setup actions run from the CLI (docmaker setup …)" : "start the demo with POST /api/demo");
  }
  if (req.kind === "stage" && !req.stage) throw new HttpError(400, "VALIDATION", "a stage job needs `stage`");
  return req;
}

export function approvalFrom(body: Record<string, unknown>): { gate: GateId; a: Omit<Approval, "gate" | "approvedAt"> } {
  const gate = enumOf(GateId, body.gate, "gate");
  const rest = { ...body };
  delete rest.gate;
  delete rest.by; // ignored: the server sets it
  // editorial gates recompute their planHash server-side; the outline approval and the cost gate need the reviewed hash
  if (rest.planHash === undefined || rest.planHash === null || rest.planHash === "") {
    if (gate === "outline-approval" || gate === "cost") throw new HttpError(400, "VALIDATION", `${gate} needs the planHash of what was reviewed`);
    rest.planHash = "0".repeat(64);
  }
  const a = parseOr400(ApprovalBody, { lang: null, note: "", items: [], itemNotes: {}, ...rest }, "approval");
  return { gate, a: { ...a, by: "web" } };
}

export function homePatchFrom(body: Record<string, unknown>, now = new Date()): ReturnType<typeof HomePatch.parse> {
  const b = { ...body };
  // the licence choice is timestamped by the server (the user decides the status, never the tool)
  if (isObj(b.remotionLicense)) b.remotionLicense = { status: b.remotionLicense.status, acknowledgedAt: now.toISOString() };
  return parseOr400(HomePatch, b, "home config patch");
}

export function liveSearchFrom(q: URLSearchParams): { beatId: string; text: string; kind: AssetKind; providers: AssetProviderId[]; allowPaid: boolean } {
  const beatId = str(q.get("beat") ?? "", "beat", { min: 1, max: 40 });
  if (!/^CH\d{1,2}-(B\d{3}|S\d{2,3}-(CLIP|BR))$/.test(beatId)) throw new HttpError(400, "VALIDATION", "invalid beat id");
  const text = str(q.get("q") ?? "", "q", { min: 1, max: 300 }).trim();
  if (!text) throw new HttpError(400, "VALIDATION", "q is empty");
  const kind = enumOf(AssetKind, q.get("kind") ?? "image", "kind");
  const raw = (q.get("providers") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const providers = [...new Set(raw.map((p) => enumOf(AssetProviderId, p, "provider")))];
  const allowPaid = q.get("allowPaid") === "1" || q.get("allowPaid") === "true";
  return { beatId, text, kind, providers, allowPaid };
}

/** Freeze takes a candidate REFERENCE only: licence/author/url fields from the client are ignored (§14.3). */
export function freezeFrom(body: Record<string, unknown>): { beatId: string; slot: number; provider: AssetProviderId; providerAssetId: string } {
  const beatId = str(body.beatId, "beatId", { min: 1, max: 40 });
  if (!/^CH\d{1,2}-(B\d{3}|S\d{2,3}-(CLIP|BR))$/.test(beatId)) throw new HttpError(400, "VALIDATION", "invalid beat id");
  return {
    beatId,
    slot: int(body.slot, "slot", 0, 15),
    provider: enumOf(AssetProviderId, body.provider, "provider"),
    providerAssetId: str(body.providerAssetId, "providerAssetId", { min: 1, max: 1000 }),
  };
}

export function clipResolveFrom(body: Record<string, unknown>) {
  const segmentId = str(body.segmentId, "segmentId", { min: 1, max: 20 });
  if (!/^CH\d{1,2}-S\d{2,3}$/.test(segmentId)) throw new HttpError(400, "VALIDATION", "invalid segment id");
  const url = body.url === undefined || body.url === null || body.url === "" ? null : str(body.url, "url", { max: 2000 });
  if (url !== null) {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      throw new HttpError(400, "VALIDATION", "invalid url");
    }
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new HttpError(400, "VALIDATION", "the url must be http(s)");
  }
  const uploadRel = body.uploadRel === undefined || body.uploadRel === null || body.uploadRel === "" ? null : str(body.uploadRel, "uploadRel", { max: 300 });
  if (uploadRel !== null && (uploadRel.includes("..") || uploadRel.startsWith("/") || !/^(media|uploads)\//.test(uploadRel))) {
    throw new HttpError(400, "VALIDATION", "uploadRel must be a project media/ or uploads/ path");
  }
  if (url === null && uploadRel === null) throw new HttpError(400, "VALIDATION", "a URL or an uploaded file is required");
  const startMs = int(body.startMs, "startMs", 0, 24 * 3600 * 1000);
  const endMs = int(body.endMs, "endMs", 1, 24 * 3600 * 1000);
  if (endMs <= startMs) throw new HttpError(400, "VALIDATION", "endMs must be after startMs");
  return {
    segmentId, url, uploadRel, startMs, endMs,
    channel: str(body.channel ?? "", "channel", { max: 200 }),
    title: str(body.title ?? "", "title", { max: 300 }),
  };
}

export function stageParam(v: string | null, what = "stage"): StageId {
  return enumOf(StageId, v, what);
}
export function langsParam(v: string | null): Lang[] {
  if (!v) return [];
  return [...new Set(v.split(",").map((s) => enumOf(Lang, s.trim(), "langs")))];
}
export { JobOptions, RenderPresetId };
