"use client";
// Remotion Player integration (SPEC §14.4 / §10.13). computeTimeline gives duration/fps (calculateMetadata does not run
// in <Player>); acknowledgeRemotionLicense is passed only once the user chose a licence status, otherwise the licence
// card replaces the Player. Frame updates are throttled to 10 Hz and pushed out without re-rendering the Player.
import { Player, type PlayerRef } from "@remotion/player";
import { memo, useEffect, useMemo } from "react";
import { Documentary, type DocProps } from "@docmaker/remotion";
import { computeTimeline } from "@docmaker/remotion/compute";
import type { Timeline } from "@docmaker/core";
import { throttle } from "@/lib/frames";
import { RemotionLicenseCard } from "./RemotionLicenseCard";

export interface PreviewPlayerProps {
  slug: string;
  timeline: Timeline;
  range: [number, number] | null;
  licenseAcknowledged: boolean;
  onFrame: (f: number) => void;
  playerRef: React.RefObject<PlayerRef | null>;
}

// DocProps is an interface (no index signature): the Player's generic wants Record<string, unknown>
const DocumentaryLoose = Documentary as unknown as React.ComponentType<Record<string, unknown>>;

function PreviewPlayerImpl(p: PreviewPlayerProps) {
  const ct = useMemo(() => computeTimeline(p.timeline), [p.timeline]);
  const inputProps = useMemo<DocProps>(
    () => ({
      timeline: p.timeline, timelineUrl: null, assetBaseUrl: `/api/projects/${p.slug}/media`, mode: "preview",
      layers: { picture: true, graphics: true, captions: true, hud: true, covers: true, audio: true }, itemId: null,
      scratchBanner: p.timeline.takeKind === "scratch",
    }),
    [p.timeline, p.slug],
  );
  const { onFrame, playerRef, licenseAcknowledged } = p;
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !licenseAcknowledged) return;
    const emit = throttle((f: number) => onFrame(f), 100);
    const h = (e: { detail: { frame: number } }) => emit(e.detail.frame);
    player.addEventListener("frameupdate", h);
    const s = (e: { detail: { frame: number } }) => onFrame(e.detail.frame);
    player.addEventListener("seeked", s);
    return () => {
      player.removeEventListener("frameupdate", h);
      player.removeEventListener("seeked", s);
    };
  }, [onFrame, playerRef, licenseAcknowledged]);
  if (!p.licenseAcknowledged) return <RemotionLicenseCard />; // §17.4 — never acknowledge on the user's behalf
  const lastFrame = ct.durationInFrames - 1;
  const inF = p.range ? Math.max(0, Math.min(lastFrame, p.range[0])) : null;
  const outF = p.range ? Math.max(inF ?? 0, Math.min(lastFrame, p.range[1])) : null;
  return (
    <Player
      ref={p.playerRef}
      component={DocumentaryLoose}
      inputProps={inputProps as unknown as Record<string, unknown>}
      durationInFrames={ct.durationInFrames}
      fps={ct.fps}
      compositionWidth={1920}
      compositionHeight={1080}
      controls
      acknowledgeRemotionLicense
      inFrame={inF}
      outFrame={outF}
      style={{ width: "100%", aspectRatio: "16/9" }}
    />
  );
}

/** Memoised: parents re-rendering on frame updates must never re-render the Player. */
export const PreviewPlayer = memo(PreviewPlayerImpl);
