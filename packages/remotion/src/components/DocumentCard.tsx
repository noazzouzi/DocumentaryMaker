// DocumentCard (M1): a paper document (Courier Prime) over a dark textured backdrop; redaction bars wipe in over 6 f at
// redactAt; an optional stamp lands over 4 f with a shake at stampAt; a slow line-by-line camera drift (push 1.0→1.05 +
// upward travel) keeps it alive for the whole hold.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp01, expoOut } from "../lib/easing";
import { seedOf } from "../lib/random";
import { DOC_TYPE_LABEL, truncate, upper } from "../lib/text";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { NoiseCanvas } from "../media/NoiseCanvas";
import { impactShake, pushScale, useItemClock, type ComponentProps } from "./shared";

export const DocumentCard: React.FC<ComponentProps<"DocumentCard">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const pal = env.tokens.tokens.palette;
  const seed = seedOf(item.id);
  const lines = p.lines.slice(0, 14);
  const lineSize = Math.max(24, Math.min(34, Math.floor(600 / Math.max(1, lines.length) / 1.5)));
  const cardW = 1180;
  const enterY = 70 * (1 - c.inP);
  const drift = -46 * c.hold;
  const push = pushScale(c);
  const redP = expoOut(clamp01((c.f - p.redactAt) / 6));
  const stampT = c.f - p.stampAt;
  const stampP = expoOut(clamp01(stampT / 4));
  const stampShake = impactShake(item.id, c.f, p.stampAt + 4, 3, 7);
  const docLabel = (DOC_TYPE_LABEL[p.docType] ?? DOC_TYPE_LABEL.report!)[env.lang];
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <GeneratedBackdrop recipe="darkNoise" seed={seed} />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `translate(${stampShake.x.toFixed(2)}px, ${stampShake.y.toFixed(2)}px)` }}>
        <div
          style={{
            position: "relative", width: cardW, padding: "54px 70px 64px", backgroundColor: pal.paper, color: "#1d1a16",
            boxShadow: `0 40px 80px ${rgba("#000000", 0.7)}`, transform: `translateY(${(enterY + drift).toFixed(2)}px) scale(${push.toFixed(5)}) rotate(-0.6deg)`,
            opacity: c.inP,
          }}
        >
          <NoiseCanvas seed={seed} kind="paper" opacity={0.5} blend="multiply" />
          <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "3px double #1d1a16", paddingBottom: 14, marginBottom: 24 }}>
            <div style={{ fontFamily: fontStack(env.tokens, "document"), fontWeight: 700, fontSize: 24, letterSpacing: "0.3em", color: "#9b1c12" }}>{docLabel}</div>
          </div>
          {p.title ? (
            <div style={{ position: "relative", fontFamily: fontStack(env.tokens, "document"), fontWeight: 700, fontSize: 42, lineHeight: 1.2, marginBottom: 22 }}>{truncate(p.title, 60)}</div>
          ) : null}
          <div style={{ position: "relative", fontFamily: fontStack(env.tokens, "document"), fontSize: lineSize, lineHeight: 1.5 }}>
            {lines.map((l, i) => {
              const lineIn = clamp01((c.f - 4 - i * 2) / 6);
              const reds = p.redactions.filter((r) => r.line === i && r.end > r.start);
              return (
                <div key={i} style={{ position: "relative", whiteSpace: "pre", opacity: lineIn }}>
                  {l}
                  {reds.map((r, j) => {
                    const start = Math.min(r.start, l.length);
                    const end = Math.max(start, Math.min(r.end, Math.max(l.length, start + 1)));
                    return (
                      <span
                        key={j}
                        style={{
                          position: "absolute", left: `${start}ch`, width: `${end - start}ch`, top: "0.12em", height: "1.1em", backgroundColor: "#0b0b0b",
                          transform: `scaleX(${redP.toFixed(4)})`, transformOrigin: "0 50%",
                        }}
                      />
                    );
                  })}
                </div>
              );
            })}
          </div>
          {p.sourceLabel ? (
            <div style={{ position: "absolute", left: 70, bottom: 20, fontFamily: fontStack(env.tokens, "mono"), fontSize: 18, color: rgba("#1d1a16", 0.65), letterSpacing: "0.04em" }}>{truncate(p.sourceLabel, 90)}</div>
          ) : null}
          {p.stamp && stampT >= 0 ? (
            <div
              style={{
                position: "absolute", right: 80, top: "38%", transform: `rotate(-12deg) scale(${(2.2 - 1.2 * stampP).toFixed(5)})`, opacity: 0.88 * clamp01(stampT / 2 + 0.3),
                border: "8px solid #c4271b", padding: "6px 26px", borderRadius: 10, color: "#c4271b", fontFamily: fontStack(env.tokens, "slam"), fontSize: 92,
                letterSpacing: "0.05em", mixBlendMode: "multiply",
              }}
            >
              {upper(p.stamp, env.locale)}
            </div>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
