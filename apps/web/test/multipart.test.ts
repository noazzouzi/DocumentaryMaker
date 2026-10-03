import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { boundaryOf, parseDisposition, parseMultipart, safeUploadName } from "../src/server/multipart";

const B = "XyZ--boundary--123";
const enc = new TextEncoder();
function body(parts: { name: string; filename?: string; data: Uint8Array | string }[], o: { preamble?: string; epilogue?: string } = {}): Uint8Array {
  let s = o.preamble ?? "";
  const out: Uint8Array[] = [];
  for (const p of parts) {
    s += `--${B}\r\nContent-Disposition: form-data; name="${p.name}"${p.filename !== undefined ? `; filename="${p.filename}"` : ""}\r\n\r\n`;
    out.push(enc.encode(s));
    out.push(typeof p.data === "string" ? enc.encode(p.data) : p.data);
    s = "\r\n";
  }
  out.push(enc.encode(`${s}--${B}--\r\n${o.epilogue ?? ""}`));
  const total = out.reduce((n, c) => n + c.length, 0);
  const b = new Uint8Array(total);
  let off = 0;
  for (const c of out) {
    b.set(c, off);
    off += c.length;
  }
  return b;
}
function stream(b: Uint8Array, chunk: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i >= b.length) return c.close();
      c.enqueue(b.slice(i, i + chunk));
      i += chunk;
    },
  });
}
const ct = `multipart/form-data; boundary="${B}"`;

describe("multipart parser", () => {
  // binary payload that contains CRLF, dashes and a near-boundary sequence
  const payload = enc.encode(`\r\n--${B.slice(0, -1)}x\r\n--\r\n` + "z".repeat(3000) + `\r\n-${B}`);

  for (const chunk of [1, 3, 7, 64, 100_000]) {
    it(`parses fields and files whatever the chunking (${chunk} B)`, async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "mp-"));
      const r = await parseMultipart(stream(body([{ name: "declaration", data: '{"a":1}' }, { name: "file", filename: "clip.mp4", data: payload }], { preamble: "ignored preamble\r\n", epilogue: "trailing junk" }), chunk), ct, { dir, maxFileBytes: 1e6 });
      expect(r.fields).toEqual({ declaration: '{"a":1}' });
      expect(r.files).toHaveLength(1);
      expect(r.files[0]!.bytes).toBe(payload.length);
      expect(new Uint8Array(await readFile(r.files[0]!.path))).toEqual(payload);
    });
  }

  it("enforces the file size cap and cleans up", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mp-"));
    await expect(parseMultipart(stream(body([{ name: "file", filename: "a.wav", data: new Uint8Array(5000) }]), 512), ct, { dir, maxFileBytes: 4000 })).rejects.toMatchObject({ status: 413 });
    expect(await readdir(dir)).toEqual([]);
  });

  it("rejects truncated bodies, extra files and non-multipart types", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mp-"));
    const full = body([{ name: "file", filename: "a.wav", data: "abc" }]);
    await expect(parseMultipart(stream(full.slice(0, full.length - 10), 5), ct, { dir, maxFileBytes: 1e6 })).rejects.toMatchObject({ status: 400 });
    await expect(parseMultipart(stream(body([{ name: "f1", filename: "a.wav", data: "1" }, { name: "f2", filename: "b.wav", data: "2" }]), 5), ct, { dir, maxFileBytes: 1e6 })).rejects.toMatchObject({ status: 400 });
    expect(await readdir(dir)).toEqual([]);
    expect(() => boundaryOf("application/json")).toThrow();
    expect(boundaryOf("multipart/form-data; charset=utf-8; boundary=abc")).toBe("abc");
  });

  it("parses Content-Disposition (quoted, escaped, RFC 5987)", () => {
    expect(parseDisposition('form-data; name="file"; filename="a \\"b\\".png"')).toEqual({ name: "file", filename: 'a "b".png' });
    expect(parseDisposition("form-data; name=file; filename*=UTF-8''%C3%A9t%C3%A9.jpg")).toEqual({ name: "file", filename: "été.jpg" });
    expect(parseDisposition('form-data; name="declaration"')).toEqual({ name: "declaration", filename: null });
  });

  it("sanitizes upload names", () => {
    const n = safeUploadName("../../etc/pass wd.JPEG");
    expect(n.ext).toBe("jpeg");
    expect(n.name).toMatch(/^[a-z0-9]+-[a-f0-9]{8}-pass_wd\.jpeg$/);
    expect(safeUploadName("").name).toMatch(/-file$/);
  });
});
