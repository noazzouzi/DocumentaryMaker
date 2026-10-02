// Component registry (§4.12 layer 3): every OverlayComponentId → its React implementation, typed by OVERLAY_PROPS via
// OverlayOf<C>. Ids mapped to null are not implemented yet and render FallbackCard (so does any id unknown to this build).
import type React from "react";
import { OverlayComponentId, type OverlayItem } from "@docmaker/core";
import { ArticleHighlight } from "./ArticleHighlight";
import { BarChart } from "./BarChart";
import { CensorBar } from "./CensorBar";
import { ChapterCard } from "./ChapterCard";
import { CommentPile } from "./CommentPile";
import { DateStamp } from "./DateStamp";
import { DocumentCard } from "./DocumentCard";
import { EvidenceBoard } from "./EvidenceBoard";
import { FallbackCard } from "./FallbackCard";
import { FreezeLabel } from "./FreezeLabel";
import { HeadlineStack } from "./HeadlineStack";
import { KeywordSlam } from "./KeywordSlam";
import { KineticText } from "./KineticText";
import { Letterbox } from "./Letterbox";
import { LowerThird } from "./LowerThird";
import { MapPin } from "./MapPin";
import { NumberCounter } from "./NumberCounter";
import { PhotoBurst } from "./PhotoBurst";
import { QuoteCard } from "./QuoteCard";
import type { ComponentProps } from "./shared";
import { SocialPost } from "./SocialPost";
import { SourceLabel } from "./SourceLabel";
import { SplitScreen } from "./SplitScreen";
import { Spotlight } from "./Spotlight";
import { Stamp } from "./Stamp";
import { TimelineGraphic } from "./TimelineGraphic";
import { TitleSting } from "./TitleSting";

export type ComponentRegistry = { [C in OverlayComponentId]: React.FC<ComponentProps<C>> | null };

export const COMPONENT_REGISTRY: ComponentRegistry = {
  LowerThird, ChapterCard, TitleSting, QuoteCard, SocialPost, ArticleHighlight, DocumentCard, HeadlineStack, Stamp,
  KeywordSlam, NumberCounter, DateStamp, MapPin, TimelineGraphic, BarChart, SplitScreen, CensorBar, Spotlight,
  KineticText, SourceLabel, Letterbox, FreezeLabel, PhotoBurst, EvidenceBoard, CommentPile,
};

/** Ids with a real implementation (others render FallbackCard). */
export const IMPLEMENTED: ReadonlySet<OverlayComponentId> = new Set(OverlayComponentId.options.filter((id) => COMPONENT_REGISTRY[id] !== null));

/** The component that renders an item (FallbackCard for unimplemented ids). */
export function componentFor(item: OverlayItem): React.FC<{ item: OverlayItem }> {
  const C = COMPONENT_REGISTRY[item.component] as React.FC<{ item: OverlayItem }> | null | undefined;
  return C ?? FallbackCard;
}
