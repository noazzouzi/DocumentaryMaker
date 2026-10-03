// CLIP similarity (M3). Runs only after `docmaker setup --clip` installed @huggingface/transformers into <home>/ml; it is never a
// workspace dependency. Resolved with createRequire(<home>/ml/package.json) and imported by file URL (ESM or CJS builds).
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Logger, RuntimeConfig } from "@docmaker/core";
import { clamp01 } from "./util";

export const CLIP_MODEL_ID = "Xenova/clip-vit-base-patch32";

export interface ClipModel {
  /** Cosine similarity of `text` with each image file, mapped to [0,1] (0.15 → 0, 0.35 → 1). */
  scores(text: string, imageFiles: string[]): Promise<number[]>;
}

/** CLIP cosine similarities are compressed around 0.15–0.35: spread them over [0,1]. */
export function clipSimTo01(cos: number): number {
  return clamp01((cos - 0.15) / 0.2);
}

const cache = new Map<string, Promise<ClipModel | null>>();

interface Tensor { data: Float32Array | number[]; dims: number[] }
type AnyMod = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function normRows(t: Tensor): number[][] {
  const [rows, n] = [t.dims[0]!, t.dims[1]!];
  const out: number[][] = [];
  for (let i = 0; i < rows; i++) {
    const row = Array.from(t.data.slice(i * n, (i + 1) * n)) as number[];
    const s = Math.sqrt(row.reduce((a, x) => a + x * x, 0)) || 1;
    out.push(row.map((x) => x / s));
  }
  return out;
}

export function loadClip(config: RuntimeConfig, logger?: Logger): Promise<ClipModel | null> {
  const key = config.paths.ml;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const pkg = path.join(config.paths.ml, "package.json");
      if (!existsSync(pkg)) return null;
      try {
        const req = createRequire(pkg);
        const resolved = req.resolve("@huggingface/transformers");
        const mod = (await import(pathToFileURL(resolved).href)) as AnyMod;
        const t: AnyMod = mod.default && !mod.AutoTokenizer ? mod.default : mod;
        t.env.cacheDir = path.join(config.paths.ml, "hf-cache");
        const tokenizer = await t.AutoTokenizer.from_pretrained(CLIP_MODEL_ID);
        const textModel = await t.CLIPTextModelWithProjection.from_pretrained(CLIP_MODEL_ID, { dtype: "q8" });
        const processor = await t.AutoProcessor.from_pretrained(CLIP_MODEL_ID);
        const visionModel = await t.CLIPVisionModelWithProjection.from_pretrained(CLIP_MODEL_ID, { dtype: "q8" });
        return {
          async scores(text: string, files: string[]) {
            if (files.length === 0) return [];
            const { text_embeds } = await textModel(tokenizer([text], { padding: true, truncation: true }));
            const imgs = await Promise.all(files.map((f) => t.RawImage.read(f)));
            const { image_embeds } = await visionModel(await processor(imgs));
            const T = normRows(text_embeds as Tensor)[0]!;
            return normRows(image_embeds as Tensor).map((v) => clipSimTo01(v.reduce((a, x, j) => a + x * T[j]!, 0)));
          },
        } satisfies ClipModel;
      } catch (e) {
        logger?.warn("CLIP runtime present but failed to load; metadata ranking only", { error: (e as Error).message });
        return null;
      }
    })();
    cache.set(key, p);
  }
  return p;
}
