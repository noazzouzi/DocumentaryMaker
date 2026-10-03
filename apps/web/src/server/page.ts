// Server-component helpers: UI language resolution, engine access that degrades to an explicit placeholder state,
// and tolerant document reads.
import "server-only";
import { cookies, headers } from "next/headers";
import { isDocmakerError } from "@docmaker/core";
import type { Engine } from "@docmaker/engine";
import { getEngine } from "./runtime";
import { isNotImplemented } from "./http";
import { UI_LANG_COOKIE, fromAcceptLanguage, translator, type T, type UiLang } from "@/i18n";

export interface EngineFailure { message: string; code: string; notImplemented: boolean }
export type EngineResult = { ok: true; engine: Engine } | { ok: false; error: EngineFailure };

export function failureOf(e: unknown): EngineFailure {
  return {
    message: e instanceof Error ? e.message : String(e),
    code: isDocmakerError(e) ? e.code : "INTERNAL",
    notImplemented: isNotImplemented(e),
  };
}

export async function loadEngine(): Promise<EngineResult> {
  try {
    return { ok: true, engine: await getEngine() };
  } catch (e) {
    return { ok: false, error: failureOf(e) };
  }
}

/** Runs fn; any error becomes a failure value (pages render an explicit placeholder instead of crashing). */
export async function attempt<R>(fn: () => Promise<R>): Promise<{ ok: true; value: R } | { ok: false; error: EngineFailure }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: failureOf(e) };
  }
}

/** Reads a document or null when it does not exist yet (other errors propagate). */
export async function readDocOrNull<S extends Parameters<Engine["readDoc"]>[2]>(
  engine: Engine, slug: string, rel: string, schema: S,
): Promise<{ value: Awaited<ReturnType<Engine["readDoc"]>>["value"]; etag: string | null } | null> {
  try {
    return await engine.readDoc(slug, rel, schema);
  } catch (e) {
    if (isDocmakerError(e) && e.code === "UPSTREAM_MISSING") return null;
    if ((e as { code?: unknown })?.code === "ENOENT") return null;
    throw e;
  }
}

/** Cookie (toggle) → HomeConfig.uiLang (unless auto) → Accept-Language → en. */
export async function getUiLang(engine?: Engine | null): Promise<UiLang> {
  const c = (await cookies()).get(UI_LANG_COOKIE)?.value;
  if (c === "en" || c === "fr") return c;
  if (engine) {
    try {
      const h = await engine.homeConfig();
      if (h.uiLang === "en" || h.uiLang === "fr") return h.uiLang;
    } catch {
      /* engine not ready: fall through */
    }
  }
  return fromAcceptLanguage((await headers()).get("accept-language")) ?? "en";
}

export async function pageI18n(engine?: Engine | null): Promise<{ lang: UiLang; t: T }> {
  const lang = await getUiLang(engine);
  return { lang, t: translator(lang) };
}
