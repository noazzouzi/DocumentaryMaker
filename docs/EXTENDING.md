# Extending DocumentaryMaker

Short guide for adding providers, styles and components. The normative rules live in `docs/ARCHITECTURE.md` (§4.11, §4.12, §7).

## Asset providers (`@docmaker/assets`)

1. Implement `AssetProvider` (`packages/core/src/interfaces.ts`): `id`, `kinds`, `needsKey`, `paid`, `costPerCallUsd`, `limits`, `isConfigured`, `search`, `fetchOriginal`.
2. All network I/O goes through the injected `HttpClient` (offline refusal, SSRF guard, per-host User-Agent, TTL cache). Never `fetch` directly.
3. Map the provider licence onto `LicenseInfo`; `validatePick` re-checks every pick server-side.
4. Adding a new `AssetProviderId` is a contract change (`docs/ISSUES.md`). Roadmap candidates (R20): Unsplash, Freesound, Flickr, Jamendo.
5. Record a real response under `packages/assets/test/data/` and unit-test the parser offline.

## Styles (`@docmaker/styles`)

A style is a **data-only directory**: `style.json` (`StyleData`), `STYLE.md`, `GUIDE.md`, `prompts.json` (`StylePrompts`), optional `fonts/` (M2). Built-ins live in `packages/styles/builtin/<id>/`; user styles in `<home>/styles/<id>/` are discovered at runtime (no rebuild). Start with `docmaker style new <id> --from drama-commentary`, then `docmaker style validate <id>`. Style ids are descriptive, never a channel name.

## Overlay components (`@docmaker/remotion`)

The vocabulary is closed (`OverlayComponentId`, `OVERLAY_PROPS`, `COMPONENT_META` in core). A new component id is a contract change. Implementations live in `packages/remotion/src/components/` and are registered in `registry.ts`; unimplemented ids render `FallbackCard`. Components are pure functions of `useCurrentFrame()` (`eslint.determinism.js`).

## Voices and aligners (`@docmaker/voice`)

Implement `TtsProvider` / `Aligner` (core interfaces). Voice licences must be expressed as `LicenseInfo` so they reach the credits.
