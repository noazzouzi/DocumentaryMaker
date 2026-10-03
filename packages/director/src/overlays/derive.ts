// (g) cue → component pass (§9.3 step 7g): candidates = enabled components whose style triggers ∩ DERIVABLE_TRIGGERS
// contain the cue type, whose derivation succeeds, outside cooldown and budgets; seeded weighted pick by weight.
import {
  DERIVABLE_TRIGGERS, STAMP_LEXICON, lerp, normWord, tokenizeDisplay, weightedPick, type CueTag, type OverlayComponentId,
} from "@docmaker/core";
import { clamp, cueFrame, cueWord, round2, shotIdxAt, truncate, type BeatCtx, type Ctx, type Shot } from "../ctx";
import { dateLabel } from "../dates";
import { evidenceBoard, photoBurstFrames, photoBurstProps } from "./fromMotion";
import { boundFullFrameHold, holdOf } from "./hold";
import { CLS, addOv, cooldownOk, enterOf, overshootOk, personById, personRule, portraitFor, type OvState } from "./state";
import { contentText, keywordSlam } from "./cues";
import { fillAts, syncWords } from "./sync";

export interface Bleep { wordId: string; from: number; dur: number; beatId: string }

interface Derivation { props: Record<string, unknown>; from: number; dur?: number; contentFrames?: number; narratedEnd?: number | null; subBeats?: number[]; anchorWord: string | null }

const CURRENCY: [RegExp, "USD" | "EUR" | "GBP" | "NLG"][] = [
  [/guilder|gulden|florin|nlg|ƒ/i, "NLG"], [/euro|eur|€/i, "EUR"], [/pound|gbp|£|sterling/i, "GBP"], [/dollar|usd|\$/i, "USD"],
];

/** Numbers a cue value may denote ("5,500", "5 500", "5.500", "1.5"). */
export function parseNumbers(v: string): number[] {
  const s = v.replace(/[  \s]/g, "");
  const out = new Set<number>();
  const m = s.match(/-?\d[\d.,]*/);
  if (!m) return [];
  const t = m[0];
  const plain = Number(t.replace(/[.,]/g, ""));
  if (Number.isFinite(plain)) out.add(plain);
  const dotDec = Number(t.replace(/,/g, ""));
  if (Number.isFinite(dotDec)) out.add(dotDec);
  const commaDec = Number(t.replace(/\./g, "").replace(",", "."));
  if (Number.isFinite(commaDec)) out.add(commaDec);
  return [...out];
}

/** Lines of ≤ 48 chars (≤ 4) from a free text. */
function toLines(text: string): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + w).length > 48) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
    if (out.length === 4) break;
  }
  if (line && out.length < 4) out.push(line);
  return out.map((l) => truncate(l, 48));
}

/** Is a word inside a quoted passage of its segment (« », “ ”, " ")? Bleeps never apply to the narrator's own words. */
function insideQuote(ctx: Ctx, b: BeatCtx, wordIdx: number): boolean {
  if (b.seg.mode === "clip-narrated") return true;
  const text = b.sseg?.displayText ?? "";
  const w = ctx.words[wordIdx];
  if (!w) return false;
  const tok = tokenizeDisplay(text)[w.idx];
  if (!tok) return false;
  let depth = 0;
  for (let i = 0; i < tok.start; i++) {
    const ch = text[i]!;
    if (ch === "«" || ch === "“") depth++;
    else if (ch === "»" || ch === "”") depth = Math.max(0, depth - 1);
    else if (ch === "\"") depth = depth > 0 ? depth - 1 : depth + 1;
  }
  return depth > 0;
}

