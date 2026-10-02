// Small building blocks shared by the M2 components: framed photos, avatars, highlighter sweeps, chips.
import type React from "react";
import { Img } from "remotion";
import { familyStack, fontStack, useAsset, useEnv } from "../data/env";
import { mixHex, onColor, rgba } from "../lib/color";
import { clamp01, inOutCubic } from "../lib/easing";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";

/** A photo in a white frame (cover-fit inside), optional tilt/shadow/filter; a textured placeholder when the asset is missing. */
export const FramedPhoto: React.FC<{
  assetId: string | null | undefined;
  width: number;
  height: number;
  border?: number;
  tiltDeg?: number;
  shadow?: boolean;
  filter?: string;
  seed?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}> = ({ assetId, width, height, border = 10, tiltDeg = 0, shadow = true, filter, seed = 0, style, children }) => {
  const a = useAsset(assetId ?? null);
  return (
    <div
      style={{
        position: "relative", width: width + 2 * border, height: height + 2 * border, backgroundColor: "#FFFFFF", transform: tiltDeg ? `rotate(${tiltDeg.toFixed(3)}deg)` : undefined,
        boxShadow: shadow ? `0 24px 48px ${rgba("#000000", 0.6)}` : undefined, ...style,
      }}
    >
      <div style={{ position: "absolute", left: border, top: border, width, height, overflow: "hidden", backgroundColor: "#202020", filter }}>
        {a.url ? (
          <Img src={a.url} style={{ position: "absolute", left: 0, top: 0, width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <GeneratedBackdrop recipe="darkNoise" seed={seed} drift={false} noTexture />
        )}
      </div>
      {children}
    </div>
  );
};

/** Natural aspect of an asset (w/h), with a fallback. */
export function useAspect(assetId: string | null | undefined, fallback = 4 / 3): number {
  const a = useAsset(assetId ?? null);
  return a.width && a.height ? a.width / a.height : fallback;
}

/** Round avatar: the asset if any, else initials on a colour derived from the name. */
export const Avatar: React.FC<{ assetId: string | null | undefined; name: string; size: number; base?: string }> = ({ assetId, name, size, base = "#2F3CFF" }) => {
  const env = useEnv();
  const a = useAsset(assetId ?? null);
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const bg = mixHex(base, ["#E8412F", "#3DDC84", "#FFD400", "#8A5CF6", "#00B3C7"][h % 5]!, 0.55);
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", overflow: "hidden", flexShrink: 0, backgroundColor: bg, display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
      {a.url ? (
        <Img src={a.url} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ fontFamily: fontStack(env.tokens, "body"), fontWeight: 800, fontSize: Math.round(size * 0.4), color: onColor(bg) }}>{initials}</span>
      )}
    </div>
  );
};

/** Marker-pen highlight sweeping behind inline text (skewed, rounded), width 0 → 100 % over `frames` from `start`. */
export const Highlight: React.FC<{ f: number; start: number; frames: number; color: string; children: React.ReactNode }> = ({ f, start, frames, color, children }) => {
  const p = inOutCubic(clamp01((f - start) / Math.max(1, frames)));
  return (
    <span style={{ position: "relative", display: "inline" }}>
      <span
        style={{
          position: "absolute", left: "-0.12em", right: "-0.12em", top: "0.12em", bottom: "0.02em", backgroundColor: color, zIndex: 0,
          transform: `skew(-6deg) scaleX(${p.toFixed(4)})`, transformOrigin: "0 50%", borderRadius: "0.12em",
        }}
      />
      <span style={{ position: "relative", zIndex: 1 }}>{children}</span>
    </span>
  );
};

/** Small label chip (mono). */
export const Chip: React.FC<{ text: string; bg?: string; color?: string; size?: number; style?: React.CSSProperties }> = ({ text, bg, color, size = 20, style }) => {
  const env = useEnv();
  const b = bg ?? env.tokens.tokens.palette.accent;
  return (
    <span style={{ display: "inline-block", padding: "4px 10px", backgroundColor: b, color: color ?? onColor(b), fontFamily: fontStack(env.tokens, "mono"), fontWeight: 700, fontSize: size, letterSpacing: "0.08em", borderRadius: 4, ...style }}>
      {text}
    </span>
  );
};

export const family = familyStack;
