// MapPin (M1, offline): d3-geo Mercator + world-atlas countries-110m (topojson-client); paper or dark look; the camera
// fits from the region view to the places' bounds over 45–90 f; route drawn with evolvePath (30–60 f); pins pop at
// each place's `at`; the first place gets a red wash on its country, a hand-drawn scribble circle and its label.
import type React from "react";
import { useMemo } from "react";
import { AbsoluteFill } from "remotion";
import { evolvePath } from "@remotion/paths";
import { accentOf, fontStack, useEnv } from "../data/env";
import { rgba } from "../lib/color";
import { clamp, clamp01, inOutCubic } from "../lib/easing";
import { countryAt, countryPaths, lerpView, placesBounds, projectionFor, REGION_BOUNDS, viewFor, type MapView } from "../lib/geo";
import { ease as motionEase } from "../lib/motion";
import { rngOf, seedOf } from "../lib/random";
import { upper } from "../lib/text";
import { NoiseCanvas } from "../media/NoiseCanvas";
import { useItemClock, type ComponentProps } from "./shared";

const LOOKS = {
  paper: { water: "#D9D2C2", land: "#F3EFE6", border: "#B3A890", text: "#1D1A16", chip: "rgba(29,26,22,0.88)", chipText: "#F3EFE6" },
  dark: { water: "#0A0C0F", land: "#1D2125", border: "#3B4248", text: "#FFFFFF", chip: "rgba(0,0,0,0.78)", chipText: "#FFFFFF" },
} as const;

function scribblePath(cx: number, cy: number, r: number, seed: number): string {
  const rnd = rngOf(seed, "scribble");
  const turns = 1.25;
  const steps = 48;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (i / steps) * turns * Math.PI * 2;
    const rr = r * (1 + (rnd() - 0.5) * 0.12 + 0.08 * (i / steps));
    const x = cx + Math.cos(a) * rr * 1.25;
    const y = cy + Math.sin(a) * rr * 0.9;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)} `;
  }
  return d.trim();
}

function routePath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const bend = Math.min(160, len * 0.22);
    d += ` Q${(mx - (dy / len) * bend).toFixed(1)} ${(my + (dx / len) * bend).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  return d;
}

/** Pushes overlapping label boxes down (in y order) so close places stay readable. */
export function layoutLabels(boxes: { x: number; y: number; w: number }[], h: number): number[] {
  const order = boxes.map((b, i) => ({ ...b, i })).sort((a, b) => a.y - b.y || a.x - b.x);
  const placed: { x: number; y: number; w: number }[] = [];
  const out: number[] = new Array<number>(boxes.length);
  for (const b of order) {
    let y = b.y;
    for (const q of placed) if (b.x < q.x + q.w && q.x < b.x + b.w && y < q.y + h && q.y < y + h) y = q.y + h;
    placed.push({ x: b.x, y, w: b.w });
    out[b.i] = y;
  }
  return out;
}

