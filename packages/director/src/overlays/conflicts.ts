// Overlay conflicts (§9.3 step 7): graphics concurrency ≤ overlayMaxConcurrent, full-frame items never overlap,
// one item per zone and band; the lower COMPONENT_META.priority is shortened or dropped. Then z by band.
import { COMPONENT_META, framesAt } from "@docmaker/core";
import type { Ctx } from "../ctx";
import type { Ov, OvState } from "./state";

const overlaps = (a: Ov, b: Ov) => a.from < b.from + b.dur && b.from < a.from + a.dur;

function clash(a: Ov, b: Ov): boolean {
  if (!overlaps(a, b)) return false;
  const ma = COMPONENT_META[a.component], mb = COMPONENT_META[b.component];
  if (ma.band === "hud" || mb.band === "hud") return ma.band === mb.band && a.zone === b.zone;
  if (a.component === "Stamp" || b.component === "Stamp") return a.component === b.component; // stamps land on cards by design
  if (a.component === "CensorBar" || b.component === "CensorBar" || a.component === "Spotlight" || b.component === "Spotlight") {
    return a.component === b.component;
  }
  if (ma.fullFrame || mb.fullFrame) return true;
  return ma.band === mb.band && a.zone === b.zone;
}

export function zOf(o: Ov): number {
  const m = COMPONENT_META[o.component];
  if (m.band === "picture") return 10 + Math.min(39, m.priority * 3);
  if (m.band === "hud") return 300 + m.priority;
  if (o.component === "ChapterCard" || o.component === "TitleSting") return 190;
  if (o.component === "KeywordSlam") return 180;
  if (o.component === "Stamp") return 170;
  return 100 + Math.min(69, m.priority * 5);
}

export function resolveConflicts(ctx: Ctx, st: OvState): void {
  const live = st.items.filter((o) => !o.dropped);
  const order = [...live].sort((a, b) =>
    COMPONENT_META[b.component].priority - COMPONENT_META[a.component].priority || b.cls - a.cls || a.from - b.from || (a.id < b.id ? -1 : 1));
  const placed: Ov[] = [];
  const maxConc = ctx.Bu.overlayMaxConcurrent;
  for (const it of order) {
    const minHold = framesAt(ctx.fps, COMPONENT_META[it.component].minHold30);
    const need = it.origin === "template" ? Math.min(it.readHold, framesAt(ctx.fps, COMPONENT_META[it.component].maxHold30)) : Math.min(minHold, it.dur);
    let ok = true;
    for (let guard = 0; guard < 20; guard++) {
      const hit = placed.find((p) => clash(it, p));
      const graphics = COMPONENT_META[it.component].band === "graphics" && it.component !== "Stamp";
      const concurrent = graphics ? placed.filter((p) => COMPONENT_META[p.component].band === "graphics" && p.component !== "Stamp" && overlaps(it, p)) : [];
      const conc = concurrent.length + 1 > maxConc ? concurrent.sort((a, b) => a.from - b.from)[0] : undefined;
      const c = hit ?? conc;
      if (!c) break;
      if (it.from < c.from && c.from - it.from >= need) { it.dur = c.from - it.from; continue; }
      ok = false;
      break;
    }
    if (!ok) {
      it.dropped = true;
      ctx.warn("OVERLAY_CONFLICT", it.beatId ?? it.ref, `${it.component} dropped (overlaps a higher-priority overlay)`);
      continue;
    }
    if (it.dur < it.readHold && it.origin !== "label") {
      ctx.warn("READABILITY", it.beatId ?? it.ref, `${it.component} shortened to ${it.dur} f (< ${it.readHold} f read hold) by a conflict`);
    }
    it.subBeats = it.subBeats.filter((f) => f < it.from + it.dur);
    placed.push(it);
  }
}