function derive(ctx: Ctx, shots: readonly Shot[], b: BeatCtx, k: number, cue: CueTag, comp: OverlayComponentId): Derivation | null {
  const a = cueFrame(ctx, b, k);
  const w = cueWord(ctx, b, k);
  const anchorWord = w?.id ?? null;
  const pal = ctx.tok.tokens.palette;
  const picks = (ctx.picksByBeat.get(b.id) ?? []).filter((p) => ctx.frozen[p.assetId]?.kind === "image");
  switch (comp) {
    case "Stamp": {
      if (cue.type !== "REVEAL") return null;
      const lex = STAMP_LEXICON[ctx.lang] as readonly string[];
      const gated = STAMP_LEXICON.statusGated as Record<string, string>;
      const cands = [...tokenizeDisplay(b.text.onScreenText), ...tokenizeDisplay(cue.value)].map((t) => t.norm);
      const statuses = new Set(b.plan.factIds.filter((f) => f.startsWith("C")).map((id) => ctx.facts.claims.find((c) => c.id === id)?.status).filter(Boolean));
      let text: string | null = null;
      for (const c of cands) {
        const hit = lex.find((x) => normWord(x) === c);
        if (hit) { text = hit; break; }
        const g = Object.keys(gated).find((x) => normWord(x) === c);
        if (g && statuses.has(gated[g] as never)) { text = g; break; }
      }
      if (!text) return null;
      const r = ctx.R(`stamp:${b.id}`);
      const at = a + ctx.F30(4); // at the reveal + 4 f
      return { props: { text, color: pal.danger, rotationDeg: round2((r() < 0.5 ? -1 : 1) * lerp([4, 10], r())), x: 0.5, y: 0.45, scale: 1 }, from: at, anchorWord };
    }
    case "NumberCounter": {
      const nums = parseNumbers(cue.value);
      const fig = b.plan.factIds.filter((f) => f.startsWith("N")).map((id) => ctx.facts.figures.find((x) => x.id === id)).find((f) => f && nums.some((n) => Math.abs(n - f.value) <= 1e-9 * Math.max(1, Math.abs(f.value))));
      if (!fig) return null;
      const cur = CURRENCY.find(([re]) => re.test(fig.unit))?.[1] ?? null;
      const percent = /%|percent|pour ?cent/i.test(fig.unit);
      const props = {
        value: fig.value, from: 0, format: cur ? "currency" : percent ? "percent" : "number", currency: cur, decimals: Number.isInteger(fig.value) ? 0 : 2,
        label: truncate(fig.label, 60), locale: ctx.lang === "fr" ? "fr-FR" : "en-US", color: cur ? pal.money : pal.accent,
      };
      return { props, from: a, anchorWord };
    }
    case "QuoteCard": case "SocialPost": {
      const q = b.plan.quoteId ? ctx.facts.quotes.find((x) => x.id === b.plan.quoteId) : undefined;
      if (!q) return null;
      if (comp === "SocialPost" && q.medium !== "social_post") return null;
      const sp = personById(ctx, q.speakerId);
      const named = sp && personRule(ctx, sp) === "name";
      const src = ctx.facts.sources.find((s) => s.id === q.sourceId);
      const text = truncate(q.verbatim, comp === "QuoteCard" ? 400 : 400);
      const pool = ctx.words.slice(b.wordStart, Math.max(b.wordEnd, ctx.beats[b.idx + 1]?.ch === b.ch ? ctx.beats[b.idx + 1]!.wordEnd : b.wordEnd));
      const synced = syncWords(text, pool, a);
      const matched = synced.filter((x) => x.at !== null).length;
      const enter = enterOf(ctx, comp);
      if (comp === "QuoteCard") {
        const ok = matched * 2 >= synced.length;
        const ats = ok ? fillAts(synced.map((x) => x.at), enter, ctx.F30(6)) : [];
        return {
          props: {
            text, speaker: named ? truncate(sp!.name, 60) : "", sourceLabel: truncate([src?.publisher ?? "", dateLabel(q.date, ctx.lang)].filter(Boolean).join(", "), 80),
            portraitAssetId: named ? portraitFor(ctx, sp!.id) : null, translated: false, words: ok ? synced.map((x, j) => ({ text: x.text, at: ats[j]!, emphasis: false })) : [],
          },
          from: a, anchorWord, narratedEnd: ok ? Math.max(...ats) + ctx.F30(10) : null, subBeats: ok ? [a + ats[0]!] : [],
        };
      }
      const first = synced.find((x) => x.at !== null)?.at ?? enter + ctx.F30(10);
      return {
        props: {
          variant: "post", displayName: truncate(named ? sp!.name : "@user", 50), handle: "", body: text, timestampLabel: truncate(dateLabel(q.date, ctx.lang), 40),
          likes: null, reposts: null, replies: null, avatarAssetId: named ? portraitFor(ctx, sp!.id) : null, imageAssetId: null, verified: false, theme: "dark", revealAt: first,
        },
        from: a, anchorWord, subBeats: [a + first],
      };
    }
    case "SplitScreen": {
      if (picks.length < 2) return null;
      const parts = b.text.onScreenText.split(/\s+(?:vs\.?|versus|contre|\/|—|-)\s+/i);
      return {
        props: { left: { assetId: picks[0]!.assetId, label: truncate(parts[0] ?? "", 40) }, right: { assetId: picks[1]!.assetId, label: truncate(parts[1] ?? "", 40) }, dividerColor: pal.accent },
        from: a, anchorWord, dur: Math.max(ctx.F30(60), Math.min(ctx.F30(240), b.end - a)),
      };
    }
    case "CensorBar": {
      if (cue.type !== "SENSITIVE" || cue.value === "bleep") return null;
      const si = shotIdxAt(shots, a);
      const s = shots[si]!;
      const pick = s.src.pickSlot !== null ? (ctx.picksByBeat.get(s.beatId ?? "") ?? []).find((p) => p.slot === s.src.pickSlot) : undefined;
      const rect = pick?.score.safeCrop ?? { x: 0, y: 0, w: 1, h: 1 };
      return { props: { rect, mode: "blur", label: null }, from: s.from, dur: s.end - s.from, anchorWord: null };
    }
    case "Spotlight": {
      const s = shots[shotIdxAt(shots, a)]!;
      if (s.src.kind !== "image" || s.src.pickSlot === null || s.layout !== "cover") return null;
      return {
        props: { cx: round2(clamp(s.src.focal.x, 0, 1)), cy: round2(clamp(s.src.focal.y, 0, 1)), rx: 0.18, ry: 0.24, dim: 0.4, drawCircle: true, color: pal.accent },
        from: a, anchorWord, dur: Math.max(ctx.F30(30), Math.min(ctx.F30(180), s.end - a)),
      };
    }
    case "KineticText": {
      if (!b.text.onScreenText.trim() || contentText(b.text.onScreenText, ctx.lang) === null) return null; // never a lone "THE"
      const lines = toLines(b.text.onScreenText);
      if (lines.length === 0) return null;
      const bw = ctx.words.slice(b.wordStart, b.wordEnd);
      const emphasis = b.text.emphasisIdx.map((i) => bw[i]?.text).filter((x): x is string => !!x).slice(0, 8);
      return { props: { lines, emphasis, align: "center" }, from: a, anchorWord };
    }
    case "PhotoBurst": {
      if (picks.length < 3) return null;
      const assets = picks.slice(0, 8).map((p) => p.assetId);
      return { props: photoBurstProps(ctx, b, assets, ""), from: a, anchorWord, contentFrames: photoBurstFrames(ctx, assets.length) };
    }
    case "EvidenceBoard": {
      const people = b.plan.personIds.map((id) => personById(ctx, id)).filter((p) => p && personRule(ctx, p) === "name" && ctx.portraitOf.has(p.id));
      let items: { assetId: string | null; label: string }[];
      if (people.length >= 2) items = people.slice(0, 6).map((p) => ({ assetId: portraitFor(ctx, p!.id), label: truncate(p!.name, 40) }));
      else if (picks.length >= 2) items = picks.slice(0, 6).map((p, j) => ({ assetId: p.assetId, label: truncate(b.text.onScreenText.split(/[,;]/)[j]?.trim() ?? "", 40) }));
      else return null;
      const pool = ctx.words.slice(b.wordStart, b.wordEnd);
      const built = evidenceBoard(ctx, b, items, [], a, pool, (props, o) => ({ component: "EvidenceBoard", props, from: a, subBeats: o?.subBeats ?? [], narratedEnd: null, contentFrames: o?.contentFrames, anchorWord }));
      return { props: built.props, from: a, anchorWord, contentFrames: built.contentFrames, subBeats: built.subBeats };
    }
    case "KeywordSlam": case "LowerThird": case "FreezeLabel": case "SourceLabel":
      return null; // served by (b), (d), (e)
    default:
      return null;
  }
}

