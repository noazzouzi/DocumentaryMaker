// One overlay item in its own Sequence (premounted 1 s), behind a per-item error boundary: a broken item logs and
// renders nothing instead of failing the whole render (unimplemented ids already render FallbackCard).
import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import type { OverlayItem } from "@docmaker/core";
import { componentFor } from "../components/registry";

class ItemBoundary extends React.Component<{ id: string; children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: unknown): void {
    console.error(`[docmaker] overlay ${this.props.id} failed to render: ${error instanceof Error ? error.message : String(error)}`);
  }
  override render(): React.ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

export const OverlayItemView: React.FC<{ item: OverlayItem; premount: number; wrapStyle?: React.CSSProperties; from?: number }> = ({ item, premount, wrapStyle, from }) => {
  const C = componentFor(item);
  return (
    <Sequence from={from ?? item.from} durationInFrames={Math.max(1, item.dur)} premountFor={premount} name={item.id}>
      <ItemBoundary id={item.id}>
        <AbsoluteFill style={wrapStyle}>
          <C item={item} />
        </AbsoluteFill>
      </ItemBoundary>
    </Sequence>
  );
};
