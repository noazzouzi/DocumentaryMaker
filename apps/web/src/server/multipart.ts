// Streaming multipart/form-data parser (uploads ≤ 2 GiB): file parts go straight to disk with backpressure, text fields
// are buffered with a small cap. No dependency; Request.formData() would buffer the whole body in memory.
import "server-only";
import { randomBytes } from "node:crypto";
import { open, rm, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { HttpError } from "./http";

export interface MultipartFile { field: string; filename: string; path: string; bytes: number; mime: string }
export interface MultipartResult { fields: Record<string, string>; files: MultipartFile[] }
export interface MultipartOptions {
  dir: string; // destination directory for file parts (must exist)
  maxFileBytes: number;
  maxFieldBytes?: number; // default 64 KiB per text field
  maxFiles?: number; // default 1
  maxFields?: number; // default 20
  allowedExt?: ReadonlySet<string> | null; // lower-case, without dot
}

const CRLF = Buffer.from("\r\n");
const HEADER_END = Buffer.from("\r\n\r\n");
const MAX_HEADER_BYTES = 16 * 1024;

export function boundaryOf(contentType: string | null): string {
  const m = contentType ? /^multipart\/form-data\s*;(.*)$/i.exec(contentType.trim()) : null;
  if (!m) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "expected multipart/form-data");
  const b = /(?:^|;)\s*boundary\s*=\s*(?:"([^"]{1,70})"|([^\s;]{1,70}))/i.exec(m[1]!);
  const boundary = b?.[1] ?? b?.[2];
  if (!boundary) throw new HttpError(400, "VALIDATION", "multipart boundary missing");
  return boundary;
}

/** Content-Disposition parameters (name, filename, filename* RFC 5987). */
export function parseDisposition(v: string): { name: string | null; filename: string | null } {
  const param = (key: string): string | null => {
    const re = new RegExp(`(?:^|;)\\s*${key}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|([^;]*))`, "i");
    const m = re.exec(v);
    if (!m) return null;
    return m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? "").trim();
  };
  const star = param("filename\\*");
  let filename = param("filename");
  if (star) {
    const m = /^([\w-]+)'[^']*'(.*)$/.exec(star);
    if (m) {
      try {
        filename = decodeURIComponent(m[2]!);
      } catch {
        /* keep the plain filename */
      }
    }
  }
  return { name: param("name"), filename };
}

/** Safe on-disk name: random prefix + sanitized basename (extension kept, lower-cased). */
export function safeUploadName(original: string): { name: string; ext: string } {
  const base = path.basename(original.replace(/\\/g, "/"));
  const ext = path.extname(base).slice(1).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  const stem = path.basename(base, path.extname(base)).normalize("NFKD").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "file";
  return { name: `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}-${stem}${ext ? "." + ext : ""}`, ext };
}

type State = "preamble" | "headers" | "body" | "afterDelimiter" | "done";

