// Style fonts (M2, §10.10): StyleRenderTokens.fonts (OFL files served by the asset server from <home>/styles/<id>/fonts/)
// are loaded with @remotion/fonts loadFont inside FontGate. They never change the bundle's codeHash. Loads are cached
// per URL for the tab.
import { loadFont } from "@remotion/fonts";
import type { StyleRenderTokens } from "@docmaker/core";
import { resolveFontUrl } from "../lib/assetUrl";

const loaded = new Map<string, Promise<void>>();

export function loadStyleFonts(fonts: StyleRenderTokens["fonts"], base: string): Promise<void> {
  const jobs = fonts.map((f) => {
    const url = resolveFontUrl(f.url, base);
    const key = `${f.family}|${f.weight}|${f.style}|${url}`;
    let p = loaded.get(key);
    if (!p) {
      p = loadFont({ family: f.family, url, weight: String(f.weight), style: f.style }).catch((e: unknown) => {
        console.warn(`[fonts] style font failed: "${f.family}" ${f.weight} ${f.style} (${url}): ${e instanceof Error ? e.message : String(e)}`);
      });
      loaded.set(key, p);
    }
    return p;
  });
  return Promise.all(jobs).then(() => undefined);
}
