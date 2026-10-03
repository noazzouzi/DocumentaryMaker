// Gates (§5.4): evaluation (blocking reason + plan hash) and per-gate approval validation. Editorial gates are NEVER
// satisfied by --yes / --max-cost / the auto-approve threshold; only fixtures with autoApproveGates approve them.
import {
  ApprovalsDoc, DocmakerError, EDITORIAL_GATES, FactCheck, P, PENDING_STATUSES, Project, docHash, hashJson, normWord,
  type Approval, type FactCheckItem, type FactSheet, type GateId, type Lang, type Outline, type RiskFlag, type StageId,
} from "@docmaker/core";
import { withFileLock, type ProjectStore } from "@docmaker/core/node";
import { videoVerifiedQuotes } from "@docmaker/assets";
import { docs, effectivePublish } from "./docs";
import { daysBetween, nowIso } from "./util";

export interface GateNeed { gate: GateId; reason: "unmet" | "stale"; planHash: string; summary: string }
export type ApprovalInput = Omit<Approval, "gate" | "approvedAt">;

export const NOTE_MIN = 10;
const GATING_RISK_FLAGS: readonly RiskFlag[] = ["real_person_allegations", "sexual_violence", "ongoing_trial"];
export const RECHECK_MAX_AGE_DAYS = 30;

// ---------------------------------------------------------------- approvals doc
const NEVER = new AbortController().signal;
/** Appends under a file lock: the web process and the job worker record approvals concurrently. */
export async function addApproval(store: ProjectStore, a: Approval): Promise<void> {
  await withFileLock(store.abs(".approvals.lock"), `approvals:${process.pid}`, async () => {
    const cur = await docs.approvals(store);
    await store.writeJson(P.approvals, ApprovalsDoc, { schemaVersion: 1, approvals: [...cur.approvals, a] }, { writer: "engine" });
  }, { signal: NEVER, pollMs: 20 });
}

export function personAcksOf(doc: ApprovalsDoc): string[] {
  return [...new Set(doc.approvals.filter((a) => a.gate === "person-ack").flatMap((a) => a.items))].sort();
}

const hasApproval = (doc: ApprovalsDoc, gate: GateId, lang: Lang | null, planHash: string) =>
  doc.approvals.some((a) => a.gate === gate && (lang === null || a.lang === lang || a.lang === null) && a.planHash === planHash);

// ---------------------------------------------------------------- factcheck-ack
export function riskFlagsGateMediums(flags: readonly RiskFlag[]): boolean {
  return flags.some((f) => GATING_RISK_FLAGS.includes(f));
}
/** quote_mismatch and unverified_quote with verification not-found (high) can only be fixed. */
export function fixOnly(it: FactCheckItem): boolean {
  return it.verdict === "quote_mismatch" || (it.verdict === "unverified_quote" && it.risk === "high");
}
export function gatingItems(fc: FactCheck, riskFlags: readonly RiskFlag[]): FactCheckItem[] {
  const mediums = riskFlagsGateMediums(riskFlags);
  return fc.items.filter((it) => it.risk === "high" || (mediums && it.risk === "medium")).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function itemSatisfied(it: FactCheckItem): boolean {
  if (it.resolution === "rewritten") return true;
  if (fixOnly(it)) return false;
  return (it.resolution === "acknowledged" || it.resolution === "dismissed") && it.note.trim().length >= NOTE_MIN;
}
export const factcheckPlanHash = (items: readonly FactCheckItem[]): string =>
  hashJson(items.map((i) => ({ id: i.id, verdict: i.verdict, resolution: i.resolution, note: i.note })));

/**
 * A factcheck-ack approval records, next to the per-item notes, the verdict and risk each blocking item had when it was
 * approved: itemNotes["sig:<FC id>"] = "<verdict>|<risk>". Ids are stable across re-runs (where, sentence, kind, origin),
 * so an approval covers an item only for the verdict and risk the reviewer saw.
 */
export const ACK_SIG_PREFIX = "sig:";
export const ackSignature = (it: Pick<FactCheckItem, "verdict" | "risk">): string => `${it.verdict}|${it.risk}`;

/** FC id → signatures under which factcheck-ack approvals of `lang` covered it (an empty set: approved, signature unknown). */
export function ackCoverage(doc: ApprovalsDoc, lang: Lang): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const a of doc.approvals) {
    if (a.gate !== "factcheck-ack" || (a.lang !== lang && a.lang !== null)) continue;
    for (const id of a.items) {
      const set = out.get(id) ?? new Set<string>();
      const sig = a.itemNotes[ACK_SIG_PREFIX + id];
      if (sig) set.add(sig);
      out.set(id, set);
    }
  }
  return out;
}

