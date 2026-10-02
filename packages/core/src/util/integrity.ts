// packages/core/src/util/integrity.ts — cross-document reference checks (§4.18 rule codes). Isomorphic and pure.
import type { Lang, LintIssue } from "../schema/common";
import type { Project } from "../schema/project";
import type { FactSheet } from "../schema/research";
import type { Outline } from "../schema/outline";
import type { Script } from "../schema/script";
import type { BeatPlansDoc, BeatSlicesDoc } from "../schema/beats";
import type { FrozenDoc, PicksDoc, UserPicksDoc } from "../schema/assets";
import type { OverridesDoc, Timeline } from "../schema/timeline";

export interface DocSet {
  project?: Project; factSheet?: FactSheet; outline?: Outline; scripts?: Partial<Record<Lang, Script>>;
  plans?: BeatPlansDoc; slices?: Partial<Record<Lang, BeatSlicesDoc>>; userPicks?: UserPicksDoc; picks?: PicksDoc;
  frozen?: FrozenDoc; timeline?: Timeline; overrides?: OverridesDoc;
}

const err = (rule: string, where: string, msg: string): LintIssue => ({ level: "error", rule, where, msg });
const warn = (rule: string, where: string, msg: string): LintIssue => ({ level: "warn", rule, where, msg });

function collectFromProps(v: unknown, out: Set<string>): void {
  if (Array.isArray(v)) { for (const x of v) collectFromProps(x, out); return; }
  if (v !== null && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (/assetid$/i.test(k) && typeof x === "string") out.add(x);
      else collectFromProps(x, out);
    }
  }
}

/** Every assetId in sources, overlay props and audio (sorted, unique). */
export function collectAssetIds(t: Timeline): string[] {
  const s = new Set<string>();
  for (const c of t.video) if (c.source.kind === "image" || c.source.kind === "video") s.add(c.source.assetId);
  for (const o of t.overlays) collectFromProps(o.props, s);
  s.add(t.audio.voProgram.assetId);
  for (const x of t.audio.vo) s.add(x.assetId);
  for (const x of t.audio.music) s.add(x.assetId);
  for (const x of t.audio.sfx) s.add(x.assetId);
  for (const x of t.audio.clip) s.add(x.assetId);
  return [...s].sort();
}

/** All item ids in document order (duplicates kept so IDS_UNIQUE can find them). */
export function timelineItemIds(t: Timeline): string[] {
  const a = t.audio;
  return [
    ...t.video.map((x) => x.id), ...t.overlays.map((x) => x.id), ...t.captions.map((x) => x.id), ...t.fx.map((x) => x.id),
    ...a.vo.map((x) => x.id), ...a.music.map((x) => x.id), ...a.sfx.map((x) => x.id), ...a.clip.map((x) => x.id),
    ...a.silences.map((x) => x.id), ...t.markers.map((x) => x.id),
  ];
}

/** Hard invariant: identical ordered (segmentId, type, quoteId) per chapter. Non-empty result → LANG_PARITY. */
export function validateLangParity(primary: Script, other: Script): LintIssue[] {
  const issues: LintIssue[] = [];
  const otherCh = new Map(other.chapters.map((c) => [c.chapterId, c]));
  const primCh = new Set(primary.chapters.map((c) => c.chapterId));
  for (const pc of primary.chapters) {
    const oc = otherCh.get(pc.chapterId);
    if (!oc) { issues.push(err("LANG_PARITY", pc.chapterId, `chapter ${pc.chapterId} missing in ${other.lang}`)); continue; }
    const n = Math.max(pc.segments.length, oc.segments.length);
    for (let i = 0; i < n; i++) {
      const a = pc.segments[i];
      const b = oc.segments[i];
      if (!a || !b) {
        issues.push(err("LANG_PARITY", pc.chapterId, `segment count differs (${primary.lang} ${pc.segments.length} vs ${other.lang} ${oc.segments.length})`));
        break;
      }
      if (a.id !== b.id || a.type !== b.type || a.quoteId !== b.quoteId) {
        issues.push(err("LANG_PARITY", a.id, `segment skeleton differs at position ${i}: ${a.id}/${a.type}/${a.quoteId} vs ${b.id}/${b.type}/${b.quoteId}`));
      }
    }
  }
  for (const oc of other.chapters) {
    if (!primCh.has(oc.chapterId)) issues.push(err("LANG_PARITY", oc.chapterId, `chapter ${oc.chapterId} exists only in ${other.lang}`));
  }
  return issues;
}

