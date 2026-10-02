// Offline map helpers for MapPin: Natural Earth 110m countries (world-atlas, ISC) via topojson-client, d3-geo Mercator
// views (center + scale) fitted to regions / place bounds, and geometric view interpolation for camera fits. Pure.
import { geoContains, geoMercator, geoPath, type ExtendedFeature, type GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import world from "world-atlas/countries-110m.json";

// geojson / topojson-specification types are transitive (not direct) dependencies: use d3-geo's own feature type.
type CountryFeature = ExtendedFeature<never, { name?: string }>;

export type LonLat = [number, number];
export type Bounds = [LonLat, LonLat]; // [[west, south], [east, north]]
export interface MapView { center: LonLat; scale: number }

let countriesCache: CountryFeature[] | null = null;
export function countries(): CountryFeature[] {
  if (!countriesCache) {
    const topo = world as unknown as { objects: { countries: unknown } };
    const fc = (feature as unknown as (t: unknown, o: unknown) => { features: CountryFeature[] })(topo, topo.objects.countries);
    countriesCache = fc.features;
  }
  return countriesCache;
}

export const REGION_BOUNDS: Record<"world" | "europe" | "north-america", Bounds> = {
  world: [[-168, -56], [180, 78]],
  europe: [[-24, 34], [44, 71]],
  "north-america": [[-168, 8], [-50, 74]],
};

const clampLat = (lat: number) => Math.max(-80, Math.min(82, lat));

/** Bounds of the places, padded by `pad` × span and at least `minSpanDeg` wide/high. */
export function placesBounds(places: readonly { lon: number; lat: number }[], pad: number, minSpanDeg: number): Bounds {
  const lons = places.map((p) => p.lon);
  const lats = places.map((p) => p.lat);
  let w = Math.min(...lons);
  let e = Math.max(...lons);
  let s = Math.min(...lats);
  let n = Math.max(...lats);
  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const spanX = Math.max(minSpanDeg, (e - w) * (1 + pad));
  const spanY = Math.max(minSpanDeg * 0.6, (n - s) * (1 + pad));
  w = Math.max(-180, cx - spanX / 2);
  e = Math.min(180, cx + spanX / 2);
  s = clampLat(cy - spanY / 2);
  n = clampLat(cy + spanY / 2);
  return [[w, s], [e, n]];
}

/** Mercator view (center + scale) that fits `b` into W×H with `margin` px. */
export function viewFor(b: Bounds, W: number, H: number, margin: number): MapView {
  const [[w, s], [e, n]] = b;
  const corners = { type: "MultiPoint" as const, coordinates: [[w, s], [e, n], [w, n], [e, s]] };
  const proj = geoMercator().fitExtent([[margin, margin], [W - margin, H - margin]], corners);
  const c = proj.invert?.([W / 2, H / 2]) ?? [(w + e) / 2, (s + n) / 2];
  return { center: [c[0], c[1]], scale: proj.scale() };
}

/** Interpolates two views: centre linearly in Mercator space, scale geometrically (perceptually even zoom). */
export function lerpView(a: MapView, b: MapView, t: number): MapView {
  const k = Math.max(0, Math.min(1, t));
  const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (clampLat(lat) * Math.PI) / 360));
  const unmerc = (y: number) => (Math.atan(Math.exp(y)) * 360) / Math.PI - 90;
  const lon = a.center[0] + (b.center[0] - a.center[0]) * k;
  const lat = unmerc(merc(a.center[1]) + (merc(b.center[1]) - merc(a.center[1])) * k);
  const scale = Math.exp(Math.log(a.scale) + (Math.log(b.scale) - Math.log(a.scale)) * k);
  return { center: [lon, lat], scale };
}

export function projectionFor(v: MapView, W: number, H: number): GeoProjection {
  return geoMercator().center(v.center).scale(v.scale).translate([W / 2, H / 2]).clipExtent([[-20, -20], [W + 20, H + 20]]);
}

export function countryPaths(proj: GeoProjection): { name: string; d: string }[] {
  const path = geoPath(proj);
  const out: { name: string; d: string }[] = [];
  for (const f of countries()) {
    const d = path(f);
    if (d) out.push({ name: f.properties?.name ?? "", d });
  }
  return out;
}

/** Name of the country containing a point (null at sea / unknown). */
export function countryAt(lon: number, lat: number): string | null {
  for (const f of countries()) if (geoContains(f, [lon, lat])) return f.properties?.name ?? null;
  return null;
}