export const MapPin: React.FC<ComponentProps<"MapPin">> = ({ item }) => {
  const env = useEnv();
  const c = useItemClock(item);
  const p = item.props;
  const W = env.width;
  const H = env.height;
  const look = LOOKS[p.look] ?? LOOKS.paper;
  const pal = env.tokens.tokens.palette;
  const accent = accentOf(env.tokens);
  const seed = seedOf(item.id);
  const places = p.places.slice(0, 6);

  const views = useMemo((): { from: MapView; to: MapView; firstCountry: string | null } => {
    const pl = p.places.slice(0, 6);
    const end = viewFor(placesBounds(pl, 0.8, 7), W, H, 200);
    const startBounds = p.region === "auto" ? placesBounds(pl, 4, 28) : REGION_BOUNDS[p.region];
    return { from: viewFor(startBounds, W, H, 60), to: end, firstCountry: pl[0] ? countryAt(pl[0].lon, pl[0].lat) : null };
  }, [p.places, p.region, W, H]);

  const camFrames = clamp(Math.round(c.dur * 0.45), 45, 90);
  const camP = inOutCubic(clamp01((c.f - 4) / camFrames));
  const view = lerpView(views.from, views.to, camP);
  const proj = projectionFor(view, W, H);
  const paths = countryPaths(proj);
  const pts = places.map((pl) => {
    const xy = proj([pl.lon, pl.lat]) ?? [W / 2, H / 2];
    return { x: xy[0], y: xy[1], label: pl.label, at: pl.at };
  });
  const first = pts[0];
  const labelY = layoutLabels(pts.map((pt, i) => ({ x: pt.x + (i === 0 ? 92 : 30), y: pt.y - 26, w: 40 + pt.label.length * (i === 0 ? 22 : 18) })), 56);
  const route = p.route && pts.length >= 2 ? routePath(pts) : "";
  const routeStart = (first?.at ?? 0) + 8;
  const routeFrames = clamp(20 + 10 * pts.length, 30, 60);
  const routeP = clamp01((c.f - routeStart) / routeFrames);
  const washP = first ? clamp01((c.f - first.at - 2) / 10) : 0;
  const scribbleP = first ? inOutCubic(clamp01((c.f - first.at - 4) / 12)) : 0;
  const scribble = first ? scribblePath(first.x, first.y, 58, seed) : "";

  return (
    <AbsoluteFill style={{ opacity: c.inP * (1 - c.outP), backgroundColor: look.water }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0 }}>
        <rect width={W} height={H} fill={look.water} />
        {paths.map((cp, i) => (
          <path key={i} d={cp.d} fill={look.land} stroke={look.border} strokeWidth={1.3} strokeLinejoin="round" />
        ))}
        {views.firstCountry && washP > 0
          ? paths.filter((cp) => cp.name === views.firstCountry).map((cp, i) => <path key={`w${i}`} d={cp.d} fill={pal.danger} fillOpacity={0.38 * washP} stroke={pal.danger} strokeOpacity={0.6 * washP} strokeWidth={2} />)
          : null}
        {route && routeP > 0 ? (() => {
          const ev = evolvePath(routeP, route);
          return <path d={route} fill="none" stroke={pal.danger} strokeWidth={6} strokeLinecap="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />;
        })() : null}
        {first && scribbleP > 0 ? (() => {
          const ev = evolvePath(scribbleP, scribble);
          return <path d={scribble} fill="none" stroke={pal.danger} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={ev.strokeDasharray} strokeDashoffset={ev.strokeDashoffset} />;
        })() : null}
        {pts.map((pt, i) => {
          const t = c.f - pt.at;
          if (t < 0) return null;
          const s = motionEase.outBack(clamp01(t / 8));
          const ring = clamp01(t / 18);
          return (
            <g key={i} transform={`translate(${pt.x.toFixed(1)} ${pt.y.toFixed(1)})`}>
              {ring < 1 ? <circle r={14 + 46 * ring} fill="none" stroke={i === 0 ? pal.danger : accent} strokeWidth={4} strokeOpacity={1 - ring} /> : null}
              <g transform={`scale(${s.toFixed(4)})`}>
                <circle r={15} fill={i === 0 ? pal.danger : accent} stroke="#FFFFFF" strokeWidth={5} />
              </g>
            </g>
          );
        })}
      </svg>
      {p.look === "paper" ? <NoiseCanvas seed={seed} kind="paper" opacity={0.35} blend="multiply" /> : <NoiseCanvas seed={seed} kind="grain" opacity={0.06} blend="screen" />}
      {pts.map((pt, i) => {
        const t = c.f - pt.at - 3;
        if (t < 0) return null;
        const a = clamp01(t / 6);
        const leftSide = pt.x > W - 420;
        return (
          <div
            key={`l${i}`}
            style={{
              position: "absolute", top: labelY[i]!, left: leftSide ? undefined : pt.x + (i === 0 ? 92 : 30), right: leftSide ? W - pt.x + (i === 0 ? 92 : 30) : undefined,
              padding: "8px 16px", backgroundColor: look.chip, color: look.chipText, borderRadius: 6, opacity: a, transform: `translateX(${((leftSide ? 1 : -1) * 16 * (1 - a)).toFixed(2)}px)`,
              fontFamily: fontStack(env.tokens, "body"), fontWeight: 800, fontSize: i === 0 ? 34 : 28, letterSpacing: "0.04em", whiteSpace: "nowrap",
              borderLeft: i === 0 ? `5px solid ${pal.danger}` : `5px solid ${accent}`,
              boxShadow: `0 6px 20px ${rgba("#000000", 0.3)}`,
            }}
          >
            {upper(pt.label, env.locale)}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