/** Resolved blocking items whose verdict or risk changed since an approval covered them (they need a new review). */
export function changedSinceAck(gating: readonly FactCheckItem[], coverage: ReadonlyMap<string, ReadonlySet<string>>): FactCheckItem[] {
  return gating.filter((i) => i.resolution !== "rewritten" && i.resolution !== "open" && coverage.has(i.id) && !coverage.get(i.id)!.has(ackSignature(i)));
}

/** Carried-over resolutions of items whose verdict or risk changed are re-opened: the reviewer saw another finding. */
export function reopenChanged(items: readonly FactCheckItem[], previous: FactCheck | null): FactCheckItem[] {
  if (!previous) return [...items];
  const prev = new Map(previous.items.map((x) => [x.id, x]));
  return items.map((it) => {
    const p = prev.get(it.id);
    if (!p || it.resolution === "open" || (p.verdict === it.verdict && p.risk === it.risk)) return it;
    return { ...it, resolution: "open" as const };
  });
}

/** The fact-check sees video-verified quotes as verbatim (the fact sheet itself is never rewritten here). */
export function withVideoVerified(fs: FactSheet, ids: readonly string[]): FactSheet {
  if (ids.length === 0) return fs;
  const set = new Set(ids);
  return { ...fs, quotes: fs.quotes.map((q) => (set.has(q.id) && q.verification !== "verbatim" ? { ...q, verification: "verbatim" as const, verifiedBy: "video" as const } : q)) };
}

/** FactCheck.factsheetHash: the fact sheet the fact-check ran against (video-verified quotes applied). */
export const factsheetHash = (fs: FactSheet): string => docHash(fs);

/** The fact sheet as the factcheck stage sees it now (null without a fact sheet). */
export async function currentFactsheetHash(store: ProjectStore): Promise<string | null> {
  const fs = await docs.factsheet(store);
  if (!fs) return null;
  const picks = await docs.picks(store);
  return factsheetHash(withVideoVerified(fs, picks ? videoVerifiedQuotes(picks) : []));
}

export interface FactcheckGateState {
  missing: boolean; stale: boolean; staleReasons: string[]; gating: FactCheckItem[]; open: FactCheckItem[]; planHash: string; factCheck: FactCheck | null;
}

export async function factcheckGateState(store: ProjectStore, project: Project, lang: Lang): Promise<FactcheckGateState> {
  const fc = await docs.factcheck(store, lang);
  const suggestion = await docs.suggestion(store);
  const riskFlags = suggestion?.riskFlags ?? [];
  if (!fc) return { missing: true, stale: true, staleReasons: ["no fact-check yet"], gating: [], open: [], planHash: hashJson({ missing: lang }), factCheck: null };
  const script = await docs.script(store, lang);
  const slices = await docs.slices(store, lang);
  const reasons: string[] = [];
  if (!script || fc.scriptHash !== docHash(script)) reasons.push("the script changed since the fact-check");
  if (!slices || fc.slicesHash !== docHash(slices)) reasons.push("the on-screen text changed since the fact-check");
  if (fc.publishHash !== hashJson(effectivePublish(project, lang, script, suggestion))) reasons.push("the title/thumbnail/description changed since the fact-check");
  // claim statuses, sensitivities, person flags and quote verifications drive rules c, d, g and h
  if (fc.factsheetHash !== (await currentFactsheetHash(store))) reasons.push("the fact sheet changed since the fact-check");
  const gating = gatingItems(fc, riskFlags);
  const open = gating.filter((i) => !itemSatisfied(i));
  return { missing: false, stale: reasons.length > 0, staleReasons: reasons, gating, open, planHash: factcheckPlanHash(gating), factCheck: fc };
}

