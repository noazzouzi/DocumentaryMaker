// packages/core/src/node/wav.ts — the ONE WAV implementation (voice, audio, assets, render use it). Planar float32 in memory.
import { open, readFile } from "node:fs/promises";
import { DocmakerError } from "../util/errors";
import { atomicWrite } from "./fsutil";

export interface WavData { sampleRate: number; channels: number; data: Float32Array[] } // planar, [-1, 1]
export type WavFormat = "s16" | "s24" | "f32";

interface Header { sampleRate: number; channels: number; bitsPerSample: number; format: "pcm" | "float"; frames: number; durationMs: number; dataOffset: number; dataBytes: number }

function parseHeader(buf: Buffer, fileSize: number, name: string): Header {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new DocmakerError("VALIDATION", `${name}: not a RIFF/WAVE file`);
  }
  let off = 12;
  let fmt: { tag: number; channels: number; sampleRate: number; bits: number } | null = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    let size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      let tag = buf.readUInt16LE(body);
      const channels = buf.readUInt16LE(body + 2);
      const sampleRate = buf.readUInt32LE(body + 4);
      const bits = buf.readUInt16LE(body + 14);
      if (tag === 0xfffe && size >= 40) tag = buf.readUInt16LE(body + 24); // WAVE_FORMAT_EXTENSIBLE → sub-format
      fmt = { tag, channels, sampleRate, bits };
    } else if (id === "data") {
      if (!fmt) throw new DocmakerError("VALIDATION", `${name}: data chunk before fmt chunk`);
      if (fmt.tag !== 1 && fmt.tag !== 3) throw new DocmakerError("VALIDATION", `${name}: unsupported WAV format tag ${fmt.tag}`);
      if (size === 0 || size === 0xffffffff || body + size > fileSize) size = fileSize - body; // streaming writers
      const bps = fmt.bits / 8;
      const frames = Math.floor(size / (bps * fmt.channels));
      return {
        sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bits, format: fmt.tag === 3 ? "float" : "pcm",
        frames, durationMs: Math.round((frames * 1000) / fmt.sampleRate), dataOffset: body, dataBytes: frames * bps * fmt.channels,
      };
    }
    off = body + size + (size % 2);
  }
  throw new DocmakerError("VALIDATION", `${name}: no data chunk`);
}

export async function readWavHeader(path: string): Promise<{ sampleRate: number; channels: number; bitsPerSample: number; format: "pcm" | "float"; frames: number; durationMs: number; dataOffset: number }> {
  const fh = await open(path, "r");
  try {
    const { size } = await fh.stat();
    const buf = Buffer.alloc(Math.min(size, 65536));
    await fh.read(buf, 0, buf.length, 0);
    const { dataBytes: _ignored, ...h } = parseHeader(buf, size, path);
    return h;
  } finally {
    await fh.close();
  }
}

/** Reads s16 / s24 / s32 / u8 PCM and f32 / f64 float WAVs into planar float32. */
export async function readWav(path: string): Promise<WavData> {
  const buf = await readFile(path);
  const h = parseHeader(buf, buf.length, path);
  const { channels: ch, frames } = h;
  const data = Array.from({ length: ch }, () => new Float32Array(frames));
  const bps = h.bitsPerSample / 8;
  let p = h.dataOffset;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      let v: number;
      if (h.format === "float") v = bps === 8 ? buf.readDoubleLE(p) : buf.readFloatLE(p);
      else if (bps === 2) v = buf.readInt16LE(p) / 32768;
      else if (bps === 3) v = buf.readIntLE(p, 3) / 8388608;
      else if (bps === 4) v = buf.readInt32LE(p) / 2147483648;
      else if (bps === 1) v = (buf[p]! - 128) / 128;
      else throw new DocmakerError("VALIDATION", `${path}: unsupported ${h.bitsPerSample}-bit PCM`);
      data[c]![i] = v;
      p += bps;
    }
  }
  return { sampleRate: h.sampleRate, channels: ch, data };
}

