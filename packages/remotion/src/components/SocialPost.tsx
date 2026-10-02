// SocialPost (M2): a GENERIC post/comment/forum card (no platform logo), light or dark; slides up 12 f; counters run and
// the body is highlighted from revealAt; optional avatar/image; generic verified tick.
import type React from "react";
import { AbsoluteFill, Img } from "remotion";
import { accentOf, fontStack, useAsset, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, expoOut } from "../lib/easing";
import { formatNumber } from "../lib/text";
import { Avatar, Highlight } from "./parts";
import { pushScale, useItemClock, useZone, type ComponentProps } from "./shared";

const Icon: React.FC<{ kind: "reply" | "repost" | "like"; color: string }> = ({ kind, color }) => (
  <svg width={30} height={30} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    {kind === "reply" ? <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.2-4.4A8 8 0 1 1 21 12z" /> : null}
    {kind === "repost" ? <path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4" /> : null}
    {kind === "like" ? <path d="M12 21s-7-4.4-9.3-9A5 5 0 0 1 12 6a5 5 0 0 1 9.3 6c-2.3 4.6-9.3 9-9.3 9z" /> : null}
  </svg>
);

export const SocialPost: React.FC<ComponentProps<"SocialPost">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const z = useZone("center");
  const dark = p.theme === "dark";
  const bg = dark ? "#15181C" : "#FFFFFF";
  const fg = dark ? "#F2F4F5" : "#0F1419";
  const muted = dark ? "#8B98A5" : "#536471";
  const accent = accentOf(env.tokens);
  const img = useAsset(p.imageAssetId);
  const slide = expoOut(clamp01(c.f / Math.max(1, Math.min(12, c.enter || 12))));
  const counterP = expoOut(clamp01((c.f - p.revealAt) / 30));
  const compact = (n: number | null) => (n == null ? "" : formatNumber(Math.round(n * counterP), { format: "compact", currency: null, decimals: 1, locale: env.locale as "en-US" | "fr-FR" }));
  const isComment = p.variant === "comment";
  const width = isComment ? 980 : 1080;
  const bodySize = isComment ? 36 : p.body.length > 220 ? 34 : 40;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <AbsoluteFill style={{ backgroundColor: rgba("#000000", 0.35 * c.inP * (1 - c.outP)) }} />
      <div style={{ position: "absolute", left: z.left, top: z.top - 40, width: z.width, height: z.height + 120, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width, backgroundColor: bg, color: fg, borderRadius: 28, padding: isComment ? "28px 34px" : "34px 40px", boxShadow: `0 30px 70px ${rgba("#000000", 0.55)}`,
            transform: `translateY(${(140 * (1 - slide)).toFixed(2)}px) scale(${pushScale(c, 0.04).toFixed(5)})`, opacity: Math.min(1, slide * 1.5) * (1 - c.outP),
            fontFamily: fontStack(env.tokens, "body"), border: dark ? "1px solid #2F3336" : "1px solid #E1E8ED",
          }}
        >
          {p.variant === "forum" ? <div style={{ height: 8, margin: "-34px -40px 26px", borderRadius: "28px 28px 0 0", backgroundColor: accent }} /> : null}
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <Avatar assetId={p.avatarAssetId} name={p.displayName} size={isComment ? 64 : 76} />
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: 32, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.displayName}</span>
                {p.verified ? (
                  <svg width={28} height={28} viewBox="0 0 24 24">
                    <circle cx={12} cy={12} r={11} fill={accent} />
                    <path d="M7 12.5l3 3 7-7" fill="none" stroke={dark ? "#15181C" : "#FFFFFF"} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : null}
              </div>
              <span style={{ fontWeight: 400, fontSize: 26, color: muted }}>{[p.handle, p.timestampLabel].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
          <div style={{ marginTop: 22, fontSize: bodySize, lineHeight: 1.32, fontWeight: 400 }}>
            <Highlight f={c.f} start={p.revealAt} frames={16} color={rgba(accent, dark ? 0.32 : 0.45)}>
              {p.body}
            </Highlight>
          </div>
          {img.url && !isComment ? (
            <div style={{ marginTop: 22, borderRadius: 18, overflow: "hidden", height: 360, position: "relative", border: `1px solid ${dark ? "#2F3336" : "#E1E8ED"}` }}>
              <Img src={img.url} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
          ) : null}
          {p.replies != null || p.reposts != null || p.likes != null ? (
            <div style={{ display: "flex", gap: 56, marginTop: 24, color: muted, fontSize: 26, fontWeight: 600 }}>
              {(
                [
                  ["reply", p.replies],
                  ["repost", p.reposts],
                  ["like", p.likes],
                ] as const
              ).map(([k, v]) =>
                v == null ? null : (
                  <span key={k} style={{ display: "flex", alignItems: "center", gap: 10, color: k === "like" && counterP > 0 ? env.tokens.tokens.palette.danger : muted }}>
                    <Icon kind={k} color={k === "like" && counterP > 0 ? env.tokens.tokens.palette.danger : muted} />
                    {compact(v)}
                  </span>
                ),
              )}
            </div>
          ) : null}
        </div>
      </div>
    </AbsoluteFill>
  );
};
