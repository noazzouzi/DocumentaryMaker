// editorial-report.<lang>.md (§13.5, M2): claims used (status, jurisdiction, asOf, source URLs), fact-check items with
// resolutions and notes, third-party clips (URL, timecodes, cumulative seconds and share of runtime), AI images,
// voice provider and licence, person acknowledgements, and a "not legal advice" footer. Deterministic (no clock).
import {
  PENDING_STATUSES, type FactCheck, type FactCheckItem, type FactSheet, type Lang, type Ledger, type LedgerEntry, type Timeline,
  type UsageDoc, type VoiceTrack,
} from "@docmaker/core";

const TXT = {
  en: {
    title: "Editorial report", summary: "Summary", claims: "Claims used", factcheck: "Fact-check", clips: "Third-party clips", ai: "AI-generated images",
    voice: "Voice", people: "People", footer: "This report is an editorial aid generated from the project data. It is **not legal advice**: have a lawyer review sensitive content before publishing.",
    none: "None.", runtime: "Runtime", asOf: "Fact sheet as of", recheck: "pending status — recheck before publishing",
    open: "open", total: "total", share: "of runtime", notUsed: "No claim is referenced by the fact-check; all claims of the fact sheet are listed.",
    nonPublic: "not a public figure — on-screen naming/portraits required the person acknowledgement gate", minor: "minor or private victim — never named, searched or shown",
    synthetic: "synthetic voice — disclose as altered/synthetic content when realistic", recording: "human recording",
  },
  fr: {
    title: "Rapport éditorial", summary: "Résumé", claims: "Allégations utilisées", factcheck: "Vérification des faits", clips: "Extraits tiers", ai: "Images générées par IA",
    voice: "Voix", people: "Personnes", footer: "Ce rapport est une aide éditoriale générée à partir des données du projet. Ce **n'est pas un avis juridique** : faites relire les contenus sensibles par un avocat avant publication.",
    none: "Aucun(e).", runtime: "Durée", asOf: "Fiche factuelle au", recheck: "statut en cours — à revérifier avant publication",
    open: "ouverts", total: "total", share: "de la durée", notUsed: "Aucune allégation n'est référencée par la vérification ; toutes les allégations de la fiche sont listées.",
    nonPublic: "pas une personnalité publique — nom/portrait à l'écran soumis à la validation « person-ack »", minor: "mineur ou victime privée — jamais nommé(e), recherché(e) ni montré(e)",
    synthetic: "voix synthétique — à déclarer comme contenu altéré/synthétique si réaliste", recording: "enregistrement humain",
  },
} as const;

const cell = (s: string | number | null | undefined) => String(s ?? "").replace(/\|/g, "\\|").replace(/\s*[\r\n]+\s*/g, " ").trim() || "—";
const row = (xs: (string | number | null | undefined)[]) => `| ${xs.map(cell).join(" | ")} |`;
const table = (head: string[], rows: (string | number | null | undefined)[][]) =>
  rows.length ? [row(head), `| ${head.map(() => "---").join(" | ")} |`, ...rows.map(row)] : [];

