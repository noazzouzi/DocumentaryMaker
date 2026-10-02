// Letterbox (M2, HUD band): cinematic bars for the ratio (2.39 → ≈ 138 px each), 20 f in and out.
import type React from "react";
import { LetterboxBars } from "../looks/Letterbox";
import { useItemClock, type ComponentProps } from "./shared";

export const Letterbox: React.FC<ComponentProps<"Letterbox">> = ({ item }) => {
  const c = useItemClock(item);
  return <LetterboxBars ratio={item.props.ratio} progress={c.inP * (1 - c.outP)} />;
};
