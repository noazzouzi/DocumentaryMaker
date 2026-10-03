// Paid providers (M3): Brave image search (rights unknown, editorial only) and fal FLUX schnell (non-photoreal illustrations).
import { DocmakerError, sha16 } from "@docmaker/core";
import type { AssetProvider, Candidate, ProviderContext } from "@docmaker/core";
import { checkFalPrompt, FAL_NEGATIVE_PROMPT, falPrompt } from "../denylist";
import { licenseInfo } from "../license";
import { nowIso } from "../util";
import { downloadOriginal, qs, type SearchResult } from "./common";

// ------------------------------------------------------------------------------------------------ Brave
interface BraveResult { title?: string; url?: string; source?: string; thumbnail?: { src?: string }; properties?: { url?: string; width?: number; height?: number } }

export function parseBraveImages(json: unknown, o: { personBeat: boolean }): SearchResult[] {
  const out: SearchResult[] = [];
  for (const r of (json as { results?: BraveResult[] } | null)?.results ?? []) {
    const file = r.properties?.url;
    if (!file || !r.url) continue;
    const license = licenseInfo("UNKNOWN", { restrictions: ["unknown-rights", "editorial-only", ...(o.personBeat ? (["may-be-manipulated"] as const) : [])] });
    const candidate: Candidate = {
      provider: "brave", providerAssetId: sha16(file), kind: "image", title: r.title ?? "", description: r.source ?? "", tags: [],
      previewUrl: r.thumbnail?.src ?? file, downloadUrl: file, width: r.properties?.width ?? null, height: r.properties?.height ?? null,
      durationSec: null, license: { ...license, attributionText: `${r.title ?? "Image"} — ${r.source ?? ""} — ${r.url}` }, author: r.source ? { name: r.source, url: null } : null,
      sourcePageUrl: r.url, retrievedAt: nowIso(), youtube: null,
    };
    out.push({ candidate, raw: { year: null } });
  }
  return out;
}

export const braveProvider: AssetProvider = {
  id: "brave", kinds: ["image"], needsKey: true, paid: true, costPerCallUsd: 0.005, limits: { perMin: 50, concurrency: 1 },
  isConfigured: (s) => Boolean(s.brave),
  async search(q, ctx) {
    if (q.kind !== "image" || !ctx.secrets.brave) return [];
    const url = `https://api.search.brave.com/res/v1/images/search?${qs({ q: q.text, count: Math.min(50, Math.max(q.limit, 10)), safesearch: "strict" })}`;
    const json = await ctx.http.getJson<unknown>(url, { signal: ctx.signal, headers: { "x-subscription-token": ctx.secrets.brave }, cacheTtlSec: 86_400 });
    return parseBraveImages(json, { personBeat: q.personIds.length > 0 });
  },
  fetchOriginal: (c, destDir, ctx) => downloadOriginal(c, destDir, ctx),
};

// ------------------------------------------------------------------------------------------------ fal
export const FAL_ENDPOINT = "https://queue.fal.run/fal-ai/flux/schnell";
export const FAL_COST_PER_IMAGE_USD = 0.003;

/** The request body (also the receipt fingerprint input). */
export function falRequest(prompt: string, seed: number) {
  return { prompt, negative_prompt: FAL_NEGATIVE_PROMPT, image_size: "landscape_16_9", num_inference_steps: 4, seed, enable_safety_checker: true, num_images: 1 };
}

/** A "virtual" candidate: generation happens in fetchOriginal (only after the stage's cost gate and denylist checks). */
export function falCandidate(visualQuery: string, seed: number): Candidate {
  const prompt = falPrompt(visualQuery);
  return {
    provider: "fal", providerAssetId: `flux-schnell-${seed}-${sha16(prompt).slice(0, 8)}`, kind: "image", title: visualQuery, description: prompt, tags: ["illustration", "ai"],
    previewUrl: "", downloadUrl: "", width: 1024, height: 576, durationSec: null,
    license: licenseInfo("AI-GENERATED", { attributionText: "AI-generated illustration (FLUX.1 [schnell] via fal)" }), author: null, sourcePageUrl: "",
    retrievedAt: nowIso(), youtube: null,
  };
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(new DocmakerError("CANCELED", "canceled")); }, { once: true });
  });
}