export function hms(sec: number): string {
  const s = Math.max(0, Math.floor(sec + 1e-6));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${p2(Math.floor(s / 3600))}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}`;
}

/** Merged [from, to) program spans where an asset is on screen (V1) or heard (clip audio). */
export function assetSpans(t: Timeline, assetId: string): [number, number][] {
  const spans: [number, number][] = [];
  for (const c of t.video) if ((c.source.kind === "video" || c.source.kind === "image") && c.source.assetId === assetId) spans.push([c.from, c.from + c.dur]);
  for (const c of t.audio.clip) if (c.assetId === assetId) spans.push([c.from, c.from + c.dur]);
  spans.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else out.push([s[0], s[1]]);
  }
  return out;
}

const isClip = (e: LedgerEntry) => e.youtube !== null || e.provider === "youtube" || e.license.code === "YOUTUBE-FAIR-USE" || e.declaration?.kind === "third-party-quotation";
const isAi = (e: LedgerEntry) => e.provider === "fal" || e.license.code === "AI-GENERATED" || e.declaration?.kind === "ai-generated" || e.license.restrictions.includes("synthetic");

export interface ClipUse { entry: LedgerEntry; spans: [number, number][]; seconds: number; cumulative: number; share: number }

/** Third-party clips used by this timeline, in order of first appearance, with cumulative seconds and share. */
export function clipUsage(t: Timeline, ledger: Ledger, usage: UsageDoc): ClipUse[] {
  const used = new Set(usage.usage.map((u) => u.assetId));
  const runtime = t.durationInFrames / t.fps;
  const list = ledger.entries
    .filter((e) => isClip(e) && (used.has(e.assetId) || t.assets[e.assetId]))
    .map((e) => ({ entry: e, spans: assetSpans(t, e.assetId) }))
    .filter((x) => x.spans.length)
    .sort((a, b) => a.spans[0]![0] - b.spans[0]![0] || a.entry.assetId.localeCompare(b.entry.assetId));
  let cum = 0;
  return list.map((x) => {
    const seconds = x.spans.reduce((a, [f, g]) => a + (g - f), 0) / t.fps;
    cum += seconds;
    return { ...x, seconds, cumulative: cum, share: runtime > 0 ? cum / runtime : 0 };
  });
}

const pct = (x: number) => `${(100 * x).toFixed(1)} %`;
const RISK_ORDER: Record<FactCheckItem["risk"], number> = { high: 0, medium: 1, low: 2, none: 3 };

export function writeEditorialReport(i: { t: Timeline; facts: FactSheet; factCheck: FactCheck; ledger: Ledger; usage: UsageDoc; voice: VoiceTrack | null; lang: Lang }): string {
  const { t, facts, factCheck, ledger, usage, voice, lang } = i;
  const L = TXT[lang];
  const out: string[] = [];
  const runtime = t.durationInFrames / t.fps;
  const sources = new Map(facts.sources.map((s) => [s.id, s]));
  const srcList = (ids: string[]) => ids.map((id) => sources.get(id)?.url ?? id).join(" ");

  // ---- claims used: referenced by a fact-check item (else every claim of the fact sheet)
  const referenced = new Set(factCheck.items.flatMap((x) => x.factIds));
  const usedClaims = facts.claims.filter((c) => referenced.has(c.id));
  const claims = usedClaims.length ? usedClaims : facts.claims;
  const items = [...factCheck.items].sort((a, b) => RISK_ORDER[a.risk] - RISK_ORDER[b.risk] || a.id.localeCompare(b.id));
  const openItems = items.filter((x) => x.resolution === "open");
  const clips = clipUsage(t, ledger, usage);
  const usedIds = new Set(usage.usage.map((u) => u.assetId));
  const ai = ledger.entries.filter((e) => isAi(e) && (usedIds.has(e.assetId) || assetSpans(t, e.assetId).length > 0));

  out.push(`# ${L.title} — ${t.title} (${lang.toUpperCase()})`, "");
  out.push(`## ${L.summary}`, "");
  out.push(`- ${L.runtime}: ${hms(runtime)} (${t.durationInFrames} frames @ ${t.fps} fps)`);
  out.push(`- ${L.asOf}: ${facts.asOf}`);
  out.push(`- ${L.claims}: ${claims.length}; ${L.factcheck}: ${items.length} (${openItems.length} ${L.open}, ${items.filter((x) => x.risk === "high").length} high risk)`);
  out.push(`- ${L.clips}: ${clips.length}, ${clips.length ? `${clips[clips.length - 1]!.cumulative.toFixed(1)} s (${pct(clips[clips.length - 1]!.share)} ${L.share})` : "0 s"}`);
  out.push(`- ${L.ai}: ${ai.length}`);
  out.push(`- ${L.voice}: ${voice ? `${voice.provider}${voice.voiceId ? ` / ${voice.voiceId}` : ""} (${voice.kind})` : "—"}`, "");

  out.push(`## ${L.claims}`, "");
  if (!usedClaims.length && facts.claims.length) out.push(`_${L.notUsed}_`, "");
  if (claims.length) {
    out.push(...table(["Id", "Claim", "Status", "Jurisdiction", "Decision", "As of", "Response", "Sources"], claims.map((c) => [
      c.id, `${c.summary}${c.madeBy ? ` — ${c.madeBy}` : ""}${c.against ? ` → ${c.against}` : ""}`,
      `${c.status}${PENDING_STATUSES.includes(c.status) ? ` (${L.recheck})` : ""}`, c.jurisdiction, c.decisionDate, c.asOf, c.subjectResponse, srcList(c.sourceIds),
    ])), "");
  } else out.push(L.none, "");

  out.push(`## ${L.factcheck}`, "");
  if (items.length) {
    out.push(...table(["Id", "Where", "Verdict", "Risk", "Resolution", "Sentence", "Note / problem", "Suggested rewrite"], items.map((x) => [
      x.id, `${x.surface} ${x.where}`, x.verdict, x.risk, x.resolution, x.sentence, x.note || x.problem, x.suggestedRewrite,
    ])), "");
  } else out.push(L.none, "");
  if (factCheck.needsMoreResearch.length) out.push(`- needs more research: ${factCheck.needsMoreResearch.map(cell).join("; ")}`, "");
  if (factCheck.titleThumbnailIssues.length) out.push(`- title/thumbnail: ${factCheck.titleThumbnailIssues.map(cell).join("; ")}`, "");

  out.push(`## ${L.clips}`, "");
  if (clips.length) {
    out.push(...table(["#", "Source", "Channel", "Program timecodes", "Source timecodes", "Seconds", "Cumulative", `Share (${L.total})`, "Licence"], clips.map((c, n) => {
      const yt = c.entry.youtube;
      const base = yt?.startMs != null ? yt.startMs / 1000 : null;
      const srcTc = base !== null
        ? t.video.filter((v) => v.source.kind === "video" && v.source.assetId === c.entry.assetId).map((v) => `${hms(base + (v.source as { sourceInFrames: number }).sourceInFrames / t.fps)}–${hms(base + ((v.source as { sourceInFrames: number }).sourceInFrames + v.dur) / t.fps)}`).join(", ")
        : "";
      return [
        n + 1, yt?.url || c.entry.sourcePageUrl, yt ? `${yt.channel}${yt.channelVerified ? " (verified)" : ""}` : c.entry.author ?? "",
        c.spans.map(([a, b]) => `${hms(a / t.fps)}–${hms(b / t.fps)}`).join(", "), srcTc,
        c.seconds.toFixed(1), c.cumulative.toFixed(1), pct(c.share), c.entry.license.code,
      ];
    })), "");
  } else out.push(L.none, "");

  out.push(`## ${L.ai}`, "");
  if (ai.length) {
    out.push(...table(["Asset", "Title / prompt", "Where (program)", "Licence"], ai.map((e) => [
      e.assetId.slice(0, 12), e.title, assetSpans(t, e.assetId).map(([a, b]) => `${hms(a / t.fps)}–${hms(b / t.fps)}`).join(", "), `${e.license.code}${e.license.attributionText ? ` — ${e.license.attributionText}` : ""}`,
    ])), "");
  } else out.push(L.none, "");

  out.push(`## ${L.voice}`, "");
  if (voice) {
    out.push(`- Provider: ${voice.provider}${voice.modelId ? ` (${voice.modelId})` : ""}, voice ${voice.voiceId || "—"}, take ${voice.id} (${voice.kind})`);
    out.push(`- Licence: ${voice.license.code}${voice.license.attributionText ? ` — ${voice.license.attributionText}` : ""}${voice.license.restrictions.length ? ` (${voice.license.restrictions.join(", ")})` : ""}`);
    out.push(`- ${voice.provider === "recording" ? L.recording : L.synthetic}`);
    out.push(`- Timing: ${voice.timing.source}${voice.missingSegmentIds.length ? `; missing segments: ${voice.missingSegmentIds.join(", ")}` : ""}${voice.segments.some((s) => s.pickup) ? "; pickup TTS segments present" : ""}`);
    for (const n of voice.notes) out.push(`- ${cell(n)}`);
    out.push("");
  } else out.push(L.none, "");

  out.push(`## ${L.people}`, "");
  const people = facts.people.filter((p) => !p.publicFigure || p.isMinorOrPrivateVictim);
  if (people.length) {
    for (const p of people) out.push(`- **${cell(p.isMinorOrPrivateVictim ? `[${p.id}]` : p.name)}** (${cell(p.roleInStory)}): ${p.isMinorOrPrivateVictim ? L.minor : L.nonPublic}`);
    out.push("");
  } else out.push(L.none, "");

  out.push("---", "", L.footer, "");
  return out.join("\n");
}
