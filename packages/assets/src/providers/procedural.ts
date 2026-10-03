// Procedural provider (§7.9): deterministic lavfi recipes, always available offline. Seed = fnv1a32(beatId + ":" + slot).
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { DocmakerError, fnv1a32 } from "@docmaker/core";
import type { AssetProvider, AssetQuery, Candidate, ProviderContext, RuntimeConfig } from "@docmaker/core";
import { ffmpeg } from "@docmaker/core/node";
import { licenseInfo } from "../license";
import { nowIso } from "../util";

export interface ProceduralRecipe {
  id: string;
  kind: "image" | "video";
  args: (o: { seed: number; palette: string[]; fps: number; seconds: number }) => string[];
}

/** "#RRGGBB" → "0xRRGGBB" (ffmpeg colour syntax). */
export function ffColor(hex: string | undefined, fallback: string): string {
  const h = (hex ?? fallback).replace(/^#/, "").slice(0, 6);
  return /^[0-9a-fA-F]{6}$/.test(h) ? `0x${h.toLowerCase()}` : `0x${fallback.replace(/^#/, "")}`;
}
const INK = "#0e0f12";
const ACCENT = "#e8b13a";
const SECOND = "#3a5a8c";
const pal = (p: string[]) => ({ ink: ffColor(p[0], INK), accent: ffColor(p[1], ACCENT), second: ffColor(p[2], SECOND) });
const PAPER = "#e0cfa8";
/** Linear mix of two "#RRGGBB" colours (t = share of b) → ffmpeg colour. */
export function mixColor(a: string | undefined, b: string | undefined, t: number, fa = INK, fb = PAPER): string {
  const rgb = (h: string) => { const x = ffColor(h, h).slice(2); return [0, 2, 4].map((k) => parseInt(x.slice(k, k + 2), 16)); };
  const A = rgb(a ?? fa);
  const B = rgb(b ?? fb);
  return `0x${A.map((v, k) => Math.round(v * (1 - t) + B[k]! * t).toString(16).padStart(2, "0")).join("")}`;
}
/** Muted drama palette for moving backdrops: ink, the accent pulled toward ink, and a dim paper tone (never a pure primary). */
const muted = (p: string[]) => ({ ink: ffColor(p[0], INK), accent: mixColor(p[1] ?? ACCENT, p[0] ?? INK, 0.55), paper: mixColor(p[0] ?? INK, PAPER, 0.28) });
/** Seeded phase in [0, 2π) with 2 decimals (deterministic expression text). */
const phase = (seed: number, k: number) => (((Math.abs(Math.trunc(seed)) >>> (k * 3)) % 628) / 100).toFixed(2);
const seedOf = (s: number) => String(Math.abs(Math.trunc(s)) % 4294967296);
const VIDEO_OUT = (fps: number, seconds: number) => ["-t", seconds.toFixed(3), "-r", String(fps), "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "16"];

export const PROCEDURAL_RECIPES: readonly ProceduralRecipe[] = [
  {
    // Moon look. NB: gradients speed=0 is rejected by ffmpeg 6.1 (range [1e-05, 1]).
    id: "gradient-grid", kind: "image",
    args: ({ seed, palette }) => {
      const c = muted(palette);
      return ["-f", "lavfi", "-i", `gradients=s=1920x1080:c0=${c.ink}:c1=${c.accent}:x0=0:y0=0:x1=1920:y1=1080:nb_colors=2:seed=${seedOf(seed)}:speed=0.00001,hue=s=0.6,drawgrid=w=150:h=150:t=2:c=white@0.10,noise=alls=6:allf=u`, "-frames:v", "1"];
    },
  },
  {
    // Aged ledger paper: low-frequency stains, ruled lines, a margin rule and a printed double frame — visible structure for
    // camera moves and a period backdrop for text cards (a flat vignette read as an empty frame).
    id: "archive-still", kind: "image",
    args: ({ seed }) => {
      const S = `(sin(X/211+${phase(seed, 0)})*sin(Y/157+${phase(seed, 1)})+0.5*sin(X/97+${phase(seed, 2)})*cos(Y/83+${phase(seed, 3)})+0.25*cos(X/41+${phase(seed, 4)})*sin(Y/37+${phase(seed, 5)}))`;
      const rule = 44 + (Math.abs(Math.trunc(seed)) % 13);
      const margin = 200 + (Math.abs(Math.trunc(seed >> 4)) % 120);
      return [
        "-f", "lavfi", "-i",
        `color=c=0xe0cfa8:s=1920x1080,format=rgb24,geq=r='clip(r(X,Y)-16*${S}-14,0,255)':g='clip(g(X,Y)-20*${S}-18,0,255)':b='clip(b(X,Y)-24*${S}-22,0,255)',`
        + `drawgrid=w=1920:h=${rule}:x=0:y=${rule - 14}:t=2:c=0x5a4a36@0.22,drawbox=x=${margin}:y=0:w=3:h=1080:c=0x8a3a2a@0.30:t=fill,`
        + "drawbox=x=70:y=56:w=1780:h=968:c=0x3b2f22@0.55:t=3,drawbox=x=82:y=68:w=1756:h=944:c=0x3b2f22@0.35:t=1,"
        + `noise=alls=14:allf=u:all_seed=${Math.abs(Math.trunc(seed)) % 2147483647},vignette=PI/4.5`,
        "-frames:v", "1",
      ];
    },
  },
  {
    // Slow drift between ink and a muted accent (saturation pulled down: the style's pure primaries clash with stills).
    id: "drift-gradient", kind: "video",
    args: ({ seed, palette, fps, seconds }) => {
      const c = muted(palette);
      return ["-f", "lavfi", "-i", `gradients=s=1920x1080:c0=${c.ink}:c1=${c.accent}:c2=${c.paper}:nb_colors=3:seed=${seedOf(seed)}:speed=0.012:r=${fps},hue=s=0.6,vignette=PI/5`, ...VIDEO_OUT(fps, seconds)];
    },
  },
  {
    id: "life-texture", kind: "video",
    args: ({ seed, palette, fps, seconds }) => {
      const c = pal(palette);
      return ["-f", "lavfi", "-i", `life=s=480x270:mold=10:r=${fps}:ratio=0.08:seed=${seedOf(seed)}:life_color=${c.accent}:death_color=${c.ink},scale=1920:1080:flags=neighbor`, ...VIDEO_OUT(fps, seconds)];
    },
  },
  {
    id: "scanline-news", kind: "video",
    args: ({ seed, palette, fps, seconds }) => {
      const c = muted(palette);
      return ["-f", "lavfi", "-i", `gradients=s=1920x1080:c0=${c.ink}:c1=${c.paper}:nb_colors=2:seed=${seedOf(seed)}:speed=0.01:r=${fps},hue=s=0.5,drawgrid=w=1920:h=4:t=1:c=black@0.25`, ...VIDEO_OUT(fps, seconds)];
    },
  },
  {
    // Moving paper: the ledger stains drift slowly under a soft light (replaces life-texture, which read as a dead signal).
    id: "paper-drift", kind: "video",
    args: ({ seed, fps, seconds }) => {
      // Evaluated on a 480×270 grid (frequencies ÷ 4) then scaled up: cheap per frame, smooth after bicubic scaling.
      const S = `(sin(X/58+${phase(seed, 0)}+T*0.11)*sin(Y/43+${phase(seed, 1)})+0.5*sin(X/25+${phase(seed, 2)})*cos(Y/22+${phase(seed, 3)}-T*0.07))`;
      return [
        "-f", "lavfi", "-i",
        `color=c=0xd6c49c:s=480x270:r=${fps},format=rgb24,geq=r='clip(r(X,Y)-18*${S}-16,0,255)':g='clip(g(X,Y)-22*${S}-20,0,255)':b='clip(b(X,Y)-26*${S}-24,0,255)',`
        + "scale=1920:1080:flags=bicubic,vignette=PI/4.5",
        ...VIDEO_OUT(fps, seconds),
      ];
    },
  },
];

export function recipeById(id: string): ProceduralRecipe {
  const r = PROCEDURAL_RECIPES.find((x) => x.id === id);
  if (!r) throw new DocmakerError("VALIDATION", `unknown procedural recipe ${id}`);
  return r;
}

/** Renders a recipe to <outDir>/proc-<recipe>-<seed>.(png|mp4) (deterministic). */
export async function proceduralAsset(i: { recipe: string; seed: number; palette: string[]; fps: number; seconds: number; outDir: string }, ctx: { config: RuntimeConfig; signal: AbortSignal }): Promise<string> {
  const r = recipeById(i.recipe);
  await mkdir(i.outDir, { recursive: true });
  const palKey = i.palette.slice(0, 3).map((p) => p.replace(/^#/, "").toLowerCase()).join("-");
  const out = path.join(i.outDir, `proc-${r.id}-${seedOf(i.seed)}-${palKey || "default"}${r.kind === "video" ? `-${i.fps}-${Math.round(i.seconds * 1000)}` : ""}.${r.kind === "image" ? "png" : "mp4"}`);
  const seconds = Math.max(1, Math.min(120, i.seconds));
  await ffmpeg([...r.args({ seed: i.seed, palette: i.palette, fps: i.fps, seconds }), "-fflags", "+bitexact", "-flags:v", "+bitexact", out], { config: ctx.config, signal: ctx.signal });
  return out;
}

/** Recipe for a query: archival stills look aged; news-like video gets scanlines; other video alternates by seed. */
export function recipeFor(kind: "image" | "video", role: AssetQuery["role"] | null, seed: number): string {
  if (kind === "image") return role === "archival" || role === "document" ? "archive-still" : "gradient-grid";
  if (role === "archival") return "scanline-news";
  return seed % 2 === 0 ? "drift-gradient" : "paper-drift";
}

/** providerAssetId grammar: `<recipe>|<seed>|<ink>.<accent>.<second>|<seconds>` (everything fetchOriginal needs). */
export function encodeProceduralId(o: { recipe: string; seed: number; palette: string[]; seconds: number }): string {
  return `${o.recipe}|${seedOf(o.seed)}|${o.palette.slice(0, 3).map((p) => p.replace(/^#/, "").toLowerCase()).join(".")}|${o.seconds}`;
}
export function decodeProceduralId(id: string): { recipe: string; seed: number; palette: string[]; seconds: number } {
  const [recipe, seed, palette, seconds] = id.split("|");
  if (!recipe || !seed) throw new DocmakerError("VALIDATION", `bad procedural asset id ${id}`);
  return {
    recipe, seed: Number(seed), seconds: Number(seconds) || 8,
    palette: (palette ?? "").split(".").filter((x) => /^[0-9a-f]{6}$/.test(x)).map((x) => `#${x}`),
  };
}

export function proceduralSeed(beatId: string | null, slot: number): number {
  return fnv1a32(`${beatId ?? "none"}:${slot}`);
}

export function proceduralCandidate(o: { recipe: string; seed: number; palette: string[]; seconds: number }): Candidate {
  const r = recipeById(o.recipe);
  return {
    provider: "procedural", providerAssetId: encodeProceduralId(o), kind: r.kind, title: `Procedural ${r.id}`, description: `Generated ${r.kind} (${r.id})`,
    tags: ["procedural", r.id], previewUrl: "", downloadUrl: "", width: 1920, height: 1080, durationSec: r.kind === "video" ? o.seconds : null,
    license: licenseInfo("PROCEDURAL", { attributionText: "Generated procedurally by DocumentaryMaker" }), author: null, sourcePageUrl: "",
    retrievedAt: nowIso(), youtube: null,
  };
}

export function createProceduralProvider(o?: { palette?: string[] }): AssetProvider {
  const palette = o?.palette && o.palette.length > 0 ? o.palette : [INK, ACCENT, SECOND];
  return {
    id: "procedural", kinds: ["image", "video"], needsKey: false, paid: false, costPerCallUsd: 0, limits: { concurrency: 2 },
    isConfigured: () => true,
    async search(q: AssetQuery) {
      if (q.kind === "audio") return [];
      const n = Math.max(1, Math.min(q.limit, 4));
      const seconds = q.kind === "video" ? Math.max(4, Math.ceil(q.durationSec?.[0] ?? 8)) : 0;
      return Array.from({ length: n }, (_, slot) => {
        const seed = proceduralSeed(q.beatId, slot);
        const candidate = proceduralCandidate({ recipe: recipeFor(q.kind as "image" | "video", q.role, seed), seed, palette, seconds });
        return { candidate, raw: { recipe: candidate.tags[1], seed } };
      });
    },
    async fetchOriginal(c: Candidate, destDir: string, ctx: ProviderContext) {
      const d = decodeProceduralId(c.providerAssetId);
      const file = await proceduralAsset({ recipe: d.recipe, seed: d.seed, palette: d.palette.length ? d.palette : palette, fps: 30, seconds: d.seconds, outDir: destDir }, ctx);
      return { path: file, mime: file.endsWith(".png") ? "image/png" : "video/mp4" };
    },
  };
}
