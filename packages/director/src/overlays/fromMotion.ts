// (a) motion templates → overlay components (TEMPLATE_COMPONENT), props filled from the FactSheet (§4.11 table).
import {
  COMPONENT_META, MotionData, TEMPLATE_COMPONENT, fnv1a32, framesAt, lerp, normWord, tokenizeDisplay, type CueType, type LayoutWord, type MotionTemplate,
  type OverlayComponentId,
} from "@docmaker/core";
import { clamp, cueFrame, round2, truncate, type BeatCtx, type Ctx } from "../ctx";
import { dateLabel, spokenDate } from "../dates";
import { boundFullFrameHold, fitFormula, holdOf } from "./hold";
import { CLS, addOv, enterOf, personById, personRule, policyOf, portraitFor, type Ov, type OvState } from "./state";
import { contentText } from "./cues";
import { fillAts, findSpoken, syncWords } from "./sync";

const TEMPLATE_CUES: Partial<Record<MotionTemplate, CueType[]>> = {
  kinetic_text: ["EMPHASIS", "LIST"], counter: ["NUMBER"], money_counter: ["NUMBER"], timeline: ["TIME_JUMP"], bar_chart: ["NUMBER", "COMPARISON"],
  line_chart: ["NUMBER"], map_route: ["PLACE"], quote_card: ["QUOTE"], tweet_card: ["TWEET"], headline_stack: ["ARTICLE"],
  document_highlight: ["DOCUMENT", "ARTICLE"], split_compare: ["COMPARISON"], org_chart: ["LIST"], photo_burst: ["LIST", "MONTAGE"],
  evidence_board: ["LIST"], comment_pile: ["TWEET", "LIST"],
};

/** Words the item may sync to: this beat and the next one. */
function syncPool(ctx: Ctx, b: BeatCtx): LayoutWord[] {
  const next = ctx.beats[b.idx + 1];
  const end = next && next.ch === b.ch ? next.wordEnd : b.wordEnd;
  return ctx.words.slice(b.wordStart, Math.max(b.wordStart, end));
}

const quoteById = (ctx: Ctx, id: string) => ctx.facts.quotes.find((q) => q.id === id);
const sourceById = (ctx: Ctx, id: string) => ctx.facts.sources.find((s) => s.id === id);
const figureById = (ctx: Ctx, id: string) => ctx.facts.figures.find((f) => f.id === id);
const sameLang = (a: string, b: string) => a.slice(0, 2).toLowerCase() === b.slice(0, 2).toLowerCase();

function speakerName(ctx: Ctx, personId: string): { name: string; anon: boolean } {
  const p = personById(ctx, personId);
  const rule = personRule(ctx, p);
  return rule === "name" && p ? { name: p.name, anon: false } : { name: "", anon: true };
}

/** Wraps paragraphs into ≤ width-char lines (max lines). */
function wrapLines(paragraphs: string[], width: number, max: number): string[] {
  const out: string[] = [];
  for (const p of paragraphs) {
    let line = "";
    for (const w of p.split(/\s+/).filter(Boolean)) {
      if (line && (line + " " + w).length > width) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
      if (out.length >= max) break;
    }
    if (line && out.length < max) out.push(line.slice(0, width));
    if (out.length >= max) break;
  }
  return out.length ? out : [""];
}

/** Locates `needle` (normalised words) inside paragraphs → {paragraph, start, end} char range. */
function locate(paragraphs: string[], needle: string): { paragraph: number; start: number; end: number } | null {
  const want = tokenizeDisplay(needle).map((w) => w.norm).filter(Boolean);
  if (want.length === 0) return null;
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const toks = tokenizeDisplay(paragraphs[pi]!);
    for (let k = 0; k + want.length <= toks.length; k++) {
      if (want.every((w, j) => toks[k + j]!.norm === w)) return { paragraph: pi, start: toks[k]!.start, end: toks[k + want.length - 1]!.end };
    }
  }
  return null;
}

interface Built { component: OverlayComponentId; props: Record<string, unknown>; from: number; subBeats: number[]; narratedEnd: number | null; contentFrames?: number; anchorWord: string | null }

