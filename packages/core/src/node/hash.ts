// packages/core/src/node/hash.ts — streaming file hashes (node:crypto is allowed only under src/node).
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

/** Streaming SHA-256 of a file; equals sha256Hex(bytes). */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("sha256");
    const s = createReadStream(path);
    s.on("error", reject);
    s.on("data", (c) => h.update(c));
    s.on("end", () => resolve(h.digest("hex")));
  });
}

/** In-memory SHA-256 via node:crypto (byte etags). */
export function sha256Bytes(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
