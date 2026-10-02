// FallbackCard (§10.7): what an unimplemented component id renders — the item's main text in the KineticText look if it
// has text, else its first referenced asset as a framed card, else nothing. Never throws on unknown props.
import type React from "react";
import { AbsoluteFill, Img } from "remotion";
import { COMPONENT_META, type OverlayItem } from "@docmaker/core";
import { useAsset, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { cardRect } from "../lib/geometry";
import { wrapText } from "../lib/text";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { seedOf } from "../lib/random";
import { KineticBlock } from "./KineticText";
import { pushScale, useItemClock, useZone } from "./shared";

const TEXT_KEYS = ["text", "title", "headline", "body", "label", "name", "caption", "lines"];

function valuesAt(obj: unknown, path: string[]): unknown[] {
  if (path.length === 0) return [obj];
  if (Array.isArray(obj)) return obj.flatMap((x) => valuesAt(x, path));
  if (obj && typeof obj === "object") return valuesAt((obj as Record<string, unknown>)[path[0]!], path.slice(1));
  return [];
}

/** Main text of an item: its read-policy text fields, else the common text keys (strings and string arrays). */
export function fallbackText(item: Pick<OverlayItem, "component" | "props">): string[] {
  const meta = COMPONENT_META[item.component];
  const fields = meta && meta.read.textFields.length ? meta.read.textFields : TEXT_KEYS;
  const out: string[] = [];
  for (const f of fields) {
    for (const v of valuesAt(item.props, f.split("."))) {
      if (typeof v === "string" && v.trim()) out.push(v.trim());
      else if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && x.trim()) out.push(x.trim());
    }
  }
  if (!out.length && fields !== TEXT_KEYS) for (const k of TEXT_KEYS) for (const v of valuesAt(item.props, [k])) if (typeof v === "string" && v.trim()) out.push(v.trim());
  return out;
}

/** First asset id referenced by the props (keys ending in "assetId"), in declaration order. */
export function fallbackAssetId(props: unknown, assets: Record<string, unknown>): string | null {
  const stack: unknown[] = [props];
  while (stack.length) {
    const v = stack.shift();
    if (Array.isArray(v)) stack.push(...v);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (/assetid$/i.test(k) && typeof x === "string" && x in assets) return x;
        if (x && typeof x === "object") stack.push(x);
      }
    }
  }
  return null;
}

const FramedAsset: React.FC<{ item: OverlayItem; assetId: string }> = ({ item, assetId }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const a = useAsset(assetId);
  const r = cardRect(a.width, a.height, env.width, env.height, 0.72, 12);
  const full = COMPONENT_META[item.component]?.fullFrame ?? false;
  if (!a.url) return null;
  return (
    <AbsoluteFill style={{ opacity: c.inP * (1 - c.outP) }}>
      {full ? <GeneratedBackdrop recipe="darkNoise" seed={seedOf(item.id)} /> : <AbsoluteFill style={{ backgroundColor: rgba("#000000", 0.35) }} />}
      <AbsoluteFill style={{ transform: `scale(${(pushScale(c) * (0.94 + 0.06 * c.inP)).toFixed(5)})` }}>
        <div style={{ position: "absolute", left: r.left - 12, top: r.top - 12, width: r.width + 24, height: r.height + 24, backgroundColor: "#FFFFFF", transform: "rotate(-1.2deg)", boxShadow: `0 35px 60px ${rgba("#000000", 0.85)}` }}>
          <Img src={a.url} style={{ position: "absolute", left: 12, top: 12, width: r.width, height: r.height, objectFit: "cover" }} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const FallbackText: React.FC<{ item: OverlayItem; lines: string[] }> = ({ item, lines }) => {
  const c = useItemClock(item);
  const z = useZone("center");
  return <KineticBlock lines={lines} emphasis={[]} align="center" clock={c} box={z} maxSize={110} />;
};

export const FallbackCard: React.FC<{ item: OverlayItem }> = ({ item }) => {
  const env = useEnv();
  const texts = fallbackText(item);
  if (texts.length) {
    const lines = wrapText(texts.join(" — "), 26, 4);
    return <FallbackText item={item} lines={lines} />;
  }
  const assetId = fallbackAssetId(item.props, env.assets as Record<string, unknown>);
  if (assetId) return <FramedAsset item={item} assetId={assetId} />;
  return null;
};
