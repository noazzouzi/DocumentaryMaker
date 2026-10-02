// `docmaker style new <id> --from <base>`: copy a style dir into the user styles dir with a new manifest id.
import { cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DocmakerError, StyleData, StyleManifest, stableStringify } from "@docmaker/core";
import { STYLE_FILES, loadStyleDir } from "./load";
import type { StyleRegistry } from "./types";

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** "true-crime-noir" → "True crime noir". */
export function humanizeStyleId(id: string): string {
  const s = id.replace(/-/g, " ").trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : s;
}

/**
 * Copies style `fromId` to `<destDir>/<newId>` (destDir = the user styles root, `HomePaths.styles`), rewrites
 * manifest.id and manifest.names (descriptions get a "based on" note), validates the copy and returns its absolute path.
 * Never overwrites: an existing target or an id already in the registry → DocmakerError("VALIDATION").
 */
export async function scaffoldStyle(o: { registry: StyleRegistry; fromId: string; newId: string; destDir: string }): Promise<string> {
  if (!ID_RE.test(o.newId) || o.newId.length > 64) {
    throw new DocmakerError("VALIDATION", `invalid style id "${o.newId}"`, { hint: "use lowercase letters, digits and single hyphens (e.g. \"my-drama\"); never a channel name" });
  }
  if (o.registry.has(o.newId)) {
    throw new DocmakerError("VALIDATION", `style "${o.newId}" already exists`, { hint: "choose another id" });
  }
  const base = o.registry.get(o.fromId); // unknown base → VALIDATION
  const root = resolve(o.destDir);
  const target = join(root, o.newId);
  if (await stat(target).then(() => true, () => false)) {
    throw new DocmakerError("VALIDATION", `${target} already exists`, { hint: "remove it or choose another id" });
  }
  await mkdir(root, { recursive: true });
  // copy into a hidden sibling first (discovery skips ".x" dirs), then rename: no half-written style is ever visible
  const tmp = join(root, `.${o.newId}.tmp-${process.pid}`);
  await rm(tmp, { recursive: true, force: true });
  try {
    await cp(base.dir, tmp, { recursive: true, errorOnExist: true, force: false });
    const raw = JSON.parse(await readFile(join(tmp, STYLE_FILES.data), "utf8")) as StyleData;
    const name = humanizeStyleId(o.newId);
    const manifest: StyleManifest = {
      ...raw.manifest,
      id: o.newId,
      names: { en: name, fr: name },
      description: {
        en: `${raw.manifest.description.en} (Based on ${base.data.manifest.names.en}.)`,
        fr: `${raw.manifest.description.fr} (D'après ${base.data.manifest.names.fr}.)`,
      },
    };
    const data = StyleData.parse({ ...raw, manifest });
    await writeFile(join(tmp, STYLE_FILES.data), stableStringify(data), "utf8");
    await loadStyleDir(tmp, "user"); // validate before it becomes visible (throws VALIDATION on any error)
    await rename(tmp, target);
  } catch (e) {
    await rm(tmp, { recursive: true, force: true });
    throw e;
  }
  return target;
}
