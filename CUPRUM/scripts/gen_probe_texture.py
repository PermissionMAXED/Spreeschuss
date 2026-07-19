#!/usr/bin/env python3
"""Deterministically generates the 16x16 charge_probe block texture.

The mod ships no hand-drawn binary assets; this script (stdlib only) produced the
committed PNG. Re-running it always yields byte-identical output.

Usage: python3 scripts/gen_probe_texture.py
"""
import struct
import zlib
from pathlib import Path

SIZE = 16

# Palette (RGBA)
COPPER_DARK = (140, 74, 44, 255)
COPPER = (183, 104, 60, 255)
COPPER_LIGHT = (216, 141, 88, 255)
PATINA = (73, 156, 130, 255)
GLOW = (255, 226, 120, 255)

# Lightning-bolt glyph coordinates (x, y) drawn in GLOW on the face.
BOLT = {
    (9, 2), (8, 3), (8, 4), (7, 5), (7, 6), (6, 7), (9, 7), (8, 8),
    (8, 7), (7, 8), (7, 9), (6, 10), (6, 11), (5, 12), (6, 9),
}


def pixel(x: int, y: int):
    # 1px patina frame
    if x in (0, SIZE - 1) or y in (0, SIZE - 1):
        return PATINA
    # inner bevel
    if x in (1, SIZE - 2) or y in (1, SIZE - 2):
        return COPPER_DARK
    if (x, y) in BOLT:
        return GLOW
    # deterministic hatch pattern for texture depth
    return COPPER_LIGHT if (x * 7 + y * 13) % 5 == 0 else COPPER


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def main() -> None:
    raw = b""
    for y in range(SIZE):
        raw += b"\x00"  # filter type 0 per scanline
        for x in range(SIZE):
            raw += bytes(pixel(x, y))

    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n"
           + png_chunk(b"IHDR", ihdr)
           + png_chunk(b"IDAT", zlib.compress(raw, 9))
           + png_chunk(b"IEND", b""))

    out = Path(__file__).resolve().parent.parent / "src/main/resources/assets/cuprum/textures/block/charge_probe.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png)
    print(f"wrote {out} ({len(png)} bytes)")


if __name__ == "__main__":
    main()