function headerFor(o: { sampleRate: number; channels: number; format: WavFormat }, frames: number): Buffer {
  const bps = o.format === "s16" ? 2 : o.format === "s24" ? 3 : 4;
  const isFloat = o.format === "f32";
  const dataBytes = frames * bps * o.channels;
  const fmtSize = isFloat ? 18 : 16;
  const factSize = isFloat ? 12 : 0;
  const headerBytes = 12 + 8 + fmtSize + factSize + 8;
  const b = Buffer.alloc(headerBytes);
  let p = 0;
  b.write("RIFF", p); p += 4;
  b.writeUInt32LE(Math.min(0xffffffff, headerBytes - 8 + dataBytes + (dataBytes % 2)), p); p += 4;
  b.write("WAVE", p); p += 4;
  b.write("fmt ", p); p += 4;
  b.writeUInt32LE(fmtSize, p); p += 4;
  b.writeUInt16LE(isFloat ? 3 : 1, p); p += 2;
  b.writeUInt16LE(o.channels, p); p += 2;
  b.writeUInt32LE(o.sampleRate, p); p += 4;
  b.writeUInt32LE(o.sampleRate * o.channels * bps, p); p += 4;
  b.writeUInt16LE(o.channels * bps, p); p += 2;
  b.writeUInt16LE(bps * 8, p); p += 2;
  if (isFloat) {
    b.writeUInt16LE(0, p); p += 2; // cbSize
    b.write("fact", p); p += 4;
    b.writeUInt32LE(4, p); p += 4;
    b.writeUInt32LE(frames >>> 0, p); p += 4;
  }
  b.write("data", p); p += 4;
  b.writeUInt32LE(Math.min(0xffffffff, dataBytes), p);
  return b;
}

function encodeBlock(block: Float32Array[], format: WavFormat): Buffer {
  const ch = block.length;
  const frames = ch === 0 ? 0 : block[0]!.length;
  for (const c of block) if (c.length !== frames) throw new DocmakerError("VALIDATION", "WAV block channels differ in length");
  const bps = format === "s16" ? 2 : format === "s24" ? 3 : 4;
  const out = Buffer.alloc(frames * ch * bps);
  let p = 0;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < ch; c++) {
      let v = block[c]![i]!;
      if (!Number.isFinite(v)) v = 0;
      if (format === "f32") {
        out.writeFloatLE(v, p);
      } else {
        // symmetric with the decoder (x / 2^(n-1)); +1.0 clips to the largest positive code
        if (format === "s16") out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32768))), p);
        else out.writeIntLE(Math.max(-8388608, Math.min(8388607, Math.round(v * 8388608))), p, 3);
      }
      p += bps;
    }
  }
  return out;
}

export async function writeWav(path: string, wav: WavData, format: WavFormat): Promise<void> {
  if (wav.data.length !== wav.channels) throw new DocmakerError("VALIDATION", "WavData.channels does not match data.length");
  const frames = wav.channels === 0 ? 0 : wav.data[0]!.length;
  const body = encodeBlock(wav.data, format);
  const pad = body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  await atomicWrite(path, Buffer.concat([headerFor({ sampleRate: wav.sampleRate, channels: wav.channels, format }, frames), body, pad]));
}

/** Streaming writer for long programs (mixer, VO program): append planar blocks, header patched on close. */
export async function createWavWriter(path: string, o: { sampleRate: number; channels: number; format: WavFormat }): Promise<{ write(block: Float32Array[]): Promise<void>; close(): Promise<void> }> {
  const fh = await open(path, "w");
  const headerLen = headerFor(o, 0).length;
  await fh.write(headerFor(o, 0), 0, headerLen, 0);
  let pos = headerLen;
  let frames = 0;
  let closed = false;
  return {
    async write(block) {
      if (closed) throw new DocmakerError("INTERNAL", "WAV writer already closed");
      if (block.length !== o.channels) throw new DocmakerError("VALIDATION", `expected ${o.channels} channels, got ${block.length}`);
      const b = encodeBlock(block, o.format);
      await fh.write(b, 0, b.length, pos);
      pos += b.length;
      frames += block[0]?.length ?? 0;
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        if ((pos - headerLen) % 2) await fh.write(Buffer.alloc(1), 0, 1, pos);
        const h = headerFor(o, frames);
        await fh.write(h, 0, h.length, 0);
      } finally {
        await fh.close();
      }
    },
  };
}
