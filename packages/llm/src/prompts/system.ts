// System-prompt builder: stable, cacheable blocks (no timestamps, sorted JSON); cache_control on the last stable block.
import { stableStringify, type FactSheet, type Lang, type Outline, type RiskFlag, type StylePlugin } from "@docmaker/core";
import type { SystemBlock } from "../types";
import { factSheetToWire, outlineToWire } from "../wire/map";
import { EDITORIAL_RULES, SAFE_MESSAGING } from "./rules";
import { SYSTEM_ROLE } from "./steps";

export interface SystemOptions {
  style: StylePlugin;
  lang: Lang;
  asOf: string;
  riskFlags: readonly RiskFlag[];
  factSheet?: FactSheet | null;
  outline?: Outline | null;
  /** Extra stable text appended to the first block (e.g. the beats visual grammar). */
  extra?: string;
}

export function buildSystem(o: SystemOptions): SystemBlock[] {
  const { style, lang } = o;
  const pack = style.promptPack;
  const head = [
    SYSTEM_ROLE(style.data.manifest.names[lang], lang, pack.narratorPersona[lang]),
    EDITORIAL_RULES(lang, o.asOf) + (o.riskFlags.includes("suicide_self_harm") ? `\n${SAFE_MESSAGING(lang)}` : ""),
    `<style_guide>${pack.styleMd}\n${pack.guideMd}\n${pack.qualityDirective}</style_guide>`,
    o.extra ?? "",
  ].filter((s) => s.trim() !== "").join("\n");
  const blocks: SystemBlock[] = [{ text: head, cache: false }];
  if (o.factSheet) blocks.push({ text: `<fact_sheet>${stableStringify(factSheetToWire(o.factSheet), 0).trim()}</fact_sheet>`, cache: false });
  if (o.outline) blocks.push({ text: `<outline>${stableStringify(outlineToWire(o.outline), 0).trim()}</outline>`, cache: false });
  blocks[blocks.length - 1]!.cache = true;
  return blocks;
}

/** Compact stable JSON for user prompts. */
export const json = (v: unknown): string => stableStringify(v, 0).trim();
