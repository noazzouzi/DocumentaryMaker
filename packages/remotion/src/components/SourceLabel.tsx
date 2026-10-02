// SourceLabel (M1, HUD band — never moved by fx): a small mono chip "KIND · text" in topLeft/topRight; kinds have EN/FR
// tags (TRANSLATED/TRADUCTION, SYNTHETIC VOICE/VOIX DE SYNTHÈSE, …). 6 f fade/slide in and out.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { accentOf, fontStack, useEnv } from "../data/env";
import { onColor, rgba } from "../lib/color";
import { SOURCE_KIND_LABEL } from "../lib/text";
import { useItemClock, useZone, type ComponentProps } from "./shared";

/** "Source: Rijksmuseum" next to a SOURCE tag reads twice: drop a leading "<tag>:" from the text. */
export function stripTagPrefix(text: string, tags: readonly string[]): string {
  const t = text.trim();
  for (const tag of tags) {
    if (!tag) continue;
    const m = new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:·—-]\\s*`, "i").exec(t);
    if (m && t.length > m[0].length) return t.slice(m[0].length);
  }
  return t;
}

export const SourceLabel: React.FC<ComponentProps<"SourceLabel">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const z = useZone(p.zone);
  const pal = env.tokens.tokens.palette;
  const accent = accentOf(env.tokens);
  const tag = (SOURCE_KIND_LABEL[p.kind] ?? SOURCE_KIND_LABEL.source!)[env.lang];
  const right = p.zone === "topRight";
  const text = stripTagPrefix(p.text, [tag, SOURCE_KIND_LABEL[p.kind]?.en ?? "", SOURCE_KIND_LABEL[p.kind]?.fr ?? ""]);
  const vis = c.inP * (1 - c.outP);
  const size = env.tokens.tokens.typeRamp.label;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: z.left, top: z.top, width: z.width, height: z.height, display: "flex", alignItems: "flex-start", justifyContent: right ? "flex-end" : "flex-start" }}>
        <div
          style={{
            display: "flex", alignItems: "stretch", opacity: vis, transform: `translateY(${(-10 * (1 - c.inP)).toFixed(2)}px)`, maxWidth: z.width,
            fontFamily: fontStack(env.tokens, "mono"), fontSize: size, lineHeight: 1.2, borderRadius: 6, overflow: "hidden",
            boxShadow: `0 4px 16px ${rgba("#000000", 0.35)}`,
          }}
        >
          <div style={{ padding: "6px 10px", backgroundColor: accent, color: onColor(accent), fontWeight: 700, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{tag}</div>
          <div style={{ padding: "6px 12px", backgroundColor: rgba(pal.ink, 0.78), color: pal.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{text}</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