export async function factcheckGate(store: ProjectStore, project: Project, lang: Lang): Promise<GateNeed | null> {
  const st = await factcheckGateState(store, project, lang);
  if (st.stale) {
    return { gate: "factcheck-ack", reason: st.missing ? "unmet" : "stale", planHash: st.planHash, summary: `${lang}: ${st.staleReasons.join("; ")} — re-run the fact-check` };
  }
  if (st.gating.length === 0) return null;
  const approvals = await docs.approvals(store);
  let pending: FactCheckItem[] = st.open;
  if (st.open.length === 0) {
    if (hasApproval(approvals, "factcheck-ack", lang, st.planHash)) return null;
    // per-item coverage: resolutions carry over by stable id when the fact-check re-runs (an item that disappeared does
    // not void the others), but only for the verdict and risk each item had when it was approved
    const coverage = ackCoverage(approvals, lang);
    const changed = changedSinceAck(st.gating, coverage);
    if (changed.length) {
      return {
        gate: "factcheck-ack", reason: "stale", planHash: st.planHash,
        summary: `${lang}: the verdict or risk of ${changed.map((i) => `${i.id} (now ${i.verdict}, ${i.risk})`).join(", ")} changed since it was acknowledged — review and acknowledge again`,
      };
    }
    pending = st.gating.filter((i) => i.resolution !== "rewritten" && !coverage.has(i.id));
    if (pending.length === 0) return null;
  }
  const fixes = st.open.filter(fixOnly).length;
  return {
    gate: "factcheck-ack", reason: "unmet", planHash: st.planHash,
    summary: `${lang}: ${pending.length} fact-check item(s) need acknowledgement${fixes ? ` (${fixes} can only be fixed)` : ""}: ${pending.map((i) => i.id).join(", ")}`,
  };
}

// ---------------------------------------------------------------- person-ack
function nameMentioned(name: string, texts: readonly string[]): boolean {
  const tokens = name.split(/\s+/).map(normWord).filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  const full = tokens.join(" ");
  return texts.some((t) => ` ${t.split(/\s+/).map(normWord).join(" ")} `.includes(` ${full} `));
}