export async function parseMultipart(body: ReadableStream<Uint8Array> | null, contentType: string | null, o: MultipartOptions): Promise<MultipartResult> {
  const boundary = boundaryOf(contentType);
  if (!body) throw new HttpError(400, "VALIDATION", "empty body");
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  const maxField = o.maxFieldBytes ?? 64 * 1024;
  const maxFiles = o.maxFiles ?? 1;
  const maxFields = o.maxFields ?? 20;
  const result: MultipartResult = { fields: {}, files: [] };
  const written: string[] = [];
  // the first delimiter has no leading CRLF: prepend one so every delimiter has the same shape
  let buf: Buffer = Buffer.from(CRLF);
  let state: State = "preamble";
  type Part = { name: string; file: { fh: FileHandle; path: string; info: MultipartFile } | null; field: Buffer[]; fieldBytes: number };
  let part: Part | null = null;
  // closures assign `part`; read it through this helper so control-flow narrowing does not pin it to null
  const isFilePart = (): boolean => (part as Part | null)?.file != null;

  const writeFile = async (chunk: Buffer) => {
    if (!part?.file || chunk.length === 0) return;
    part.file.info.bytes += chunk.length;
    if (part.file.info.bytes > o.maxFileBytes) throw new HttpError(413, "PAYLOAD_TOO_LARGE", `file larger than ${o.maxFileBytes} bytes`);
    let off = 0;
    while (off < chunk.length) {
      const { bytesWritten } = await part.file.fh.write(chunk, off, chunk.length - off);
      off += bytesWritten;
    }
  };
  const appendField = (chunk: Buffer) => {
    if (!part || part.file || chunk.length === 0) return;
    part.fieldBytes += chunk.length;
    if (part.fieldBytes > maxField) throw new HttpError(413, "PAYLOAD_TOO_LARGE", `field ${part.name} too large`);
    part.field.push(chunk);
  };
  const finishPart = async () => {
    if (!part) return;
    if (part.file) {
      await part.file.fh.close();
      result.files.push(part.file.info);
    } else {
      result.fields[part.name] = Buffer.concat(part.field).toString("utf8");
    }
    part = null;
  };
  const startPart = async (headerText: string) => {
    const headers = new Map<string, string>();
    for (const line of headerText.split("\r\n")) {
      const i = line.indexOf(":");
      if (i > 0) headers.set(line.slice(0, i).trim().toLowerCase(), line.slice(i + 1).trim());
    }
    const disp = parseDisposition(headers.get("content-disposition") ?? "");
    if (!disp.name) throw new HttpError(400, "VALIDATION", "multipart part without a name");
    if (disp.filename !== null) {
      if (result.files.length >= maxFiles) throw new HttpError(400, "VALIDATION", `at most ${maxFiles} file(s) per upload`);
      const { name, ext } = safeUploadName(disp.filename || "upload");
      if (o.allowedExt && !o.allowedExt.has(ext)) throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", `file type .${ext || "?"} not accepted`);
      const p = path.join(o.dir, name);
      const fh = await open(p, "wx", 0o600);
      written.push(p);
      part = { name: disp.name, file: { fh, path: p, info: { field: disp.name, filename: disp.filename, path: p, bytes: 0, mime: headers.get("content-type") ?? "application/octet-stream" } }, field: [], fieldBytes: 0 };
    } else {
      if (Object.keys(result.fields).length >= maxFields) throw new HttpError(400, "VALIDATION", "too many fields");
      part = { name: disp.name, file: null, field: [], fieldBytes: 0 };
    }
  };

  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value && value.length) buf = buf.length ? Buffer.concat([buf, Buffer.from(value.buffer, value.byteOffset, value.byteLength)]) : Buffer.from(value);
      // drain as much as possible
      for (;;) {
        if (state === "preamble") {
          const i = buf.indexOf(delimiter);
          if (i < 0) {
            if (buf.length > MAX_HEADER_BYTES) buf = buf.subarray(buf.length - delimiter.length);
            break;
          }
          buf = buf.subarray(i + delimiter.length);
          state = "afterDelimiter";
        } else if (state === "afterDelimiter") {
          // transport padding (spaces/tabs) is allowed before CRLF; "--" closes the body
          let j = 0;
          while (j < buf.length && (buf[j] === 0x20 || buf[j] === 0x09)) j++;
          if (buf.length - j < 2) break;
          if (buf[j] === 0x2d && buf[j + 1] === 0x2d) {
            state = "done";
            buf = Buffer.alloc(0);
            break;
          }
          if (buf[j] !== 0x0d || buf[j + 1] !== 0x0a) throw new HttpError(400, "VALIDATION", "malformed multipart delimiter");
          buf = buf.subarray(j + 2);
          state = "headers";
        } else if (state === "headers") {
          const i = buf.indexOf(HEADER_END);
          if (i < 0) {
            if (buf.length > MAX_HEADER_BYTES) throw new HttpError(400, "VALIDATION", "multipart headers too large");
            break;
          }
          await startPart(buf.subarray(0, i).toString("utf8"));
          buf = buf.subarray(i + HEADER_END.length);
          state = "body";
        } else if (state === "body") {
          const i = buf.indexOf(delimiter);
          if (i >= 0) {
            const chunk = buf.subarray(0, i);
            if (isFilePart()) await writeFile(chunk);
            else appendField(chunk);
            await finishPart();
            buf = buf.subarray(i + delimiter.length);
            state = "afterDelimiter";
          } else {
            // keep a tail that could be the start of a split delimiter
            const keep = Math.min(buf.length, delimiter.length - 1);
            const chunk = buf.subarray(0, buf.length - keep);
            if (isFilePart()) await writeFile(chunk);
            else appendField(chunk);
            buf = Buffer.from(buf.subarray(buf.length - keep));
            break;
          }
        } else break;
      }
      if (state === "done") {
        await reader.cancel().catch(() => {});
        break;
      }
      if (done) throw new HttpError(400, "VALIDATION", "truncated multipart body");
    }
    return result;
  } catch (e) {
    const p = part as Part | null;
    if (p?.file) await p.file.fh.close().catch(() => {});
    await Promise.all(written.map((f) => rm(f, { force: true })));
    await reader.cancel().catch(() => {});
    throw e;
  }
}