export function templateOverlays(ctx: Ctx, st: OvState): void {
  for (const b of ctx.beats) {
    const tpl = b.plan.motionTemplate;
    if (tpl === "none") continue;
    let component: OverlayComponentId = TEMPLATE_COMPONENT[tpl];
    const md0 = b.text.motionData;
    if (tpl === "document_highlight" && md0 && (md0 as { kind?: unknown }).kind === "article") component = "ArticleHighlight";
    if (!policyOf(ctx, component)) continue;
    const parsed = MotionData[tpl].safeParse(md0);
    if (!parsed.success) { ctx.warn("TEMPLATE_DATA", b.id, `${tpl}: motion data does not parse; template skipped`); continue; }
    // entry: the template's cue anchor, else the beat start + 2 f (first beats of a chapter wait for the narrator)
    const cueK = b.cues.findIndex((c) => (TEMPLATE_CUES[tpl] ?? []).includes(c.type));
    const base = b.firstOfChapter ? b.onset : b.from;
    const from = cueK >= 0 ? Math.max(base, cueFrame(ctx, b, cueK)) : base + ctx.F30(2);
    const built = buildTemplate(ctx, b, tpl, component, parsed.data as Record<string, unknown>, from);
    if (!built) continue;
    if (cueK >= 0) st.served.add(`${b.id}:${cueK}`);
    let props = built.props;
    let h = holdOf(built.component, props, ctx.fps, { narratedEnd: built.narratedEnd, contentFrames: built.contentFrames });
    if (h.over) {
      const fit = fitFormula(built.component, props, ctx.fps);
      if (fit.truncated) { props = fit.props; ctx.warn("READABILITY", b.id, `${built.component} text truncated to fit its maximum hold`); }
      else ctx.warn("READABILITY", b.id, `${built.component} needs ${(h.readHold / ctx.fps).toFixed(1)} s, held ${(h.maxHold / ctx.fps).toFixed(1)} s`);
      h = holdOf(built.component, props, ctx.fps, { narratedEnd: built.narratedEnd, contentFrames: built.contentFrames });
    }
    addOv(ctx, st, {
      component: built.component, ref: b.id, beatId: b.id, from: built.from, dur: boundFullFrameHold(ctx, b, built.component, built.from, h.dur, built.narratedEnd), props, cls: CLS.template, origin: "template",
      anchorWord: built.anchorWord, subBeats: built.subBeats, readHold: Math.min(h.readHold, h.maxHold),
    });
  }
}

