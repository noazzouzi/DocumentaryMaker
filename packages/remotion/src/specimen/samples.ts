// Sample overlay items for StyleSpecimen (one per component, representative props) — also handy for previews/tests.
import { COMPONENT_META, OverlayComponentId, type OverlayItem } from "@docmaker/core";
import type { StyleRenderTokens } from "@docmaker/core";

const anchor = (offset: number) => ({ ref: "program" as const, edge: "start" as const, offset });

export function sampleProps(id: OverlayComponentId, tokens: StyleRenderTokens, lang: "en" | "fr" = "en"): Record<string, unknown> {
  const pal = tokens.tokens.palette;
  const fr = lang === "fr";
  switch (id) {
    case "LowerThird": return { name: "Semper Augustus", role: fr ? "Tulipe la plus chère de 1637" : "The most expensive tulip of 1637", align: "left" };
    case "ChapterCard": return { index: 2, total: 5, title: fr ? "La bulle éclate" : "The bubble bursts", kicker: fr ? "CHAPITRE 2" : "CHAPTER 2", letterbox: true, backdrop: "gradientGrid" };
    case "TitleSting": return { title: fr ? "La folie des tulipes" : "Tulip Mania", kicker: fr ? "CHAPITRE 1 · L'ENVOL" : "CHAPTER 1 · THE RISE", mode: "slam", backdrop: "darkNoise" };
    case "QuoteCard": return { text: fr ? "Personne ne voulait acheter, même à moitié prix." : "Nobody wanted to buy, not even at half the price.", speaker: "Pieter Cos", sourceLabel: "Haarlem, 1637", portraitAssetId: null, translated: fr, words: [] };
    case "SocialPost": return { variant: "post", displayName: "Bulb Trader", handle: "@haarlem1637", body: fr ? "Les prix ne peuvent que monter." : "Prices can only go up from here.", timestampLabel: "Feb 3, 1637", likes: 12400, reposts: 3100, replies: 880, avatarAssetId: null, imageAssetId: null, verified: false, theme: "dark", revealAt: 10 };
    case "ArticleHighlight": return { outlet: "Haarlem Courant", headline: fr ? "Effondrement du marché des bulbes" : "Bulb market collapses overnight", dateLabel: "Feb 5, 1637", paragraphs: [fr ? "Les acheteurs ont disparu lors de la vente aux enchères de mardi." : "Buyers vanished at Tuesday's auction, leaving sellers with contracts nobody would honour."], highlight: { paragraph: 0, start: 0, end: 18 }, highlightAt: 12, screenshotAssetId: null };
    case "DocumentCard": return { docType: "contract", title: fr ? "Contrat de vente de bulbes" : "Bulb sale contract", lines: ["Sold: one Semper Augustus", "Price: 5,500 guilders", "Delivery: June 1637"], redactions: [{ line: 1, start: 7, end: 12 }], stamp: "VOID", sourceLabel: "Source: Rijksmuseum", stampAt: 20, redactAt: 10 };
    case "HeadlineStack": return { items: [{ outlet: "Courant", headline: "Prices double again", dateLabel: "Jan 1637", at: 0, tiltDeg: -2 }, { outlet: "Gazette", headline: "Auction halted in Haarlem", dateLabel: "Feb 1637", at: 12, tiltDeg: 1.5 }, { outlet: "Courant", headline: "Courts refuse to enforce contracts", dateLabel: "Apr 1637", at: 24, tiltDeg: -1 }] };
    case "Stamp": return { text: fr ? "FAILLITE" : "BANKRUPT", color: pal.danger, rotationDeg: -8, x: 0.5, y: 0.5, scale: 1 };
    case "KeywordSlam": return { text: fr ? "EFFONDRÉ" : "COLLAPSED", color: pal.danger, background: "black" };
    case "NumberCounter": return { value: 5500, from: 0, format: "currency", currency: "NLG", decimals: 0, label: fr ? "pour un seul bulbe" : "for a single bulb", locale: fr ? "fr-FR" : "en-US", color: pal.money };
    case "DateStamp": return { text: fr ? "Février 1637" : "February 1637", zone: "topLeft" };
    case "MapPin": return { places: [{ label: "Haarlem", lon: 4.6462, lat: 52.3874, at: 0 }, { label: "Leiden", lon: 4.497, lat: 52.1601, at: 20 }, { label: "Amsterdam", lon: 4.9041, lat: 52.3676, at: 32 }], route: true, region: "europe", look: "paper" };
    case "TimelineGraphic": return { events: [{ dateLabel: "1634", label: fr ? "Les prix montent" : "Prices climb", at: 0 }, { dateLabel: "1636", label: fr ? "La frénésie" : "The frenzy", at: 12 }, { dateLabel: "Feb 1637", label: fr ? "Le krach" : "The crash", at: 24 }], activeIndex: 2 };
    case "BarChart": return { title: fr ? "Prix d'un bulbe (florins)" : "Price of one bulb (guilders)", unit: "ƒ", sourceLabel: "Source: Goldgar 2007", bars: [{ label: "1634", value: 300, highlight: false }, { label: "1636", value: 2000, highlight: false }, { label: "1637", value: 5500, highlight: true }] };
    case "SplitScreen": return { left: { assetId: null, label: fr ? "AVANT" : "BEFORE" }, right: { assetId: null, label: fr ? "APRÈS" : "AFTER" }, dividerColor: pal.accent };
    case "CensorBar": return { rect: { x: 0.35, y: 0.3, w: 0.3, h: 0.12 }, mode: "bar", label: fr ? "CENSURÉ" : "REDACTED" };
    case "Spotlight": return { cx: 0.5, cy: 0.45, rx: 0.18, ry: 0.22, dim: 0.6, drawCircle: true, color: pal.danger };
    case "KineticText": return { lines: fr ? ["LES PRIX DOUBLENT", "PUIS DOUBLENT ENCORE"] : ["PRICES DOUBLED", "THEN DOUBLED AGAIN"], emphasis: fr ? ["DOUBLENT"] : ["DOUBLED"], align: "center" };
    case "SourceLabel": return { text: "Rijksmuseum, 1640", kind: "source", zone: "topRight" };
    case "Letterbox": return { ratio: 2.39 };
    case "FreezeLabel": return { assetId: "0".repeat(64), sourceFrame: 0, name: "Pieter Cos", role: fr ? "Marchand de bulbes" : "Bulb merchant", desaturate: 0.8, darken: 0.25 };
    case "PhotoBurst": return { items: [0, 1, 2].map((i) => ({ assetId: "0".repeat(64), at: i * 8, tiltDeg: i % 2 ? 3 : -3, x: 0.3 + 0.2 * i, y: 0.5 })), scaleFrom: 1, scaleTo: 1.1, caption: "Haarlem, 1637" };
    case "EvidenceBoard": return { items: [{ assetId: null, label: "Haarlem", x: 900, y: 700, w: 520, rotDeg: -3, at: 0 }, { assetId: null, label: "Amsterdam", x: 2300, y: 900, w: 520, rotDeg: 2, at: 10 }, { assetId: null, label: "Leiden", x: 1500, y: 1500, w: 520, rotDeg: -1, at: 20 }], moves: [{ at: 0, focus: -1, frames: 20 }], links: [[0, 1], [1, 2]], backdrop: "cork" };
    case "CommentPile": return { items: [0, 1, 2, 3].map((i) => ({ displayName: `user${i + 1}`, handle: `@user${i + 1}`, body: [fr ? "C'est de la folie." : "This is insane.", fr ? "J'ai tout perdu." : "I lost everything.", fr ? "Qui achète encore ?" : "Who is still buying?", fr ? "Je l'avais dit." : "Called it."][i]!, at: i * 6, x: 0.25 + 0.17 * i, y: 0.3 + 0.12 * (i % 2), rotDeg: i % 2 ? 3 : -3 })), dim: 0.5, theme: "light" };
  }
}

/** A complete sample overlay item for `id` lasting `dur` frames at program frame 0. */
export function sampleItem(id: OverlayComponentId, tokens: StyleRenderTokens, fps: number, lang: "en" | "fr" = "en", dur?: number): OverlayItem {
  const m = COMPONENT_META[id];
  const d = dur ?? Math.max(Math.round((m.minHold30 * fps) / 30), 30);
  return {
    id: `ov:specimen:${id}:0`, start: anchor(0), end: anchor(d), from: 0, dur: d, beatId: null, band: m.band, z: 100, zone: m.defaultZone,
    enterFrames: Math.round((m.enter30 * fps) / 30), exitFrames: Math.round((m.exit30 * fps) / 30), followsCamera: m.followsCamera,
    component: id, props: sampleProps(id, tokens, lang),
  } as OverlayItem;
}

export const SPECIMEN_IDS: readonly OverlayComponentId[] = OverlayComponentId.options;
