// Style fonts (M2): what the render asset server must expose for a user style's fonts/ (mount "styles/" → <home>/styles).
import { basename } from "node:path";
import type { StylePlugin } from "@docmaker/core";

export interface StyleFontAsset {
  family: string; weight: number; style: "normal" | "italic";
  /** Path relative to the asset server root: `styles/<dir>/fonts/<file>` (URL = `${serverUrl}/${relPath}`). */
  relPath: string;
}

/**
 * Asset-server paths of a style's fonts, in font.json order. Built-in styles reference only the built-in families
 * (their fonts/ is not mounted), so they yield [].
 */
export function styleFontAssets(p: StylePlugin): StyleFontAsset[] {
  if (p.source !== "user") return [];
  const dir = encodeURIComponent(basename(p.dir));
  return p.fonts.map((f) => ({
    family: f.family, weight: f.weight, style: f.style,
    relPath: `styles/${dir}/fonts/${f.file.split("/").map(encodeURIComponent).join("/")}`,
  }));
}
