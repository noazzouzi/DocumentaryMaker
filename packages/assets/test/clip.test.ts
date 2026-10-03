// CLIP (M3) is loaded from <home>/ml through createRequire, never from the workspace. A stand-in transformers module checks
// the loading path and the similarity math without downloading a model.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { clipSimTo01, loadClip } from "../src/index";
import { cleanup, makeConfig } from "./helpers";

const config = makeConfig();
afterAll(() => cleanup(config.paths.home));

describe("CLIP loader", () => {
  it("returns null when <home>/ml is not set up", async () => {
    expect(await loadClip(makeConfig())).toBeNull();
  });

  it("loads @huggingface/transformers from <home>/ml and scores cosine similarity mapped to [0,1]", async () => {
    const pkgDir = path.join(config.paths.ml, "node_modules", "@huggingface", "transformers");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(path.join(config.paths.ml, "package.json"), JSON.stringify({ name: "docmaker-ml", private: true }));
    writeFileSync(path.join(pkgDir, "package.json"), JSON.stringify({ name: "@huggingface/transformers", version: "0.0.0-test", type: "module", exports: { ".": "./index.js" } }));
    // Text embeds = [1, 0]; image "a" = [0.3, 1] (cos ≈ 0.29), image "b" = [1, 0] (cos 1).
    writeFileSync(path.join(pkgDir, "index.js", ), `
export const env = {};
const model = (fn) => ({ from_pretrained: async () => fn });
export const AutoTokenizer = { from_pretrained: async () => (texts) => ({ texts }) };
export const AutoProcessor = { from_pretrained: async () => async (imgs) => ({ imgs }) };
export const CLIPTextModelWithProjection = model(async () => ({ text_embeds: { data: Float32Array.from([2, 0]), dims: [1, 2] } }));
export const CLIPVisionModelWithProjection = model(async ({ imgs }) => ({ image_embeds: { data: Float32Array.from(imgs.flatMap((f) => f.endsWith("a.jpg") ? [0.3, 1] : [1, 0])), dims: [imgs.length, 2] } }));
export const RawImage = { read: async (f) => f };
`);
    const clip = await loadClip(config);
    expect(clip).not.toBeNull();
    const s = await clip!.scores("a tulip", ["/x/a.jpg", "/x/b.jpg"]);
    expect(s[0]).toBeCloseTo(clipSimTo01(0.3 / Math.hypot(0.3, 1)), 5);
    expect(s[1]).toBe(1);
    expect(await clip!.scores("x", [])).toEqual([]);
  });

  it("maps CLIP cosines 0.15–0.35 onto [0,1]", () => {
    expect(clipSimTo01(0.1)).toBe(0);
    expect(clipSimTo01(0.25)).toBeCloseTo(0.5);
    expect(clipSimTo01(0.5)).toBe(1);
  });
});
