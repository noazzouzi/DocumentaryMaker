// Assets frozen OUTSIDE the assets stage (scene-board freeze, uploads, manual clips) are recorded under
// <project>/assets/user-frozen/<assetId>.json so the next assets run can carry them into frozen.json (which only the stage writes).
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { FrozenAsset } from "@docmaker/core";
import { writeFileAtomic } from "./util";

export const USER_FROZEN_DIR = "assets/user-frozen";

export async function recordUserFrozen(projectDir: string, a: FrozenAsset): Promise<void> {
  await writeFileAtomic(path.join(projectDir, USER_FROZEN_DIR, `${a.id}.json`), JSON.stringify(a));
}

export async function readUserFrozen(projectDir: string): Promise<Record<string, FrozenAsset>> {
  const out: Record<string, FrozenAsset> = {};
  let files: string[] = [];
  try {
    files = await readdir(path.join(projectDir, USER_FROZEN_DIR));
  } catch {
    return out;
  }
  for (const f of files.filter((x) => /^[a-f0-9]{64}\.json$/.test(x)).sort()) {
    try {
      const a = FrozenAsset.safeParse(JSON.parse(await readFile(path.join(projectDir, USER_FROZEN_DIR, f), "utf8")));
      if (a.success) out[a.data.id] = a.data;
    } catch { /* skip unreadable records */ }
  }
  return out;
}