function buildTemplate(ctx: Ctx, b: BeatCtx, tpl: Exclude<MotionTemplate, "none">, component: OverlayComponentId, md: Record<string, unknown>, from: number): Built | null {
  const pal = ctx.tok.tokens.palette;
  const enter = enterOf(ctx, component);
  const pool = syncPool(ctx, b);
  const word = ctx.words.find((w) => w.from === from) ?? null;
  const out = (props: Record<string, unknown>, o: Partial<Built> = {}): Built => ({
    component, props, from, subBeats: o.subBeats ?? [], narratedEnd: o.narratedEnd ?? null, contentFrames: o.contentFrames, anchorWord: word?.id ?? null,
  });
  /** Sequential VO sync of sub-items' texts → at (relative) + the narrated end. */
  const syncItems = (texts: string[], step: number): { ats: number[]; end: number | null } => {
    let idx = Math.max(0, pool.findIndex((w) => w.from >= from - ctx.F30(2)));
    if (idx < 0) idx = pool.length;
    const raw: (number | null)[] = [];
    let end: number | null = null;
    const latest = framesAt(ctx.fps, COMPONENT_META[component].maxHold30) - ctx.F30(30);
    for (const t of texts) {
      const m = findSpoken(t, pool, idx);
      if (m && m.first.from - from <= latest) { raw.push(Math.max(enter, m.first.from - from)); end = Math.max(end ?? 0, m.last.from + m.last.dur - from); idx = m.endIdx; }
      else raw.push(null);
    }
    return { ats: fillAts(raw, enter, step), end };
  };
  switch (tpl) {
    case "kinetic_text": case "org_chart": {
      const lines = tpl === "kinetic_text"
        ? (md.lines as string[])
        : (md.nodes as { label: string; role: string }[]).map((n) => (n.role ? `${n.label} — ${n.role}` : n.label));
      const L = lines.map((l) => truncate(l, 48)).filter(Boolean).slice(0, 4);
      if (L.length === 0 || contentText(L.join(" "), ctx.lang) === null) return null; // never a lone function word
      return out({ lines: L, emphasis: ((md.emphasis as string[] | undefined) ?? []).slice(0, 8), align: "center" });
    }
    case "counter": case "money_counter": {
      const fig = figureById(ctx, md.figure_id as string);
      if (!fig) { ctx.warn("TEMPLATE_FACTS", b.id, `figure ${String(md.figure_id)} not in the FactSheet; counter skipped`); return null; }
      const money = tpl === "money_counter";
      const decimals = clamp(money ? (Number.isInteger(fig.value) ? 0 : 2) : (md.decimals as number), 0, 3);
      return out({
        value: fig.value, from: (md.from as number) ?? 0, format: money ? "currency" : (md.format as string), currency: money ? (md.currency as string) : null,
        decimals, label: truncate(((md.label as string) || fig.label), 60), locale: ctx.lang === "fr" ? "fr-FR" : "en-US", color: money ? pal.money : pal.accent,
      });
    }
    case "timeline": {
      const evs = (md.events as { date: string; label: string; event_id: string }[]).slice(0, 8).map((e) => {
        const te = e.event_id ? ctx.facts.timeline.find((x) => x.id === e.event_id) : undefined;
        const raw = te ? te.date : e.date;
        return { dateLabel: truncate(dateLabel(raw, ctx.lang), 24), label: truncate(e.label, 60), spoken: spokenDate(raw, ctx.lang) };
      });
      if (evs.length < 2) return null;
      const s = syncItems(evs.map((e) => e.spoken), ctx.F30(12));
      const active = clamp(md.active_index as number, -1, evs.length - 1);
      return out({ events: evs.map((e, k) => ({ dateLabel: e.dateLabel, label: e.label, at: s.ats[k]! })), activeIndex: active }, { subBeats: s.ats.map((a) => from + a), contentFrames: Math.max(...s.ats) + ctx.F30(30) });
    }
    case "bar_chart": case "line_chart": {
      const bars = (md.bars as { label: string; value: number; figure_id: string; highlight: boolean }[]).map((x) => {
        const fig = figureById(ctx, x.figure_id);
        return fig ? { label: truncate(x.label, 30), value: fig.value, highlight: x.highlight } : null;
      });
      if (bars.some((x) => x === null) || bars.length < 2) { ctx.warn("TEMPLATE_FACTS", b.id, "bar chart figure missing; chart skipped"); return null; }
      const src = sourceById(ctx, md.source_id as string);
      return out({
        title: truncate((md.title as string) || "", 80), unit: truncate((md.unit as string) || "", 16), sourceLabel: truncate(src ? `Source: ${src.publisher}` : "", 80),
        bars: bars.slice(0, 8),
      });
    }
    case "map_route": {
      const places = (md.places as { label: string; lon: number; lat: number }[]).slice(0, 6).map((p) => ({
        label: truncate(p.label, 40), lon: clamp(p.lon, -180, 180), lat: clamp(p.lat, -90, 90),
      }));
      const s = syncItems(places.map((p) => p.label), ctx.F30(20));
      const look = ctx.tok.tokens.backdrop === "paper" ? "paper" : "dark";
      return out({ places: places.map((p, k) => ({ ...p, at: s.ats[k]! })), route: md.route as boolean, region: md.region as string, look }, {
        subBeats: s.ats.map((a) => from + a), contentFrames: Math.max(...s.ats) + ctx.F30(40),
      });
    }
    case "quote_card": {
      const q = quoteById(ctx, md.quote_id as string);
      if (!q) { ctx.warn("TEMPLATE_FACTS", b.id, `quote ${String(md.quote_id)} not in the FactSheet; quote card skipped`); return null; }
      const sp = speakerName(ctx, q.speakerId);
      const src = sourceById(ctx, q.sourceId);
      const translated = !sameLang(q.language, ctx.lang) && typeof md.text === "string" && normWord(md.text) !== normWord(q.verbatim) && md.text.trim() !== "";
      const text = truncate(translated ? (md.text as string) : q.verbatim, 400);
      const synced = syncWords(text, pool, from);
      const anySync = synced.filter((w) => w.at !== null).length * 2 >= synced.length;
      const ats = anySync ? fillAts(synced.map((w) => w.at), enter, ctx.F30(6)) : [];
      const lastMatched = anySync ? Math.max(...synced.map((w) => w.at ?? 0)) : null;
      return out({
        text, speaker: truncate(sp.name, 60), sourceLabel: truncate([src?.publisher ?? "", dateLabel(q.date, ctx.lang)].filter(Boolean).join(", "), 80),
        portraitAssetId: sp.anon ? null : portraitFor(ctx, q.speakerId), translated,
        words: anySync ? synced.map((w, k) => ({ text: w.text, at: ats[k]!, emphasis: false })) : [],
      }, { narratedEnd: lastMatched !== null ? lastMatched + ctx.F30(10) : null, subBeats: anySync ? [from + ats[0]!] : [] });
    }
    case "tweet_card": {
      const q = quoteById(ctx, md.quote_id as string);
      if (!q) { ctx.warn("TEMPLATE_FACTS", b.id, `quote ${String(md.quote_id)} not in the FactSheet; post skipped`); return null; }
      const sp = speakerName(ctx, q.speakerId);
      const src = sourceById(ctx, q.sourceId);
      const handle = typeof md.handle === "string" && md.handle && [q.verbatim, src?.title ?? "", ...(src?.snippets ?? [])].some((t) => t.includes(md.handle as string)) ? md.handle : "";
      const body = truncate(q.verbatim, 400);
      const m = findSpoken(body, pool, 0);
      const revealAt = m ? Math.max(enter, m.first.from - from) : enter + ctx.F30(10);
      return out({
        variant: md.variant as string, displayName: truncate(sp.anon ? "@user" : sp.name, 50), handle: truncate(handle as string, 40), body,
        timestampLabel: truncate(dateLabel((md.date as string) || q.date, ctx.lang), 40), likes: md.likes ?? null, reposts: md.reposts ?? null, replies: md.replies ?? null,
        avatarAssetId: sp.anon ? null : portraitFor(ctx, q.speakerId), imageAssetId: null, verified: false, theme: "dark", revealAt,
      }, { subBeats: [from + revealAt], narratedEnd: m ? m.last.from + m.last.dur - from : null });
    }
    case "headline_stack": {
      const items = (md.items as { source_id: string; outlet: string; headline: string; date: string }[]).map((it) => {
        const s = sourceById(ctx, it.source_id);
        return s ? { outlet: truncate(s.publisher, 40), headline: truncate(s.title, 140), dateLabel: truncate(dateLabel(it.date || s.publishedAt, ctx.lang), 30) } : null;
      }).filter((x): x is NonNullable<typeof x> => x !== null).slice(0, 5);
      if (items.length === 0) { ctx.warn("TEMPLATE_FACTS", b.id, "headline sources missing; stack skipped"); return null; }
      const s = syncItems(items.map((x) => x.headline), ctx.F30(18));
      // unmatched items fall on sentence onsets of the beat when possible
      const sentenceOnsets = ctx.words.slice(b.wordStart, b.wordEnd).filter((w, k, arr) => k > 0 && /[.!?…]["»”]?$/.test(arr[k - 1]!.text)).map((w) => w.from - from);
      const ats = s.ats.map((a, k) => (s.end === null && sentenceOnsets[k] !== undefined && sentenceOnsets[k]! > enter ? sentenceOnsets[k]! : a));
      const mono = fillAts(ats, enter, ctx.F30(18));
      return out({ items: items.map((x, k) => ({ ...x, at: mono[k]!, tiltDeg: round2((k % 2 ? -1 : 1) * lerp([1, 3], ctx.R(`hs:${b.id}:${k}`)())) })) }, {
        subBeats: mono.map((a) => from + a), narratedEnd: s.end, contentFrames: Math.max(...mono) + ctx.F30(30),
      });
    }
    case "document_highlight": {
      const src = sourceById(ctx, md.source_id as string);
      if (!src) { ctx.warn("TEMPLATE_FACTS", b.id, `source ${String(md.source_id)} not in the FactSheet; document skipped`); return null; }
      const paragraphs = (md.paragraphs as string[]).slice(0, 6).map((p) => truncate(p, 600));
      const q = md.quote_id ? quoteById(ctx, md.quote_id as string) : undefined;
      const highlightText = q ? q.verbatim : (md.highlight as string);
      if (component === "ArticleHighlight") {
        const hl = highlightText ? locate(paragraphs, highlightText) : null;
        const m = highlightText ? findSpoken(highlightText, pool, 0) : null;
        const highlightAt = m ? Math.max(enter, m.first.from - from) : enter + ctx.F30(15);
        const shot = (ctx.picksByBeat.get(b.id) ?? []).find((p) => ctx.frozen[p.assetId]?.kind === "image");
        return out({
          outlet: truncate(src.publisher, 60), headline: truncate((md.title as string) || src.title, 160), dateLabel: truncate(dateLabel((md.date as string) || src.publishedAt, ctx.lang), 40),
          paragraphs, highlight: hl, highlightAt, screenshotAssetId: b.plan.visualKind === "document_screenshot" && shot ? shot.assetId : null,
        }, { subBeats: [from + highlightAt], narratedEnd: m ? m.last.from + m.last.dur - from : null });
      }
      const lines = wrapLines(paragraphs, 120, 14);
      const redactions: { line: number; start: number; end: number }[] = [];
      for (const r of (md.redact as string[]) ?? []) {
        const at = locate(lines, r);
        if (at) redactions.push({ line: at.paragraph, start: at.start, end: Math.max(at.start + 1, at.end) });
      }
      const kind = md.kind as string;
      const docType = kind === "court" || kind === "letter" || kind === "report" || kind === "pamphlet" ? kind : "report";
      const m = highlightText ? findSpoken(highlightText, pool, 0) : null;
      const redactAt = enter + ctx.F30(8);
      return out({
        docType, title: truncate((md.title as string) || src.title, 120), lines, redactions, stamp: null,
        sourceLabel: truncate(`Source: ${src.publisher}`, 80), stampAt: 0, redactAt,
      }, { subBeats: redactions.length ? [from + redactAt] : [], narratedEnd: m ? m.last.from + m.last.dur - from : null });
    }
    case "split_compare": {
      const imgs = (ctx.picksByBeat.get(b.id) ?? []).filter((p) => ctx.frozen[p.assetId]?.kind === "image");
      return out({
        left: { assetId: imgs[0]?.assetId ?? null, label: truncate(md.left_label as string, 40) },
        right: { assetId: imgs[1]?.assetId ?? null, label: truncate(md.right_label as string, 40) },
        dividerColor: pal.accent,
      });
    }
    case "photo_burst": {
      const imgs = (ctx.picksByBeat.get(b.id) ?? []).filter((p) => ctx.frozen[p.assetId]?.kind === "image").slice(0, Math.min(8, md.count as number));
      if (imgs.length < 3) return null;
      return out(photoBurstProps(ctx, b, imgs.map((p) => p.assetId), (md.caption as string) || ""), { contentFrames: photoBurstFrames(ctx, imgs.length) });
    }
    case "evidence_board": {
      const items = (md.items as { label: string; person_id: string; source_id: string }[]).slice(0, 6).map((it, k) => {
        const p = personById(ctx, it.person_id || null);
        const rule = p ? personRule(ctx, p) : "anon";
        if (rule === "never") return null;
        const label = rule === "name" && p ? p.name : (it.source_id ? sourceById(ctx, it.source_id)?.publisher ?? it.label : it.label);
        const asset = rule === "name" ? portraitFor(ctx, p?.id) : null;
        const pick = (ctx.picksByBeat.get(b.id) ?? [])[k];
        return { assetId: asset ?? (pick && ctx.frozen[pick.assetId]?.kind === "image" ? pick.assetId : null), label: truncate(label, 40) };
      }).filter((x): x is NonNullable<typeof x> => x !== null);
      if (items.length < 2) return null;
      return evidenceBoard(ctx, b, items, (md.links as [number, number][]) ?? [], from, pool, out);
    }
    case "comment_pile": {
      const qs = (md.items as { quote_id: string }[]).map((x) => quoteById(ctx, x.quote_id)).filter((q): q is NonNullable<typeof q> => q !== undefined).slice(0, 10);
      if (qs.length < 3) return null;
      const r = ctx.R(`cp:${b.id}`);
      let at = enter;
      const items = qs.map((q, k) => {
        const sp = speakerName(ctx, q.speakerId);
        const item = { displayName: truncate(sp.anon ? "@user" : sp.name, 40), handle: "", body: truncate(q.verbatim, 160), at, x: round2(lerp([0.2, 0.8], r())), y: round2(lerp([0.2, 0.75], r())), rotDeg: round2((k % 2 ? -1 : 1) * lerp([1, 5], r())) };
        at += ctx.F30(Math.round(lerp([4, 8], r())));
        return item;
      });
      return out({ items, dim: 0.5, theme: "dark" }, { subBeats: items.map((x) => from + x.at), contentFrames: items[items.length - 1]!.at + ctx.F30(45) });
    }
  }
}

/** PhotoBurst items at accelerating 8→5 f, tilt ±2–6°, scale 1.0→1.1. */
export function photoBurstProps(ctx: Ctx, b: BeatCtx, assets: string[], caption: string): Record<string, unknown> {
  const r = ctx.R(`pb:${b.id}`);
  let at = 0;
  const n = assets.length;
  const items = assets.map((assetId, k) => {
    const item = { assetId, at, tiltDeg: round2((k % 2 ? -1 : 1) * lerp([2, 6], r())), x: round2(lerp([0.3, 0.7], r())), y: round2(lerp([0.35, 0.65], r())) };
    at += ctx.F30(Math.round(8 - (3 * k) / Math.max(1, n - 1)));
    return item;
  });
  return { items, scaleFrom: 1, scaleTo: 1.1, caption: truncate(caption, 60) };
}
export const photoBurstFrames = (ctx: Ctx, n: number) => {
  let at = 0;
  for (let k = 0; k + 1 < n; k++) at += ctx.F30(Math.round(8 - (3 * k) / Math.max(1, n - 1)));
  return at + ctx.F30(90);
};

/** EvidenceBoard: items on the 3840×2160 board, camera moves 20–30 f, dwells 45–90 f, items pop when named. */
export function evidenceBoard(
  ctx: Ctx, b: BeatCtx, items: { assetId: string | null; label: string }[], links: [number, number][], from: number, pool: LayoutWord[],
  out: (props: Record<string, unknown>, o?: Partial<Built>) => Built,
): Built {
  const r = ctx.R(`eb:${b.id}`);
  const enter = enterOf(ctx, "EvidenceBoard");
  const cols = Math.min(3, items.length);
  const raw: (number | null)[] = [];
  let idx = 0;
  for (const it of items) {
    const m = findSpoken(it.label, pool, idx);
    if (m) { raw.push(Math.max(enter, m.first.from - from)); idx = m.endIdx; } else raw.push(null);
  }
  const step = ctx.F30(Math.round(lerp([45, 90], r())));
  const ats = fillAts(raw, enter + ctx.F30(10), step);
  const placed = items.map((it, k) => {
    const col = k % cols, row = Math.floor(k / cols);
    return {
      assetId: it.assetId, label: it.label,
      x: Math.round(clamp(500 + col * 1200 + lerp([-120, 120], r()), 0, 3840)), y: Math.round(clamp(500 + row * 1000 + lerp([-100, 100], r()), 0, 2160)),
      w: Math.round(lerp([620, 900], r())), rotDeg: round2((k % 2 ? -1 : 1) * lerp([1, 5], r())), at: ats[k]!,
    };
  });
  const moves = [{ at: 0, focus: -1, frames: ctx.F30(24) }];
  placed.forEach((p, k) => moves.push({ at: Math.max(moves[moves.length - 1]!.at + ctx.F30(20), p.at - ctx.F30(10)), focus: k, frames: Math.round(lerp([20, 30], r())) }));
  const validLinks = links.filter(([a, c]) => a !== c && a >= 0 && c >= 0 && a < placed.length && c < placed.length);
  const last = moves[moves.length - 1]!;
  return out({ items: placed, moves, links: validLinks, backdrop: "cork" }, {
    subBeats: placed.map((p) => from + p.at), contentFrames: last.at + last.frames + ctx.F30(Math.round(lerp([45, 90], r()))),
  });
}

/** Stable small hash for per-item seeds. */
export const seedOf = (s: string) => fnv1a32(s);
export type { Ov };