/** Cross-document checks; rule codes REF_* (§4.18). Level error unless noted. */
export function checkRefs(d: DocSet): LintIssue[] {
  const issues: LintIssue[] = [];
  const { project, factSheet: fs, scripts, plans, slices, userPicks, picks, frozen, timeline, overrides } = d;

  // REF_PROJECT
  if (project) {
    if (new Set(project.languages).size !== project.languages.length) issues.push(err("REF_PROJECT", "project", "duplicate languages"));
    if (!project.languages.includes(project.primaryLang)) issues.push(err("REF_PROJECT", "project", `primaryLang ${project.primaryLang} not in languages`));
    for (const l of Object.keys(project.voice)) {
      if (!project.languages.includes(l as Lang)) issues.push(err("REF_PROJECT", "project", `voice settings for ${l} which is not a project language`));
    }
  }

  // REF_SEGMENT
  for (const s of Object.values(scripts ?? {})) {
    if (!s) continue;
    const seen = new Set<string>();
    for (const ch of s.chapters) {
      for (const seg of ch.segments) {
        if (seen.has(seg.id)) issues.push(err("REF_SEGMENT", seg.id, `duplicate segment id in ${s.lang}`));
        seen.add(seg.id);
        if (!seg.id.startsWith(ch.chapterId + "-")) issues.push(err("REF_SEGMENT", seg.id, `segment is not in chapter ${ch.chapterId}`));
      }
    }
  }

  const primaryLang: Lang | undefined = project?.primaryLang ?? plans?.primaryLang ?? (scripts ? (Object.keys(scripts)[0] as Lang | undefined) : undefined);
  const primary = primaryLang ? scripts?.[primaryLang] : undefined;
  const segIndex = new Map<string, { type: string }>();
  if (primary) for (const ch of primary.chapters) for (const seg of ch.segments) segIndex.set(seg.id, { type: seg.type });

  // REF_BEAT_SEGMENT
  if (plans && primary) {
    for (const p of plans.plans) {
      const seg = segIndex.get(p.segmentId);
      if (!seg) { issues.push(err("REF_BEAT_SEGMENT", p.id, `segment ${p.segmentId} not in the primary script`)); continue; }
      if (seg.type === "sponsor_slot") issues.push(err("REF_BEAT_SEGMENT", p.id, "sponsor_slot segments get no beats"));
      if (p.id.endsWith("-CLIP") && (seg.type !== "clip" || p.id !== `${p.segmentId}-CLIP`)) issues.push(err("REF_BEAT_SEGMENT", p.id, "-CLIP beats belong to their clip segment only"));
      if (p.id.endsWith("-BR") && (seg.type !== "music_breath" || p.id !== `${p.segmentId}-BR`)) issues.push(err("REF_BEAT_SEGMENT", p.id, "-BR beats belong to their music_breath segment only"));
    }
  }

  // REF_BEAT_FACTS / REF_QUOTE
  if (fs) {
    const byPrefix: Record<string, Set<string>> = {
      S: new Set(fs.sources.map((x) => x.id)), P: new Set(fs.people.map((x) => x.id)), E: new Set(fs.timeline.map((x) => x.id)),
      N: new Set(fs.figures.map((x) => x.id)), C: new Set(fs.claims.map((x) => x.id)), Q: new Set(fs.quotes.map((x) => x.id)),
    };
    const has = (ref: string) => byPrefix[ref[0] ?? ""]?.has(ref) ?? false;
    if (plans) {
      for (const p of plans.plans) {
        for (const pid of p.personIds) if (!byPrefix.P!.has(pid)) issues.push(err("REF_BEAT_FACTS", p.id, `unknown person ${pid}`));
        for (const f of p.factIds) if (!has(f)) issues.push(err("REF_BEAT_FACTS", p.id, `unknown fact ${f}`));
        if (p.quoteId !== null && !byPrefix.Q!.has(p.quoteId)) issues.push(err("REF_BEAT_FACTS", p.id, `unknown quote ${p.quoteId}`));
      }
    }
    for (const q of fs.quotes) {
      if (!byPrefix.P!.has(q.speakerId)) issues.push(err("REF_QUOTE", q.id, `unknown speaker ${q.speakerId}`));
      if (!byPrefix.S!.has(q.sourceId)) issues.push(err("REF_QUOTE", q.id, `unknown source ${q.sourceId}`));
    }
  }

  // REF_SLICE_PLAN
  if (plans) {
    const planIds = new Map(plans.plans.map((p) => [p.id, p]));
    for (const sd of Object.values(slices ?? {})) {
      if (!sd) continue;
      const seen = new Set<string>();
      for (const tx of sd.texts) {
        const p = planIds.get(tx.beatId);
        if (!p) { issues.push(err("REF_SLICE_PLAN", tx.beatId, `slice for unknown beat in ${sd.lang}`)); continue; }
        if (seen.has(tx.beatId)) issues.push(err("REF_SLICE_PLAN", tx.beatId, `duplicate slice in ${sd.lang}`));
        seen.add(tx.beatId);
        if (tx.lang !== sd.lang) issues.push(err("REF_SLICE_PLAN", tx.beatId, `slice language ${tx.lang} in ${sd.lang} doc`));
        const synthetic = p.id.endsWith("-CLIP") || p.id.endsWith("-BR");
        if (synthetic && tx.text !== "") issues.push(err("REF_SLICE_PLAN", tx.beatId, "clip/breath beats carry no text"));
        if (!synthetic && tx.text.trim() === "") issues.push(err("REF_SLICE_PLAN", tx.beatId, "narration beat with empty text"));
      }
      for (const p of plans.plans) {
        if (!(p.id.endsWith("-CLIP") || p.id.endsWith("-BR")) && !seen.has(p.id)) issues.push(err("REF_SLICE_PLAN", p.id, `no ${sd.lang} slice for narration beat`));
      }
    }
  }

  // REF_PICK / REF_CLIP
  const planSet = plans ? new Set(plans.plans.map((p) => p.id)) : null;
  const assetOk = (id: string) => (frozen ? id in frozen.assets : true);
  const clipOk = (segmentId: string) => (primary ? segIndex.get(segmentId)?.type === "clip" : true);
  if (picks) {
    for (const pk of picks.picks) {
      if (planSet && !planSet.has(pk.beatId)) issues.push(err("REF_PICK", pk.beatId, "pick for unknown beat"));
      if (!assetOk(pk.assetId)) issues.push(err("REF_PICK", pk.beatId, `asset ${pk.assetId.slice(0, 12)} not frozen`));
    }
    for (const pt of picks.portraits) if (!assetOk(pt.assetId)) issues.push(err("REF_PICK", pt.personId, `portrait asset ${pt.assetId.slice(0, 12)} not frozen`));
    for (const c of picks.clips) {
      if (!clipOk(c.segmentId)) issues.push(err("REF_CLIP", c.segmentId, "clip resolution for a non-clip segment"));
      if (c.assetId !== null && !assetOk(c.assetId)) issues.push(err("REF_PICK", c.segmentId, `clip asset ${c.assetId.slice(0, 12)} not frozen`));
    }
  }
  if (userPicks) {
    for (const pk of userPicks.picks) {
      if (planSet && !planSet.has(pk.beatId)) issues.push(warn("REF_PICK", pk.beatId, "user pick for unknown beat (orphaned)"));
      if (!assetOk(pk.assetId)) issues.push(err("REF_PICK", pk.beatId, `asset ${pk.assetId.slice(0, 12)} not frozen`));
    }
    for (const pt of userPicks.portraits) if (!assetOk(pt.assetId)) issues.push(err("REF_PICK", pt.personId, `portrait asset ${pt.assetId.slice(0, 12)} not frozen`));
    for (const c of userPicks.clips) if (!clipOk(c.segmentId)) issues.push(err("REF_CLIP", c.segmentId, "clip resolution for a non-clip segment"));
  }

  // REF_TIMELINE_ASSETS
  if (timeline) {
    for (const id of collectAssetIds(timeline)) {
      if (!(id in timeline.assets)) issues.push(err("REF_TIMELINE_ASSETS", id.slice(0, 12), `asset ${id} has no TimelineAsset entry`));
    }
  }

  // REF_OVERRIDE_TARGET (warn)
  if (overrides && timeline) {
    const ids = new Set(timelineItemIds(timeline));
    for (const o of overrides.overrides) {
      const ov = o.override;
      const tid = "clipId" in ov ? ov.clipId : "itemId" in ov ? ov.itemId : null;
      if (tid !== null && !ids.has(tid)) issues.push(warn("REF_OVERRIDE_TARGET", o.id, `target ${tid} not in the timeline (will be rejected)`));
    }
  }

  // LANG_PARITY
  if (primary && scripts) {
    for (const [l, s] of Object.entries(scripts)) {
      if (!s || l === primaryLang) continue;
      issues.push(...validateLangParity(primary, s));
    }
  }
  return issues;
}
