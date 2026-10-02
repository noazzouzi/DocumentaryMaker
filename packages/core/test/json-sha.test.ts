import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson, docHash, hashJson, isDocmakerError, omitVolatile, sha12, sha16, sha256Hex, sha8, stableStringify, VOLATILE_KEYS } from "../src/index";

const nodeSha = (d: string | Uint8Array) => createHash("sha256").update(d).digest("hex");

describe("canonicalJson / stableStringify", () => {
  it("sorts keys recursively in UTF-16 order, drops undefined, normalises -0", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: undefined }], c: -0 }, e: undefined })).toBe('{"a":{"c":0,"d":[3,{"z":1}]},"b":1}');
    expect(canonicalJson({ "10": 1, "2": 2, a: 3, B: 4 })).toBe('{"10":1,"2":2,"B":4,"a":3}');
    expect(canonicalJson([undefined, null])).toBe("[null,null]");
  });
  it("is stable across key insertion orders", () => {
    const a = { x: 1, y: [1, 2, { p: "é", q: true }] };
    const b = { y: [1, 2, { q: true, p: "é" }], x: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
  it("throws VALIDATION on non-finite numbers", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      try {
        canonicalJson({ a: [bad] });
        expect.unreachable();
      } catch (e) {
        expect(isDocmakerError(e) && e.code === "VALIDATION").toBe(true);
      }
    }
  });
  it("stableStringify matches JSON.stringify formatting with a trailing newline", () => {
    const v = { a: [1, { b: "x" }], c: {}, d: [] };
    expect(stableStringify(v)).toBe(JSON.stringify(v, null, 2) + "\n");
    expect(stableStringify(v, 0)).toBe(JSON.stringify(v) + "\n");
    expect(JSON.parse(stableStringify(v))).toEqual(v);
  });
});

describe("pure-JS SHA-256", () => {
  it("FIPS 180-4 vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    expect(sha256Hex("a".repeat(1_000_000))).toBe("cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
  });
  it("matches node:crypto on random inputs and block boundaries (property test)", () => {
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128, 129, 1000, 4096]) {
      const b = randomBytes(n);
      expect(sha256Hex(new Uint8Array(b))).toBe(nodeSha(b));
    }
    for (let i = 0; i < 200; i++) {
      const b = randomBytes(Math.floor(Math.random() * 600));
      expect(sha256Hex(new Uint8Array(b))).toBe(nodeSha(b));
    }
  });
  it("encodes strings as UTF-8", () => {
    for (const s of ["é", "« Bonjour »", "😀 €", "l’Écluse 1 637"]) expect(sha256Hex(s)).toBe(nodeSha(Buffer.from(s, "utf8")));
  });
  it("short hashes and hashJson", () => {
    expect(sha16("abc")).toBe(sha256Hex("abc").slice(0, 16));
    expect(sha12("abc")).toHaveLength(12);
    expect(sha8("abc")).toHaveLength(8);
    expect(hashJson({ b: 1, a: 2 })).toBe(nodeSha('{"a":2,"b":1}'));
  });
});

describe("docHash", () => {
  it("ignores VOLATILE_KEYS at any depth", () => {
    const a = { id: 1, updatedAt: "2026-01-01T00:00:00Z", nested: [{ createdAt: "x", v: 2, deep: { frozenAt: "y", w: 3 } }] };
    const b = { id: 1, updatedAt: "2027-01-01T00:00:00Z", nested: [{ createdAt: "z", v: 2, deep: { frozenAt: "q", w: 3 } }] };
    expect(docHash(a)).toBe(docHash(b));
    expect(docHash(a)).not.toBe(docHash({ ...b, id: 2 }));
    for (const k of VOLATILE_KEYS) expect(docHash({ x: 1, [k]: "a" })).toBe(docHash({ x: 1 }));
  });
  it("omitVolatile deep-copies without mutating", () => {
    const a = { updatedAt: "t", list: [{ setAt: "s", k: 1 }] };
    const o = omitVolatile(a);
    expect(o).toEqual({ list: [{ k: 1 }] });
    expect(a.list[0]!.setAt).toBe("s");
  });
});
