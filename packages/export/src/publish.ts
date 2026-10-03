// publish.<lang>.md (§13.5, M2): title, thumbnail text, description, chapter timestamps from the chapter markers,
// credits block and a disclosure checklist. Unreviewed fallbacks (no Project.publish[lang]) are marked as such.
import type { Lang, PublishInfo, Timeline } from "@docmaker/core";

const T = {
  en: {
    kit: "Publish kit", title: "Title", thumb: "Thumbnail text", desc: "Description", chapters: "Chapters", credits: "Credits",
    checklist: "Disclosure checklist", unreviewed: "unreviewed — set it in the project's publish settings and re-export", intro: "Intro",
    chapterRules: "YouTube shows chapters only when the first starts at 00:00 and there are at least 3 chapters of at least 10 s each.",
    copy: "Copy the block below into the YouTube description.",
  },
  fr: {
    kit: "Kit de publication", title: "Titre", thumb: "Texte de la miniature", desc: "Description", chapters: "Chapitres", credits: "Crédits",
    checklist: "Liste de vérification (transparence)", unreviewed: "non relu — à définir dans les réglages de publication du projet, puis réexporter", intro: "Introduction",
    chapterRules: "YouTube n'affiche les chapitres que si le premier commence à 00:00 et s'il y en a au moins 3 d'au moins 10 s.",
    copy: "Copiez le bloc ci-dessous dans la description YouTube.",
  },
} as const;

/** "MM:SS" (or "H:MM:SS" past an hour), floored to the second, as YouTube expects. */
export function chapterStamp(frame: number, fps: number): string {
  const s = Math.max(0, Math.floor(frame / fps));
  const p2 = (n: number) => String(n).padStart(2, "0");
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}:${p2(s % 60)}` : `${p2(Math.floor(s / 60))}:${p2(s % 60)}`;
}

/** Chapter lines from the chapter markers (fallback: Timeline.chapters); the first line is always 00:00. */
export function chapterLines(t: Timeline, lang: Lang): { lines: string[]; youtubeOk: boolean } {
  const fromMarkers = t.markers.filter((m) => m.kind === "chapter").map((m) => ({ frame: m.frame, title: m.name }));
  const src = (fromMarkers.length ? fromMarkers : t.chapters.map((c) => ({ frame: c.from, title: c.title }))).sort((a, b) => a.frame - b.frame);
  const items: { frame: number; title: string }[] = [];
  for (const c of src) {
    const title = c.title.replace(/\s+/g, " ").trim() || "—";
    if (items.length && chapterStamp(items[items.length - 1]!.frame, t.fps) === chapterStamp(c.frame, t.fps)) continue; // same second
    items.push({ frame: c.frame, title });
  }
  if (!items.length || Math.floor(items[0]!.frame / t.fps) > 0) items.unshift({ frame: 0, title: T[lang].intro });
  const ends = items.map((c, i) => (items[i + 1]?.frame ?? t.durationInFrames) - c.frame);
  const youtubeOk = items.length >= 3 && ends.every((d) => d >= 10 * t.fps);
  return { lines: items.map((c) => `${chapterStamp(c.frame, t.fps)} ${c.title}`), youtubeOk };
}

const truncate = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export function writePublishKit(i: { t: Timeline; publish: PublishInfo | null; credits: string; lang: Lang }): string {
  const { t, publish, lang } = i;
  const L = T[lang];
  const ch = chapterLines(t, lang);
  const out: string[] = [];
  const mark = (reviewed: boolean) => (reviewed ? "" : ` _(${L.unreviewed})_`);

  const title = publish?.title?.trim() || truncate(t.title, 100);
  const thumb = publish?.thumbnailText?.trim() || truncate(t.title.split(/[:—–-]/)[0]!.trim().toUpperCase(), 40);
  const descDraft = publish?.description?.trim()
    || (lang === "fr"
      ? `${t.title}.\n\nDans cette vidéo : ${t.chapters.map((c) => c.title).join(", ")}.`
      : `${t.title}.\n\nIn this video: ${t.chapters.map((c) => c.title).join(", ")}.`);

  out.push(`# ${L.kit} — ${t.title} (${lang.toUpperCase()})`, "");
  out.push(`## ${L.title}${mark(Boolean(publish?.title?.trim()))}`, "", title, "");
  out.push(`## ${L.thumb}${mark(Boolean(publish?.thumbnailText?.trim()))}`, "", thumb, "");
  out.push(`## ${L.desc}${mark(Boolean(publish?.description?.trim()))}`, "", L.copy, "", "```text", descDraft, "", ...ch.lines, "```", "");
  out.push(`## ${L.chapters}`, "", ...ch.lines.map((l) => `- ${l}`), "");
  if (!ch.youtubeOk) out.push(`> ${L.chapterRules}`, "");
  out.push(`## ${L.credits}`, "", i.credits.trim() || "—", "");

  // disclosure checklist (the user ticks these in YouTube Studio)
  const sponsor = t.markers.some((m) => m.kind === "sponsor");
  const clips = t.audio.clip.length > 0 || t.video.some((c) => c.source.kind === "video" && t.assets[c.source.assetId]?.hasAudio);
  const box = (s: string) => `- [ ] ${s}`;
  out.push(`## ${L.checklist}`, "");
  if (lang === "fr") {
    out.push(
      box("« Contenu altéré ou synthétique » : à cocher si la voix est synthétique/clonée ou si des images générées par IA semblent réelles (voir le rapport éditorial)."),
      box(`Promotion payée : ${sponsor ? "**oui — un segment sponsor est marqué**" : "non (aucun marqueur sponsor)"}.`),
      box("Conçu pour les enfants : non."),
      box(clips ? "Extraits tiers : courts, commentés, transformatifs (usage loyal / fair use à vos risques) ; sources citées dans les crédits." : "Aucun extrait vidéo tiers avec son."),
      box("Crédits et licences collés dans la description."),
      box("Statuts juridiques (plaintes, procès, appels) revérifiés avant publication."),
    );
  } else {
    out.push(
      box('"Altered or synthetic content": tick it if the voice is synthetic/cloned or AI images look realistic (see the editorial report).'),
      box(`Paid promotion: ${sponsor ? "**yes — a sponsor segment is marked**" : "no (no sponsor marker)"}.`),
      box("Made for kids: no."),
      box(clips ? "Third-party clips: short, commented, transformative (fair use / fair dealing at your own risk); sources credited." : "No third-party video clips with sound."),
      box("Credits and licences pasted into the description."),
      box("Legal statuses (charges, lawsuits, appeals) rechecked before publishing."),
    );
  }
  if (t.takeKind === "scratch") out.push("", lang === "fr" ? "> Attention : cette timeline utilise une prise de voix provisoire (scratch)." : "> Warning: this timeline uses a scratch voice take, not the final one.");
  out.push("");
  return out.join("\n");
}