const FAL_ORIGIN = new URL(FAL_ENDPOINT).origin;
export function isFalQueueUrl(u: string): boolean {
  try {
    return new URL(u).origin === FAL_ORIGIN;
  } catch {
    return false;
  }
}

export async function falGenerate(prompt: string, seed: number, ctx: ProviderContext): Promise<string> {
  const key = ctx.secrets.fal;
  if (!key) throw new DocmakerError("CONFIG_MISSING_KEY", "FAL_KEY is not set");
  const pre = checkFalPrompt(prompt, new Set());
  if (!pre.ok) throw new DocmakerError("POLICY_DENIED", `fal prompt refused: ${pre.reason}`);
  const headers = { authorization: `Key ${key}` };
  const job = await ctx.http.postJson<{ request_id?: string; status_url?: string; response_url?: string }>(FAL_ENDPOINT, falRequest(prompt, seed), { signal: ctx.signal, headers });
  if (!job.status_url || !job.response_url) throw new DocmakerError("PROVIDER_ERROR", "fal queue returned no status URL");
  // The key only ever goes to the fal queue origin, never to a URL a response handed us elsewhere.
  for (const u of [job.status_url, job.response_url]) if (!isFalQueueUrl(u)) throw new DocmakerError("PROVIDER_ERROR", "fal queue returned a URL outside queue.fal.run");
  const deadline = Date.now() + 180_000;
  for (;;) {
    const st = await ctx.http.getJson<{ status?: string }>(job.status_url, { signal: ctx.signal, headers });
    if (st.status === "COMPLETED") break;
    if (st.status && !["IN_QUEUE", "IN_PROGRESS"].includes(st.status)) throw new DocmakerError("PROVIDER_ERROR", `fal job ${st.status}`);
    if (Date.now() > deadline) throw new DocmakerError("PROVIDER_ERROR", "fal job timed out", { retryable: true });
    await sleep(1500, ctx.signal);
  }
  const res = await ctx.http.getJson<{ images?: { url?: string }[]; has_nsfw_concepts?: boolean[] }>(job.response_url, { signal: ctx.signal, headers });
  if (res.has_nsfw_concepts?.[0]) throw new DocmakerError("POLICY_DENIED", "fal safety checker flagged the image");
  const url = res.images?.[0]?.url;
  if (!url) throw new DocmakerError("PROVIDER_ERROR", "fal returned no image");
  return url;
}

export const falProvider: AssetProvider = {
  id: "fal", kinds: ["image"], needsKey: true, paid: true, costPerCallUsd: FAL_COST_PER_IMAGE_USD, limits: { perMin: 30, concurrency: 1 },
  isConfigured: (s) => Boolean(s.fal),
  async search(q, ctx) {
    // Only illustration queries reach fal; the stage has already applied the beat rules and the denylist.
    if (q.kind !== "image" || q.role !== "generated" || !ctx.secrets.fal || q.personIds.length > 0) return [];
    const seed = Number.parseInt(sha16(`${q.beatId ?? ""}|${q.text}`).slice(0, 8), 16);
    return [{ candidate: falCandidate(q.text, seed), raw: { year: null, seed } }];
  },
  async fetchOriginal(c, destDir, ctx) {
    const seed = Number(/^flux-schnell-(\d+)-/.exec(c.providerAssetId)?.[1] ?? 0);
    const url = await falGenerate(c.description || falPrompt(c.title), seed, ctx);
    return downloadOriginal(c, destDir, ctx, { url });
  },
};
