// packages/core/src/fonts.ts — the built-in font families (OFL, self-hosted via @fontsource/*@5.3.0).
// @docmaker/remotion FONT_REGISTRY MUST cover exactly these (test); styles may reference only these (or their own fonts/, M2).
export interface BuiltinFont { family: string; fontsource: string; weights: readonly number[]; italic: boolean }
export const BUILTIN_FONTS: readonly BuiltinFont[] = [
  { family: "Anton", fontsource: "@fontsource/anton", weights: [400], italic: false },
  { family: "Archivo Black", fontsource: "@fontsource/archivo-black", weights: [400], italic: false },
  { family: "Inter", fontsource: "@fontsource/inter", weights: [400, 600, 800, 900], italic: false },
  { family: "JetBrains Mono", fontsource: "@fontsource/jetbrains-mono", weights: [400, 700], italic: false },
  { family: "Instrument Serif", fontsource: "@fontsource/instrument-serif", weights: [400], italic: true },
  { family: "Courier Prime", fontsource: "@fontsource/courier-prime", weights: [400, 700], italic: false },
  { family: "Special Elite", fontsource: "@fontsource/special-elite", weights: [400], italic: false },
];
export const BUILTIN_FONT_FAMILIES: readonly string[] = BUILTIN_FONTS.map((f) => f.family);
/** FR glyph test string used by FontGate and the FontSpecimen composition. */
export const FONT_TEST_STRING = "ÀÂÇÉÈÊËÎÏÔŒÙÛÜ « » œ 1 200 € Aa1";
