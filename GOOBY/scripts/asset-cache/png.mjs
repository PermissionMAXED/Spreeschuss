import { deflateSync } from "node:zlib";
import { crc32 } from "./ziputil.mjs";

/** Encodes an RGBA8 pixel buffer as a PNG (dependency-free). */
export function encodePng(width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error("encodePng: pixel buffer size mismatch");
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    raw[y * (1 + width * 4)] = 0;
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunk = (type, body) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(body.length, 0);
    header.write(type, 4, "ascii");
    const crcBuffer = Buffer.alloc(4);
    crcBuffer.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), body])), 0);
    return Buffer.concat([header, body, crcBuffer]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Reads PNG or JPEG pixel dimensions from the header bytes. */
export function imageDimensions(bytes) {
  if (bytes.length > 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let cursor = 2;
    while (cursor + 9 < bytes.length) {
      if (bytes[cursor] !== 0xff) return null;
      const marker = bytes[cursor + 1];
      const length = bytes.readUInt16BE(cursor + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: bytes.readUInt16BE(cursor + 5), width: bytes.readUInt16BE(cursor + 7) };
      }
      cursor += 2 + length;
    }
  }
  return null;
}
