// Response store shared by the live clients: raw responses in rawDir/<fingerprint>.json, reused through receipts
// (a call already answered is never made twice).
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { z } from "zod";
import { stableStringify, type Logger } from "@docmaker/core";
import { sha256Bytes } from "@docmaker/core/node";
import type { LlmCallCtx, StructuredRequest } from "../types";

/** Request identity for receipts: images are replaced by the hash of their data. */
export function hashableUser(user: StructuredRequest<z.ZodType>["user"]): unknown {
  if (typeof user === "string") return user;
  return user.map((b) => {
    const src = (b as { type: string; source?: { type?: string; data?: string } }).source;
    if (b.type === "image" && src?.type === "base64" && typeof src.data === "string") return { ...b, source: { ...src, data: `sha256:${sha256Bytes(src.data)}` } };
    return b;
  });
}

/** The parsed output stored for this fingerprint when its receipt exists and it still matches the schema. */
export async function reuseParsed<S extends z.ZodType>(rawDir: string, fp: string, schema: S, h: LlmCallCtx, logger: Logger): Promise<z.infer<S> | undefined> {
  if (h.newRequest) return undefined;
  const r = await h.costs.findReceipt(fp);
  if (!r?.outputRef) return undefined;
  try {
    const stored = JSON.parse(await readFile(join(rawDir, `${fp}.json`), "utf8")) as { parsed?: unknown };
    const ok = schema.safeParse(stored.parsed);
    if (!ok.success) return undefined;
    h.onReceipt?.(r);
    logger.debug("llm: reused paid response", { fingerprint: fp });
    return ok.data;
  } catch {
    return undefined;
  }
}

/** Atomic write of rawDir/<fp>.json; returns the receipt's outputRef. */
export async function persistRaw(rawDir: string, fp: string, data: Record<string, unknown>): Promise<string> {
  await mkdir(rawDir, { recursive: true });
  const file = join(rawDir, `${fp}.json`);
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, stableStringify(data), "utf8");
  await rename(tmp, file);
  return `costs/llm/${fp}.json`;
}
