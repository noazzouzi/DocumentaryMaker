// ArticleHighlight (M2): a newspaper page racks in with a ~10° rotateX tilt; the camera moves to the target paragraph
// over 24 f; the rest dims to 0.4 with a 2 px blur; a highlighter sweep (15 f) starts at highlightAt. A screenshot
// asset, when given, replaces the generated page (pushed in, no text highlight).
import type React from "react";
import { AbsoluteFill } from "remotion";
import { accentOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp, clamp01, expoOut, inOutCubic } from "../lib/easing";
import { seedOf } from "../lib/random";
import { truncate } from "../lib/text";
import { GeneratedBackdrop } from "../media/GeneratedBackdrop";
import { NoiseCanvas } from "../media/NoiseCanvas";
import { FramedPhoto, Highlight, useAspect } from "./parts";
import { pushScale, useItemClock, type ComponentProps } from "./shared";

const PAGE_W = 1180;
const PAD = 70;
const BODY = 34;
const LINE = 1.45;

/** Rough layout of the page (y of each paragraph's centre) for the camera move — serif ≈ 0.47 em per character. */
export function paragraphCentres(headline: string, paragraphs: readonly string[]): { centres: number[]; height: number } {
  const perLine = Math.max(20, Math.floor((PAGE_W - 2 * PAD) / (BODY * 0.47)));
  const headLines = Math.max(1, Math.ceil(headline.length / Math.floor((PAGE_W - 2 * PAD) / (64 * 0.5))));
  let y = PAD + 70 + headLines * 64 * 1.15 + 40;
  const centres: number[] = [];
  for (const p of paragraphs) {
    const lines = Math.max(1, Math.ceil(p.length / perLine));
    const h = lines * BODY * LINE;
    centres.push(y + h / 2);
    y += h + 26;
  }
  return { centres, height: y + PAD };
}

export const ArticleHighlight: React.FC<ComponentProps<"ArticleHighlight">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const seed = seedOf(item.id);
  const accent = accentOf(env.tokens);
  const tilt = 10 * (1 - expoOut(clamp01(c.f / Math.max(12, c.enter + 6))));
  const shotAspect = useAspect(p.screenshotAssetId, 16 / 10);
  const hasShot = !!(p.screenshotAssetId && env.assets[p.screenshotAssetId]);
  const paragraphs = p.paragraphs.slice(0, 6);
  const hl = p.highlight && p.highlight.paragraph < paragraphs.length ? p.highlight : null;
  const { centres, height } = paragraphCentres(p.headline, paragraphs);
  const camStart = Math.max(c.enter, p.highlightAt - 24);
  const camP = hl ? inOutCubic(clamp01((c.f - camStart) / 24)) : 0;
  const pageH = Math.max(700, height);
  const targetY = hl ? centres[hl.paragraph]! : pageH / 2;
  const zoom = 1 + 0.32 * camP;
  // page is centred in the frame; move so the target paragraph lands at y≈520
  const baseTop = (1080 - Math.min(pageH, 1000)) / 2;
  const shiftY = -(targetY - (520 - baseTop)) * camP;
  const dimOthers = hl ? clamp01((c.f - p.highlightAt + 6) / 10) : 0;
  return (
    <AbsoluteFill style={{ opacity: 1 - c.outP }}>
      <GeneratedBackdrop recipe="darkNoise" seed={seed} />
      <AbsoluteFill style={{ alignItems: "center", perspective: 1600, paddingTop: baseTop }}>
        {hasShot ? (
          <div style={{ transform: `rotateX(${tilt.toFixed(3)}deg) scale(${pushScale(c, 0.08).toFixed(5)})`, transformOrigin: "50% 0%", opacity: c.inP }}>
            <FramedPhoto assetId={p.screenshotAssetId} width={Math.min(1500, 860 * shotAspect)} height={Math.min(1500, 860 * shotAspect) / shotAspect} border={0} seed={seed} />
          </div>
        ) : (
          <div
            style={{
              position: "relative", width: PAGE_W, padding: PAD, paddingTop: PAD - 10, backgroundColor: "#F7F4EC", color: "#161412", boxShadow: `0 40px 90px ${rgba("#000000", 0.7)}`,
              transform: `rotateX(${tilt.toFixed(3)}deg) translateY(${shiftY.toFixed(2)}px) scale(${(zoom * pushScale(c, 0.03)).toFixed(5)})`,
              transformOrigin: `50% ${targetY.toFixed(1)}px`, opacity: c.inP,
            }}
          >
            <NoiseCanvas seed={seed} kind="paper" opacity={0.35} blend="multiply" />
            <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "baseline", borderBottom: "2px solid #161412", paddingBottom: 12, marginBottom: 26 }}>
              <span style={{ fontFamily: fontStack(env.tokens, "serif"), fontSize: 46, fontWeight: 400, letterSpacing: "0.02em" }}>{truncate(p.outlet, 40)}</span>
              <span style={{ fontFamily: fontStack(env.tokens, "mono"), fontSize: 20, color: "#5b554c" }}>{p.dateLabel}</span>
            </div>
            <div style={{ position: "relative", fontFamily: fontStack(env.tokens, "serif"), fontSize: 64, lineHeight: 1.15, marginBottom: 40 }}>{p.headline}</div>
            {paragraphs.map((para, i) => {
              const isHl = hl?.paragraph === i;
              const dim = !isHl && hl ? dimOthers : 0;
              const style: React.CSSProperties = { position: "relative", fontFamily: fontStack(env.tokens, "serif"), fontSize: BODY, lineHeight: LINE, marginBottom: 26, opacity: 1 - 0.6 * dim, filter: dim > 0.02 ? `blur(${(2 * dim).toFixed(2)}px)` : undefined };
              if (!isHl || !hl) return <p key={i} style={{ ...style, margin: `0 0 26px` }}>{para}</p>;
              const s = clamp(hl.start, 0, para.length);
              const e = clamp(hl.end, s, para.length);
              return (
                <p key={i} style={{ ...style, margin: `0 0 26px` }}>
                  {para.slice(0, s)}
                  <Highlight f={c.f} start={p.highlightAt} frames={15} color={rgba(accent, 0.85)}>
                    {para.slice(s, e)}
                  </Highlight>
                  {para.slice(e)}
                </p>
              );
            })}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
