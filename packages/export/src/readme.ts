// Export bundle README (§13.5): import steps per NLE, path remap, baked vs native, non-portable effects, stems,
// fair use / credits, AI disclosure, fact-check asOf, Remotion licence. English with French sections.
import type { ExportFormat, Lang, Timeline } from "@docmaker/core";
import { srtGroups } from "./srt";

export function bundleFileNames(t: Pick<Timeline, "projectSlug" | "lang">) {
  const b = `${t.projectSlug}.${t.lang}`;
  return {
    fcpxml: `${b}.fcpxml`, premiere: `${b}.premiere.xml`, resolve: `${b}.resolve.xml`, otio: `${b}.otio`, edl: `${b}.markers.edl`, srt: `${b}.srt`,
    credits: "credits.md", publish: `publish.${t.lang}.md`, report: `editorial-report.${t.lang}.md`, readme: "README.md", reference: "reference.mp4",
  };
}

/** Counts of what the NLE files cannot carry natively (they become markers; the reference render shows them). */
export function nonPortableSummary(t: Timeline): { label: string; count: number }[] {
  const n = new Map<string, number>();
  const inc = (k: string) => n.set(k, (n.get(k) ?? 0) + 1);
  t.video.forEach((c, i) => {
    if (c.layout !== "cover") inc(`layout ${c.layout}`);
    if (c.treatment !== "none") inc(`treatment ${c.treatment}`);
    if (c.camera.handheld && c.camera.handheld.ampPx > 0) inc("handheld camera noise");
    if (i === 0) return;
    const tr = c.transitionIn;
    if (tr.kind === "cover" && tr.presentation !== "dipToBlack") inc(`cover transition ${tr.presentation}`);
    else if (tr.kind === "overlap" && (tr.presentation === "push" || tr.presentation === "wipe")) inc(`overlap transition ${tr.presentation}`);
    else if (tr.kind === "overlap" && tr.presentation === "blurDissolve") inc("blur dissolve (exported as a cross dissolve)");
    else if (tr.kind === "cut" && tr.accent.type === "velocity") inc(`velocity cut ${tr.accent.preset}`);
    else if (tr.kind === "cut" && tr.accent.type === "flash") inc("flash cut accent");
  });
  for (const f of t.fx) if (f.fx !== "punch" && f.fx !== "zoom") inc(`fx ${f.fx}`);
  if (t.overlays.length) n.set("graphics overlays (markers; ProRes 4444 renders with --overlays)", t.overlays.length);
  const burned = t.captions.filter((g) => g.burn).length;
  if (burned) n.set("burned captions (SRT carries the full subtitles)", burned);
  const bleeps = t.audio.silences.filter((s) => s.affects.includes("vo")).length;
  if (bleeps) n.set("VO bleeps (baked in the VO stem)", bleeps);
  return [...n.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

const has = (formats: ExportFormat[], f: ExportFormat) => formats.includes(f);

export function exportReadme(i: { t: Timeline; formats: ExportFormat[]; exportRoot: string | null; asOf: string; hasReference: boolean; lang: Lang }): string {
  const { t, formats } = i;
  const f = bundleFileNames(t);
  const secs = Math.round(t.durationInFrames / t.fps);
  const dur = `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, "0")} s`;
  const np = nonPortableSummary(t);
  const L: string[] = [];
  const p = (...lines: string[]) => L.push(...lines);

  p(`# ${t.title} — NLE export (${i.lang.toUpperCase()})`, "");
  p(`Timeline: 1920×1080, ${t.fps} fps NDF, 48 kHz, ${dur} (${t.durationInFrames} frames), timecode from 00:00:00:00. One timeline per language: the voice-over length drives every cut.`, "");
  p("## Files", "");
  const files: [boolean, string, string][] = [
    [has(formats, "fcpxml"), f.fcpxml, "FCPXML (DaVinci Resolve 18+, Final Cut Pro 10.6+)"],
    [has(formats, "xmeml-premiere"), f.premiere, "FCP7 XML for Adobe Premiere Pro"],
    [has(formats, "xmeml-resolve"), f.resolve, "FCP7 XML, Resolve flavour (alternative to the FCPXML)"],
    [has(formats, "otio"), f.otio, "OpenTimelineIO (Premiere 25.6.1+, Resolve 20, Avid, Kdenlive)"],
    [has(formats, "markers-edl"), f.edl, "Resolve timeline markers"],
    [has(formats, "srt"), f.srt, `subtitles (${srtGroups(t).length} caption groups)`],
    [has(formats, "stems"), "stems/{vo,music,sfx,clip}.wav", "baked mix stems (disabled tracks A5–A8)"],
    [true, "media/", "every picture and sound, conformed (stills exactly 1920×1080, audio 48 kHz WAV)"],
    [true, f.credits, "credits and licences"],
    [has(formats, "publish-kit"), f.publish, "title, thumbnail text, description, chapters"],
    [has(formats, "editorial-report"), f.report, "claims, fact-check resolutions, clips, AI images, voice"],
  ];
  for (const [on, name, what] of files) if (on) p(`- \`${name}\` — ${what}`);
  p(i.hasReference
    ? `- \`${f.reference}\` — the DocumentaryMaker render of this exact timeline and mix, to compare against`
    : "- no reference render yet (render the project, then export again to include `reference.mp4`)");
  p("");

  const fcp = has(formats, "fcpxml");
  const rxml = has(formats, "xmeml-resolve");
  const pxml = has(formats, "xmeml-premiere");
  const otio = has(formats, "otio");
  const edl = has(formats, "markers-edl");
  if (fcp || rxml || otio) {
    p("## DaVinci Resolve", "");
    p("1. Create a **new project** at 1920×1080 and " + `${t.fps} fps (the frame rate locks once the Media Pool has media).`);
    const xml = fcp ? f.fcpxml : rxml ? f.resolve : f.otio;
    p(`2. File > Import > Timeline… > \`${xml}\`. In the Load XML dialog tick **"Use sizing information"** — without it every zoom and position is dropped.`);
    if (edl) p(`3. Import the markers: Media Pool > Timelines > Import > Timeline Markers from EDL… > \`${f.edl}\`.`);
    p("- Resolve (free) on Linux cannot decode H.264/AAC: transcode the `.mp4` files in `media/` to DNxHR or ProRes first, or use Resolve Studio.", "");
  }
  if (pxml || otio) {
    p("## Adobe Premiere Pro", "");
    if (pxml) p(`- File > Import > \`${f.premiere}\` (Premiere 25.6.1+ recommended: earlier builds can drop Motion keyframes on XML import).`);
    if (otio) p(`- On 25.6.1+: File > Import > \`${f.otio}\` (OpenTimelineIO with Premiere Motion/Opacity metadata).`);
    p("");
  }
  if (fcp) {
    p("## Final Cut Pro", "");
    p(`- File > Import > XML… > \`${f.fcpxml}\`.`, "");
  }
  p("## Media paths and relinking", "");
  if (i.exportRoot) p(`Media paths were written for the editing machine under \`${i.exportRoot}\` (export root). Copy this folder there unchanged.`);
  else p("Media paths are the absolute paths of this machine. Editing elsewhere? Set the project's *export root* to the folder where this bundle will live on the editing machine and export again.");
  p("Every file in `media/` has a unique ASCII name (`NNN_name_id.ext`), so \"Relink / Reconnect media\" by folder finds everything at once.", "");

  p("## What is native and what is baked", "");
  p("- **Native, editable:** cuts, stills and video, centred cross dissolves (and dips to black), scale/position/rotation keyframes (Ken Burns, punch-ins and zooms baked into keyframes), audio gain keyframes (music ducking and fades, clip audio ducking), markers.");
  p("- **Audio tracks:** A1 voice-over (one clip per segment), A2 music, A3 sound effects, A4 clip audio; A5–A8 are the baked stems of the DocumentaryMaker mix, **disabled** — enable them instead of A1–A4 to hear the exact mix (some NLEs ignore imported gain keyframes).");
  p("- **Not portable** (left as markers named \"… not portable\"; see the reference render):");
  if (np.length) for (const x of np) p(`  - ${x.label}: ${x.count}`);
  else p("  - nothing in this timeline");
  p("- Graphics overlays and burned captions are not in the NLE timeline: each overlay is a marker (component + text); full subtitles are in the SRT.", "");

  p("## Before publishing", "");
  p("- **Credits:** keep `credits.md` in the video description. Third-party clips are used under fair use / fair dealing at your own risk: keep them short, commented and transformative.");
  p("- **AI / synthetic disclosure checklist:** synthetic or cloned voice? AI-generated images (see the editorial report)? Realistic altered footage? → tick YouTube's \"Altered or synthetic content\" box when it applies.");
  p(`- **Fact-check status as of ${i.asOf}:** legal statuses (charges, appeals, lawsuits) change — recheck pending claims before publishing.`);
  p("- DocumentaryMaker renders with Remotion: users are responsible for their own Remotion licence (a company licence is required above Remotion's size thresholds).", "");

  p("---", "", "## Français — importer dans un logiciel de montage", "");
  if (fcp || rxml || otio) p(`- **DaVinci Resolve** : nouveau projet 1920×1080 à ${t.fps} i/s → Fichier > Importer > Timeline > \`${fcp ? f.fcpxml : rxml ? f.resolve : f.otio}\` → cocher **« Use sizing information »** (sinon zooms et positions sont perdus)${edl ? ` → puis Media Pool > Timelines > Import > Timeline Markers from EDL > \`${f.edl}\`` : ""}. Resolve gratuit sous Linux ne lit pas le H.264/AAC : transcodez \`media/*.mp4\`.`);
  if (pxml) p(`- **Premiere Pro** : Fichier > Importer > \`${f.premiere}\` (25.6.1 ou plus récent).`);
  if (otio) p(`- **Premiere Pro 25.6.1+ / Resolve 20** : \`${f.otio}\` (OpenTimelineIO).`);
  if (fcp) p(`- **Final Cut Pro** : Fichier > Importer > XML > \`${f.fcpxml}\`.`);
  p("- **Chemins** : " + (i.exportRoot ? `écrits pour la machine de montage sous \`${i.exportRoot}\`.` : "chemins absolus de cette machine ; réglez la « racine d'export » du projet pour une autre machine.") + " Les noms de `media/` sont uniques : la reconnexion par dossier retrouve tout.");
  p("- **Natif** : coupes, fondus centrés, zooms et recadrages en images clés, volumes, marqueurs. **Non portable** : marqueurs « … not portable » (voir le rendu de référence). Pistes A5–A8 : stems du mixage final, désactivées.");
  p(`- **Avant publication** : crédits (\`credits.md\`), case « contenu altéré ou synthétique » si voix ou images synthétiques, statuts juridiques vérifiés au ${i.asOf} à revérifier. Licence Remotion à la charge de l'utilisateur.`);
  p("");
  return L.join("\n");
}
