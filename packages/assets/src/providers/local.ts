// Local provider: files imported with a mandatory UploadDeclaration (assets/local-index.json). Search = token match.
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { DocmakerError } from "@docmaker/core";
import type { AssetProvider, AssetQuery, Candidate, LocalIndexDoc } from "@docmaker/core";
import { sha256File } from "@docmaker/core/node";
import { declarationLicense } from "../license";
import { extOf, mimeOfExt, nowIso, queryTokens } from "../util";

type LocalFile = LocalIndexDoc["files"][number];

export function localCandidate(f: LocalFile): Candidate {
  const base = path.basename(f.path);
  return {
    provider: "local", providerAssetId: f.sha256, kind: f.kind, title: base.replace(/\.[^.]+$/, ""), description: f.declaration.note,
    tags: [...f.tags], previewUrl: "", downloadUrl: "", width: null, height: null, durationSec: null,
    license: declarationLicense(f.declaration), author: f.declaration.author ? { name: f.declaration.author, url: f.declaration.url || null } : null,
    sourcePageUrl: f.declaration.url, retrievedAt: nowIso(), youtube: null,
  };
}

/** Token overlap score of a query against an indexed file (0 = no match). */
export function localMatchScore(q: AssetQuery, f: LocalFile): number {
  const qt = queryTokens(`${q.text} ${q.localText ?? ""}`);
  if (qt.length === 0) return 0;
  const ft = new Set([...f.tokens, ...f.tags.flatMap((t) => queryTokens(t))]);
  return qt.filter((t) => ft.has(t)).length / qt.length;
}

export function createLocalProvider(index: LocalIndexDoc | null): AssetProvider & { index: LocalIndexDoc | null } {
  return {
    id: "local", kinds: ["image", "video", "audio"], needsKey: false, paid: false, costPerCallUsd: 0, limits: { concurrency: 4 }, index,
    isConfigured: () => (index?.files.length ?? 0) > 0,
    async search(q: AssetQuery) {
      if (!index) return [];
      return index.files
        .filter((f) => f.kind === q.kind)
        .map((f) => ({ f, s: localMatchScore(q, f) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || (a.f.sha256 < b.f.sha256 ? -1 : 1))
        .slice(0, q.limit)
        .map(({ f, s }) => ({ candidate: localCandidate(f), raw: { path: f.path, match: s } }));
    },
    async fetchOriginal(c: Candidate, destDir: string) {
      const f = index?.files.find((x) => x.sha256 === c.providerAssetId);
      if (!f) throw new DocmakerError("UPSTREAM_MISSING", `local file ${c.providerAssetId.slice(0, 12)} is not in the local index`);
      const sha = await sha256File(f.path).catch(() => null);
      if (sha !== f.sha256) throw new DocmakerError("UPSTREAM_MISSING", `${path.basename(f.path)} changed or vanished since import; re-run the import`);
      await mkdir(destDir, { recursive: true });
      const ext = extOf(f.path) || "bin";
      const dest = path.join(destDir, `local-${f.sha256.slice(0, 16)}.${ext}`);
      await copyFile(f.path, dest);
      return { path: dest, mime: mimeOfExt(ext) };
    },
  };
}
