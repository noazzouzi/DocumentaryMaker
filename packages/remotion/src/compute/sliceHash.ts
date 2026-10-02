// Chunk slice hash (§10.3): SHA-256 (core pure-JS) of everything that can change the pixels of frames [from, to]
// (inclusive) with every frame field normalised to chunk-relative (f − from). Shifting a chunk's content by a constant
// (e.g. lengthening an earlier chapter) leaves the hash unchanged; any content change inside the premount margin
// changes it. Components use Sequence-relative frames only, which is what makes this sound.
import { hashJson, type Timeline } from "@docmaker/core";

export const SLICE_HASH_VERSION = 1;

type Rec = Record<string, unknown>;

/** Collects every string value that is a key of `assets` (asset ids inside sources and overlay props). */
function collectAssetRefs(v: unknown, assets: Rec, into: Set<string>): void {
  if (typeof v === "string") {
    if (v.length === 64 && Object.prototype.hasOwnProperty.call(assets, v)) into.add(v);
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) collectAssetRefs(x, assets, into);
    return;
  }
  if (v && typeof v === "object") for (const x of Object.values(v as Rec)) collectAssetRefs(x, assets, into);
}

/** Drops anchors (they carry absolute program offsets and never affect pixels) and shifts `from`. */
function rel<T extends { from: number; start?: unknown; end?: unknown }>(item: T, origin: number): Rec {
  const { start: _s, end: _e, ...rest } = item;
  return { ...rest, from: item.from - origin };
}

export function sliceHash(t: Timeline, from: number, to: number, ctx: { codeHash: string; preset: string; premount: number }): string {
  const premount = Math.max(0, Math.floor(ctx.premount));
  const lo = from - premount;
  const hi = to + premount;
  const hit = (a: number, dur: number) => a <= hi && a + dur - 1 >= lo;

  const chapters = t.chapters.filter((c) => hit(c.from, c.dur)).map((c) => ({ id: c.id, act: c.act, from: c.from - from, dur: c.dur }));
  const video = t.video.filter((c) => hit(c.from, c.dur)).map((c) => rel(c, from));
  const overlays = t.overlays.filter((o) => hit(o.from, o.dur)).map((o) => rel(o, from));
  const captions = t.captions
    .filter((g) => g.burn && g.variant !== "srt" && hit(g.from, g.dur))
    .map((g) => ({ ...rel(g, from), words: g.words.map((w) => ({ ...w, from: w.from - from })) }));
  const fx = t.fx.filter((c) => hit(c.from - c.pre, c.dur + c.pre)).map((c) => rel(c, from));

  const refs = new Set<string>();
  const assets = t.assets as unknown as Rec;
  collectAssetRefs(video, assets, refs);
  collectAssetRefs(overlays, assets, refs);
  const usedAssets = [...refs].sort().map((id) => t.assets[id]);

  return hashJson({
    v: SLICE_HASH_VERSION,
    ctx: { codeHash: ctx.codeHash, preset: ctx.preset, premount },
    fps: t.fps,
    size: [t.width, t.height],
    len: to - from + 1,
    lang: t.lang,
    captionsMode: t.captionsMode,
    grade: t.grade,
    render: t.render,
    items: { chapters, video, overlays, captions, fx },
    assets: usedAssets,
  });
}