/** Non-public, non-minor persons used on screen or in narration that have no person-ack yet. */
export async function pendingPersons(store: ProjectStore, project: Project): Promise<{ id: string; name: string }[]> {
  const fs = await docs.factsheet(store);
  if (!fs) return [];
  const acks = new Set(personAcksOf(await docs.approvals(store)));
  const plans = await docs.plans(store);
  const used = new Set(plans?.plans.flatMap((p) => p.personIds) ?? []);
  const texts: string[] = [];
  for (const lang of project.languages) {
    const s = await docs.script(store, lang);
    for (const ch of s?.chapters ?? []) for (const seg of ch.segments) texts.push(seg.displayText);
    const sl = await docs.slices(store, lang);
    for (const t of sl?.texts ?? []) if (t.onScreenText) texts.push(t.onScreenText);
  }
  return fs.people
    .filter((p) => !p.publicFigure && !p.isMinorOrPrivateVictim && !acks.has(p.id) && (used.has(p.id) || nameMentioned(p.name, texts)))
    .map((p) => ({ id: p.id, name: p.name }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function personGate(store: ProjectStore, project: Project): Promise<GateNeed | null> {
  const pending = await pendingPersons(store, project);
  if (pending.length === 0) return null;
  return {
    gate: "person-ack", reason: "unmet", planHash: hashJson(pending.map((p) => p.id)),
    summary: `non-public person(s) need an acknowledgement before they appear: ${pending.map((p) => `${p.id} (${p.name})`).join(", ")}`,
  };
}

// ---------------------------------------------------------------- recheck
export async function pendingClaims(store: ProjectStore, project: Project, now = new Date()): Promise<{ id: string; status: string; asOf: string }[]> {
  const fs = await docs.factsheet(store);
  if (!fs) return [];
  const cited = new Set<string>();
  for (const lang of project.languages) {
    const s = await docs.script(store, lang);
    for (const ch of s?.chapters ?? []) for (const seg of ch.segments) for (const f of seg.factIds) cited.add(f);
  }
  for (const p of (await docs.plans(store))?.plans ?? []) for (const f of p.factIds) cited.add(f);
  // a recheck acknowledgement (or an unchanged re-check) is itself valid for RECHECK_MAX_AGE_DAYS
  const acked = new Set((await docs.approvals(store)).approvals.filter((a) => a.gate === "recheck" && daysBetween(a.approvedAt, now) <= RECHECK_MAX_AGE_DAYS).flatMap((a) => a.items));
  return fs.claims
    .filter((c) => cited.has(c.id) && PENDING_STATUSES.includes(c.status) && !acked.has(c.id) && daysBetween(c.asOf || fs.asOf, now) > RECHECK_MAX_AGE_DAYS)
    .map((c) => ({ id: c.id, status: c.status, asOf: c.asOf || fs.asOf }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function recheckGate(store: ProjectStore, project: Project): Promise<GateNeed | null> {
  const pending = await pendingClaims(store, project);
  if (pending.length === 0) return null;
  return {
    gate: "recheck", reason: "unmet", planHash: hashJson(pending.map((c) => c.id)),
    summary: `pending claim status older than ${RECHECK_MAX_AGE_DAYS} days: ${pending.map((c) => `${c.id} (${c.status}, as of ${c.asOf})`).join(", ")} — run \`docmaker factcheck <slug> --recheck\` or acknowledge each claim`,
  };
}

// ---------------------------------------------------------------- style-confirm, outline-approval, fair-use
export function styleGate(project: Project): GateNeed | null {
  if (project.styleConfirmed && project.styleId) return null;
  return {
    gate: "style-confirm", reason: "unmet", planHash: hashJson({ styleId: project.styleId }),
    summary: project.styleId ? `confirm the style "${project.styleId}" (docmaker style <slug> --confirm)` : "pick a style (docmaker style <slug> --pick <id>)",
  };
}

export async function outlineGate(store: ProjectStore): Promise<GateNeed | null> {
  const o = await docs.outline(store);
  if (!o) return { gate: "outline-approval", reason: "unmet", planHash: hashJson({ outline: null }), summary: "no outline yet" };
  const h = docHash(o);
  const approvals = await docs.approvals(store);
  if (approvals.approvals.some((a) => a.gate === "outline-approval" && a.planHash === h)) return null;
  const earlier = approvals.approvals.some((a) => a.gate === "outline-approval");
  return {
    gate: "outline-approval", reason: earlier ? "stale" : "unmet", planHash: h,
    summary: (earlier ? "the outline changed since it was approved; " : "") + (o.thesisConfirmed ? "approve the outline" : "confirm the thesis, then approve the outline"),
  };
}

export async function scriptHasClips(store: ProjectStore, project: Project): Promise<boolean> {
  const s = await docs.script(store, project.primaryLang);
  return !!s?.chapters.some((c) => c.segments.some((x) => x.type === "clip"));
}

export async function fairUseGate(store: ProjectStore, project: Project, offline: boolean): Promise<GateNeed | null> {
  if (project.editorial.fairUseAcknowledged || offline || !project.assets.providers.includes("youtube")) return null;
  if (!(await scriptHasClips(store, project))) return null;
  return { gate: "fair-use", reason: "unmet", planHash: hashJson("fair-use"), summary: "acknowledge the YouTube fair-use notice before the first download (§17.3)" };
}

// ---------------------------------------------------------------- approval validation
export interface ApproveSideEffects {
  approval: Approval;
  projectPatch: Partial<Project> | null;
  outline: Outline | null; // updated outline (thesis confirmation) to write first
  factCheck: FactCheck | null; // updated fact-check (resolutions + notes) to write first
}

function noteFor(id: string, a: ApprovalInput, existing: string): string {
  return (a.itemNotes[id] ?? (existing.trim().length >= NOTE_MIN ? existing : a.note)).trim();
}

/**
 * Validates an approval for a gate and computes what must be persisted (§5.4). Throws VALIDATION on refusal.
 * `fixtureAllowed`: the project is a fixture whose fixture.json has autoApproveGates:true.
 */
export async function prepareApproval(
  store: ProjectStore, project: Project, gate: GateId, a: ApprovalInput, o: { fixtureAllowed: boolean; facts: FactSheet | null; stage?: StageId },
): Promise<ApproveSideEffects> {
  const editorial = EDITORIAL_GATES.includes(gate);
  if (editorial && (a.by === "flag" || a.by === "auto-threshold")) {
    throw new DocmakerError("VALIDATION", `the ${gate} gate is editorial: it cannot be satisfied by --yes, --max-cost or the auto-approve threshold`, { hint: "review the items and approve them explicitly" });
  }
  if (a.by === "fixture" && !o.fixtureAllowed) throw new DocmakerError("VALIDATION", `by:"fixture" is reserved for fixture projects with autoApproveGates`);
  const base = (planHash: string, items: string[], itemNotes: Record<string, string>, stage: StageId, lang: Lang | null): Approval => ({
    gate, stage, lang, planHash, approvedAt: nowIso(), by: a.by, note: a.note, items, itemNotes,
  });

  switch (gate) {
    case "style-confirm": {
      const styleId = project.styleId ?? (await docs.suggestion(store))?.recommendedStyleId ?? null;
      if (!styleId) throw new DocmakerError("VALIDATION", "no style to confirm: pick one first", { hint: "docmaker style <slug> --pick <id>" });
      return { approval: base(hashJson({ styleId }), [styleId], {}, "outline", null), projectPatch: { styleId, styleConfirmed: true }, outline: null, factCheck: null };
    }
    case "outline-approval": {
      const outline = await docs.outline(store);
      if (!outline) throw new DocmakerError("UPSTREAM_MISSING", "there is no outline to approve", { hint: "run the outline stage first" });
      let next = outline;
      if (!outline.thesisConfirmed) {
        if (a.by !== "fixture") throw new DocmakerError("VALIDATION", "the thesis is not confirmed", { hint: "edit or confirm the thesis first (docmaker outline <slug> --confirm-thesis)" });
        next = { ...outline, thesisConfirmed: true };
      }
      const h = docHash(next);
      if (a.planHash && /^[a-f0-9]{64}$/.test(a.planHash) && a.planHash !== docHash(outline) && a.planHash !== h) {
        throw new DocmakerError("CONFLICT", "the outline changed since you reviewed it", { hint: "reload the outline and approve again" });
      }
      return { approval: base(h, [], {}, "outline", null), projectPatch: null, outline: next === outline ? null : next, factCheck: null };
    }
    case "factcheck-ack": {
      const lang = a.lang ?? project.primaryLang;
      const st = await factcheckGateState(store, project, lang);
      if (st.missing || !st.factCheck) throw new DocmakerError("UPSTREAM_MISSING", `no fact-check for ${lang}`, { hint: "run the factcheck stage first" });
      if (st.stale) throw new DocmakerError("VALIDATION", `the ${lang} fact-check is stale (${st.staleReasons.join("; ")})`, { hint: "re-run the fact-check, then acknowledge" });
      const items = new Set(a.items);
      const missing = st.gating.filter((i) => !items.has(i.id) && !(i.resolution === "rewritten"));
      if (missing.length) throw new DocmakerError("VALIDATION", `every blocking item must be acknowledged: missing ${missing.map((i) => i.id).join(", ")}`, { details: missing.map((i) => i.id) });
      const unknown = [...items].filter((id) => !st.factCheck!.items.some((i) => i.id === id));
      if (unknown.length) throw new DocmakerError("VALIDATION", `unknown fact-check item(s): ${unknown.join(", ")}`);
      const fixes = st.gating.filter((i) => fixOnly(i) && i.resolution !== "rewritten");
      if (fixes.length) {
        throw new DocmakerError("VALIDATION", `${fixes.map((i) => `${i.id} (${i.verdict})`).join(", ")} can only be fixed (rewrite the text, then re-run the fact-check)`, { details: fixes.map((i) => i.id) });
      }
      // notes: ≥ 10 chars; per-item notes may not be identical across items unless they are the approval's explicitly
      // shared note (`note`: the CLI --note, the web "same note for all" confirmation)
      const explicit = Object.entries(a.itemNotes).filter(([id]) => items.has(id));
      const sharedKey = a.note.trim().toLowerCase();
      const seen = new Map<string, string>();
      for (const [id, n] of explicit) {
        const key = n.trim().toLowerCase();
        if (sharedKey && key === sharedKey) continue;
        if (seen.has(key)) throw new DocmakerError("VALIDATION", `identical notes on ${seen.get(key)} and ${id}: write a specific note per item (or use one shared note explicitly)`);
        seen.set(key, id);
      }
      const notes: Record<string, string> = {};
      const updated = st.factCheck.items.map((it) => {
        if (!items.has(it.id) || it.resolution === "rewritten") return it;
        const note = noteFor(it.id, a, it.note);
        if (note.length < NOTE_MIN) throw new DocmakerError("VALIDATION", `${it.id}: a note of at least ${NOTE_MIN} characters is required`);
        notes[it.id] = note;
        return { ...it, resolution: it.resolution === "dismissed" ? ("dismissed" as const) : ("acknowledged" as const), note };
      });
      const fc = FactCheck.parse({ ...st.factCheck, items: updated });
      const gating = gatingItems(fc, (await docs.suggestion(store))?.riskFlags ?? []);
      for (const it of gating) if (it.resolution !== "rewritten") notes[ACK_SIG_PREFIX + it.id] = ackSignature(it);
      return {
        approval: base(factcheckPlanHash(gating), gating.map((i) => i.id), notes, "factcheck", lang),
        projectPatch: null, outline: null, factCheck: fc,
      };
    }
    case "person-ack": {
      const facts = o.facts ?? (await docs.factsheet(store));
      if (!facts) throw new DocmakerError("UPSTREAM_MISSING", "no fact sheet", { hint: "run the research stage first" });
      if (a.items.length === 0) throw new DocmakerError("VALIDATION", "person-ack needs at least one person id");
      const notes: Record<string, string> = {};
      for (const id of a.items) {
        const p = facts.people.find((x) => x.id === id);
        if (!p) throw new DocmakerError("VALIDATION", `unknown person ${id}`);
        if (p.isMinorOrPrivateVictim) throw new DocmakerError("VALIDATION", `${id} is a minor or a private victim: never searched, named on screen or shown, whatever the approvals`);
        const note = (a.itemNotes[id] ?? a.note).trim();
        if (note.length < NOTE_MIN) throw new DocmakerError("VALIDATION", `${id}: a note of at least ${NOTE_MIN} characters is required`);
        notes[id] = note;
      }
      const items = [...new Set(a.items)].sort();
      return { approval: base(hashJson(items), items, notes, "assets", null), projectPatch: null, outline: null, factCheck: null };
    }
    case "recheck": {
      if (a.items.length === 0) throw new DocmakerError("VALIDATION", "recheck acknowledgement needs claim ids (or run `docmaker factcheck <slug> --recheck`)");
      const facts = o.facts ?? (await docs.factsheet(store));
      const notes: Record<string, string> = {};
      for (const id of a.items) {
        if (!facts?.claims.some((c) => c.id === id)) throw new DocmakerError("VALIDATION", `unknown claim ${id}`);
        const note = (a.itemNotes[id] ?? a.note).trim();
        if (note.length < NOTE_MIN) throw new DocmakerError("VALIDATION", `${id}: a note of at least ${NOTE_MIN} characters is required`);
        notes[id] = note;
      }
      const items = [...new Set(a.items)].sort();
      return { approval: base(hashJson(items), items, notes, "render", null), projectPatch: null, outline: null, factCheck: null };
    }
    case "fair-use": {
      return {
        approval: base(hashJson("fair-use"), [], {}, "assets", null),
        projectPatch: { editorial: { ...project.editorial, fairUseAcknowledged: true } }, outline: null, factCheck: null,
      };
    }
    case "cost": {
      if (!/^[a-f0-9]{64}$/.test(a.planHash)) throw new DocmakerError("VALIDATION", "a cost approval needs the estimate's planHash");
      return { approval: base(a.planHash, [...a.items].sort(), {}, o.stage ?? a.stage, a.lang), projectPatch: null, outline: null, factCheck: null };
    }
  }
}
