// Shared route context: params → validated slug + engine.
import "server-only";
import type { Engine } from "@docmaker/engine";
import { getEngine } from "./runtime";
import { slugParam } from "./http";

export type SlugCtx = { params: Promise<{ slug: string }> };
export type SlugRestCtx<K extends string> = { params: Promise<{ slug: string } & Record<K, string[]>> };

export async function projectCtx(params: Promise<{ slug: string }>): Promise<{ engine: Engine; slug: string }> {
  const { slug } = await params;
  const s = slugParam(slug);
  return { engine: await getEngine(), slug: s };
}

