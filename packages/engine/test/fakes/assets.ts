// Fake @docmaker/assets (walking skeleton, §16.5): offline-only; four deterministic gradient stills reused round-robin,
// clips "skipped-offline", a ledger of PROCEDURAL entries, quotes left "unchecked". No network, no cache index.
import { copyFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  DocmakerError, FrozenAsset, P, docHash, type AssetPick, type ClipResolution, type FrozenDoc, type Ledger, type LicenseInfo,
} from "@docmaker/core";
import type { AssetsApi, FrozenCacheLike } from "../../src/deps";
import { gradientStill, sha256File } from "./media";

const PROC: LicenseInfo = { code: "PROCEDURAL", version: null, url: null, commercialOk: true, derivativesOk: true, attributionRequired: false, attributionText: null, restrictions: [] };
const SCORE = { metadata: 0.5, clip: null, vision: null, technical: null, watermark: null, nsfw: null, total: 0.5, focal: null, safeCrop: null, notes: "fake" };
const offline = () => new DocmakerError("OFFLINE", "the walking-skeleton HttpClient never opens a socket");
const NOW = "2026-10-02T00:00:00.000Z";

async function freezeLocal(file: string, ext: "jpg" | "png" | "mp4" | "wav", projectDir: string, o: { kind: FrozenAsset["kind"]; role: FrozenAsset["role"]; recipe: string; width: number | null; height: number | null; durationMs: number | null; hasAudio: boolean; lufs: number | null }): Promise<FrozenAsset> {
  const sha = await sha256File(file);
  const rel = P.media(sha, ext);
  const abs = path.join(projectDir, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  await stat(abs).catch(() => copyFile(file, abs));
  const bytes = (await stat(abs)).size;
  return FrozenAsset.parse({
    id: sha, originalSha256: sha, kind: o.kind, role: o.role, mime: ext === "jpg" ? "image/jpeg" : ext === "png" ? "image/png" : ext === "mp4" ? "video/mp4" : "audio/wav", ext, bytes,
    width: o.width, height: o.height, durationMs: o.durationMs, fps: null, hasAudio: o.hasAudio, lufs: o.lufs, cacheRel: `blobs/${sha.slice(0, 2)}/${sha}.${ext}`, projectRel: rel,
    candidate: null, declaration: null, conform: { recipe: o.recipe, sourceInMs: null, sourceOutMs: null, handleHeadMs: 0, handleTailMs: 0 },
    analysis: { grayscale: false, meanLuma: 0.35, year: null, lowRes: false }, frozenAt: NOW,
  });
}

export function makeFakeAssets(): AssetsApi {
  const http = { getJson: () => Promise.reject(offline()), getText: () => Promise.reject(offline()), postForm: () => Promise.reject(offline()), postJson: () => Promise.reject(offline()), download: () => Promise.reject(offline()) };
  const api: Partial<AssetsApi> = {
    createHttpClient: (() => http) as unknown as AssetsApi["createHttpClient"],
    createFrozenCache: () => ({}) as FrozenCacheLike,
    async resolveAssets(i, ctx) {
      const pal = i.style.tokens.palette;
      const colors: [string, string][] = [[pal.ink, pal.accent], [pal.secondary, pal.ink], [pal.ink, pal.secondary], [pal.accent, pal.ink]];
      const tmp = path.join(i.projectDir, "assets", ".tmp-fake");
      const stills: FrozenAsset[] = [];
      for (const [k, c] of colors.entries()) {
        const f = path.join(tmp, `still-${k}.jpg`);
        await gradientStill(ctx.config, f, 1000 + k, c, ctx.signal);
        stills.push(await freezeLocal(f, "jpg", i.projectDir, { kind: "image", role: "generated", recipe: "proc-gradient-v1", width: 1920, height: 1080, durationMs: null, hasAudio: false, lufs: null }));
      }
      const plans = [...i.plans.plans].sort((a, b) => a.order - b.order);
      const userWins = new Map(i.userPicks.picks.map((p) => [`${p.beatId}#${p.slot}`, p]));
      const picks: AssetPick[] = [];
      const orphans: AssetPick[] = [];
      let n = 0;
      for (const plan of plans) {
        if (plan.id.endsWith("-CLIP")) continue;
        const up = userWins.get(`${plan.id}#0`);
        if (up && up.planKey === plan.planKey) {
          picks.push(up);
          continue;
        }
        if (up) orphans.push(up);
        const a = stills[n++ % stills.length]!;
        picks.push({ beatId: plan.id, slot: 0, assetId: a.id, role: "primary", focal: { x: 0.5, y: 0.45 }, crop: null, sourceInMs: null, sourceOutMs: null, score: SCORE, pickedBy: "auto", planKey: plan.planKey });
      }
      const clips: ClipResolution[] = i.primaryScript.chapters.flatMap((c) => c.segments.filter((s) => s.type === "clip" && s.quoteId).map((s) => ({
        segmentId: s.id, quoteId: s.quoteId!, assetId: null, status: "skipped-offline" as const, source: "auto" as const, youtube: null, passageInMs: null, passageOutMs: null, reason: "offline (walking skeleton)",
      })));
      const userFrozen = await api.readUserFrozen!(i.projectDir);
      const frozen: FrozenDoc = { schemaVersion: 1, assets: { ...userFrozen, ...Object.fromEntries(Object.entries(i.previous.frozen?.assets ?? {}).filter(([, a]) => a.role === "music")), ...Object.fromEntries(stills.map((s) => [s.id, s])) } };
      const ledger: Ledger = {
        schemaVersion: 1,
        entries: stills.map((s) => ({ assetId: s.id, provider: "procedural" as const, title: "Procedural gradient", sourcePageUrl: "", fileUrl: "", author: null, license: PROC, attributionText: "Procedural graphics generated by DocumentaryMaker", retrievedAt: NOW, youtube: null, declaration: null, transformations: [] })),
      };
      return {
        picks: { schemaVersion: 1, plansHash: docHash(i.plans), picks, clips, portraits: [], orphans, updatedAt: NOW },
        frozen, ledger, candidates: [], clipWords: [],
      };
    },
    async freezeFile(i) {
      return freezeLocal(i.conform.file, i.conform.ext, i.projectDir, {
        kind: i.kind, role: i.role, recipe: i.conform.recipe, width: i.conform.width, height: i.conform.height, durationMs: i.conform.durationMs, hasAudio: i.conform.hasAudio, lufs: i.conform.lufs,
      });
    },
    async conformAudio(src) {
      return { file: src, ext: "wav", width: null, height: null, durationMs: null, fps: null, hasAudio: true, lufs: -18, recipe: "audio-norm-v1", sourceInMs: null, sourceOutMs: null, handleHeadMs: 0, handleTailMs: 0, analysis: { grayscale: null, meanLuma: null, year: null, lowRes: false } };
    },
    validatePick: () => [],
    buildCredits(i) {
      const lines = [`# Credits (${i.lang})`, "", "## Images", ...i.ledger.entries.map((e) => `- ${e.title} — ${e.attributionText}`), "", "## Music", ...i.music.tracks.map((t) => `- ${t.title} (procedural)`), "", "## Voice", i.voice ? `- ${i.voice.provider} (${i.voice.voiceId})` : "- none", ""];
      return lines.join("\n");
    },
    async verifyQuotes(fs) {
      return { factSheet: fs, items: fs.quotes.map((q) => ({ ref: q.id, check: "quote-verbatim" as const, ok: false, detail: "skipped-offline" })) };
    },
    async resolveEntity() {
      return null;
    },
    videoVerifiedQuotes: () => [],
    async readUserFrozen(projectDir: string) {
      const dir = path.join(projectDir, "assets", "user-frozen");
      const out: Record<string, FrozenAsset> = {};
      for (const f of await readdir(dir).catch(() => [] as string[])) {
        const r = FrozenAsset.safeParse(JSON.parse(await readFile(path.join(dir, f), "utf8")));
        if (r.success) out[r.data.id] = r.data;
      }
      return out;
    },
    async collectReferencedBlobs() {
      return new Set<string>();
    },
    requireDeclaration: ((d: unknown) => {
      if (!d) throw new DocmakerError("VALIDATION", "an upload needs a licence declaration");
      return d;
    }) as AssetsApi["requireDeclaration"],
    async liveSearch() {
      throw offline();
    },
    async freezeCandidate() {
      throw offline();
    },
    async ytProbe() {
      return "offline" as const;
    },
  };
  return api as AssetsApi;
}