/** Runs step 7g. Returns the bleeps (SENSITIVE "bleep" inside quoted passages) for the audio pass. */
export function cueComponents(ctx: Ctx, st: OvState, shots: readonly Shot[]): Bleep[] {
  const bleeps: Bleep[] = [];
  for (const b of ctx.beats) {
    b.cues.forEach((cue, k) => {
      if (st.served.has(`${b.id}:${k}`)) return;
      if (cue.type === "SENSITIVE" && cue.value === "bleep") {
        const w = cueWord(ctx, b, k);
        if (!w) return;
        const wi = ctx.wordIndex.get(w.id)!;
        if (!insideQuote(ctx, b, wi)) { ctx.warn("BLEEP_SKIPPED", b.id, "bleeps apply only inside quoted passages"); return; }
        bleeps.push({ wordId: w.id, from: w.from, dur: w.dur, beatId: b.id });
        st.served.add(`${b.id}:${k}`);
        return;
      }
      if (cue.type === "SHOCK") { if (keywordSlam(ctx, st, b, cueFrame(ctx, b, k), cueWord(ctx, b, k)?.id ?? null)) st.served.add(`${b.id}:${k}`); return; }
      const cands: { comp: OverlayComponentId; d: Derivation; weight: number }[] = [];
      for (const pol of ctx.style.components) {
        if (!pol.enabled || pol.weight <= 0 || !pol.triggers.includes(cue.type) || !DERIVABLE_TRIGGERS[pol.id].includes(cue.type)) continue;
        if (!overshootOk(ctx, pol.id)) continue;
        const d = derive(ctx, shots, b, k, cue, pol.id);
        if (!d || !cooldownOk(ctx, st, pol.id, d.from)) continue;
        cands.push({ comp: pol.id, d, weight: pol.weight });
      }
      if (cands.length === 0) return;
      const weights: Partial<Record<OverlayComponentId, number>> = {};
      for (const c of cands) weights[c.comp] = c.weight;
      const pick = weightedPick(weights, ctx.R(`cmp:${b.id}:${k}`));
      const c = cands.find((x) => x.comp === pick)!;
      const h = holdOf(c.comp, c.d.props, ctx.fps, { narratedEnd: c.d.narratedEnd ?? null, contentFrames: c.d.contentFrames });
      const dur = c.d.dur ?? boundFullFrameHold(ctx, b, c.comp, c.d.from, h.dur, c.d.narratedEnd ?? null);
      const ov = addOv(ctx, st, {
        component: c.comp, ref: b.id, beatId: b.id, from: c.d.from, dur, props: c.d.props, cls: CLS.cue, origin: "cue",
        anchorWord: c.d.anchorWord, subBeats: c.d.subBeats, readHold: Math.min(h.readHold, h.maxHold),
      });
      if (ov) st.served.add(`${b.id}:${k}`);
    });
  }
  return bleeps;
}
