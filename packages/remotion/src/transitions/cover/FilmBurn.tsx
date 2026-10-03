// Film burn (M3): 15–30 f. An orange→white radial bloom (seeded position) grows to a near-white over-exposure on the
// frames around the cut (the splice is never visible) and burns back out; a static noise mask in colour-dodge gives the
// emulsion texture (a seeded canvas drawn once per mount stands in for a full-frame SVG feTurbulence, which is too slow
// under swangle). Intensity sin(πp); over-exposure: compute/covers.ts filmBurnWhite.
import type React from "react";
import { AbsoluteFill } from "remotion";
import { coverIntensity, filmBurnWhite } from "../../compute/covers";
import { rgba } from "../../lib/color";
import { hash01 } from "../../lib/random";
import { NoiseCanvas } from "../../media/NoiseCanvas";
import type { CoverProps } from "./common";

export const FilmBurnCover: React.FC<CoverProps> = ({ w, d, k, seed }) => {
  const inten = coverIntensity(w, k, d);
  if (inten <= 0.005) return null;
  const p = Math.max(0, Math.min(1, (k + 0.5) / Math.max(2, d)));
  // the hot spot drifts a little across the window (burns crawl)
  const cx = 15 + 70 * hash01(seed, "fb-x") + (p - 0.5) * 14 * (hash01(seed, "fb-dx") - 0.5);
  const cy = 20 + 60 * hash01(seed, "fb-y") + (p - 0.5) * 10;
  const r = 30 + 90 * inten;
  const bloom = `radial-gradient(circle at ${cx.toFixed(1)}% ${cy.toFixed(1)}%, ${rgba("#FFFFFF", inten)} 0%, ${rgba("#FFD27A", 0.95 * inten)} ${(r * 0.35).toFixed(1)}%, ${rgba("#FF6A00", 0.85 * inten)} ${(r * 0.7).toFixed(1)}%, ${rgba("#7A1500", 0.4 * inten)} ${r.toFixed(1)}%, transparent ${(r + 25).toFixed(1)}%)`;
  // a second, redder lobe on the far side makes the burn read as chemical, not as a lens flare
  const lobe = `radial-gradient(ellipse 45% 60% at ${(100 - cx).toFixed(1)}% ${(100 - cy).toFixed(1)}%, ${rgba("#FF3A00", 0.55 * inten * inten)} 0%, transparent 70%)`;
  const white = filmBurnWhite(inten);
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ mixBlendMode: "screen" }}>
        <AbsoluteFill style={{ background: `${bloom}, ${lobe}` }} />
        <NoiseCanvas seed={seed} kind="grain" opacity={0.35 * inten} blend="color-dodge" />
      </AbsoluteFill>
      {white > 0.001 ? <AbsoluteFill style={{ backgroundColor: "#FFF4E2", opacity: 0.97 * white }} /> : null}
    </AbsoluteFill>
  );
};
