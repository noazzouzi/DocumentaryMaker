// STAGES registry (§5.1 table order = StageId order).
import type { StageId } from "@docmaker/core";
import type { StageDef } from "../types";
import { researchStage } from "./research";
import { styleStage } from "./style";
import { outlineStage } from "./outline";
import { scriptStage } from "./script";
import { beatsStage } from "./beats";
import { beatsliceStage } from "./beatslice";
import { factcheckStage } from "./factcheck";
import { assetsStage } from "./assets";
import { voiceStage } from "./voice";
import { layoutStage } from "./layout";
import { directStage } from "./direct";
import { mixStage } from "./mix";
import { renderStage } from "./render";
import { exportStage } from "./export";
import { qaStage } from "./qa";

export const STAGE_LIST: readonly StageDef[] = [
  researchStage, styleStage, outlineStage, scriptStage, beatsStage, beatsliceStage, factcheckStage, assetsStage, voiceStage,
  layoutStage, directStage, mixStage, renderStage, exportStage, qaStage,
];
const BY_ID = new Map<StageId, StageDef>(STAGE_LIST.map((s) => [s.id, s]));
export function stageDef(id: StageId): StageDef {
  const s = BY_ID.get(id);
  if (!s) throw new Error(`unknown stage ${id}`);
  return s;
}
export const STAGE_ORDER: readonly StageId[] = STAGE_LIST.map((s) => s.id);
export const stageIndex = (id: StageId): number => STAGE_ORDER.indexOf(id);
