// Component registry (§4.12 layer 3): every OverlayComponentId → its React implementation, typed by OVERLAY_PROPS via
// OverlayOf<C>. Ids mapped to null are not implemented yet and render FallbackCard.
import type React from "react";
import { OverlayComponentId, type OverlayItem } from "@docmaker/core";
import { ChapterCard } from "./ChapterCard";
import { DateStamp } from "./DateStamp";
import { DocumentCard } from "./DocumentCard";
import { FallbackCard } from "./FallbackCard";
import { KeywordSlam } from "./KeywordSlam";
import { KineticText } from "./KineticText";
import { LowerThird } from "./LowerThird";
import { MapPin } from "./MapPin";
import { NumberCounter } from "./NumberCounter";
import type { ComponentProps } from "./shared";
import { SourceLabel } from "./SourceLabel";
import { Stamp } from "./Stamp";
import { TitleSting } from "./TitleSting";

export type ComponentRegistry = { [C in OverlayComponentId]: React.FC<ComponentProps<C>> | null };

export const COMPONENT_REGISTRY: ComponentRegistry = {
  LowerThird, ChapterCard, TitleSting, QuoteCard: null, SocialPost: null, ArticleHighlight: null, DocumentCard,
  HeadlineStack: null, Stamp, KeywordSlam, NumberCounter, DateStamp, MapPin, TimelineGraphic: null, BarChart: null,
  SplitScreen: null, CensorBar: null, Spotlight: null, KineticText, SourceLabel, Letterbox: null, FreezeLabel: null,
  PhotoBurst: null, EvidenceBoard: null, CommentPile: null,
};

/** Ids with a real implementation (others render FallbackCard). */
export const IMPLEMENTED: ReadonlySet<OverlayComponentId> = new Set(OverlayComponentId.options.filter((id) => COMPONENT_REGISTRY[id] !== null));

/** The component that renders an item (FallbackCard for unimplemented ids). */
export function componentFor(item: OverlayItem): React.FC<{ item: OverlayItem }> {
  const C = COMPONENT_REGISTRY[item.component] as React.FC<{ item: OverlayItem }> | null | undefined;
  return C ?? FallbackCard;
}
