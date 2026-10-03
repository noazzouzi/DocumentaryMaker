// Provider registry (§7.2), default priority order.
import { DocmakerError } from "@docmaker/core";
import type { AssetProvider, AssetProviderId } from "@docmaker/core";
import { internetArchiveProvider, locProvider, nasaProvider } from "./archives";
import { createLocalProvider } from "./local";
import { openverseProvider } from "./openverse";
import { braveProvider, falProvider } from "./paid";
import { createProceduralProvider } from "./procedural";
import { pexelsProvider, pixabayProvider } from "./stock";
import { wikimediaProvider } from "./wikimedia";
import { youtubeProvider } from "./youtube";

/** The 12 providers in default priority order (local and procedural are default instances: empty index, default palette). */
export function allProviders(): AssetProvider[] {
  return [
    createLocalProvider(null), wikimediaProvider, openverseProvider, internetArchiveProvider, nasaProvider, locProvider,
    pexelsProvider, pixabayProvider, youtubeProvider, braveProvider, falProvider, createProceduralProvider(),
  ];
}

export function providerById(id: AssetProviderId): AssetProvider {
  const p = allProviders().find((x) => x.id === id);
  if (!p) throw new DocmakerError("VALIDATION", `unknown asset provider ${id}`);
  return p;
}

/** Providers usable offline (no network): local imports and procedural generation. */
export const OFFLINE_PROVIDERS: readonly AssetProviderId[] = ["local", "procedural"];
