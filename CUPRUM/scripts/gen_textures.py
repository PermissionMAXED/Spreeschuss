#!/usr/bin/env python3
"""Deterministically generates 16x16 block textures added after W1B.

The mod ships no hand-drawn binary assets; this script (stdlib only) produced the
committed PNGs. Re-running it always yields byte-identical output. W1C owns the
diagnostic coil textures; later phases append entries to TEXTURES (D11 —
scripts/gen_probe_texture.py is frozen with the charge_probe texture).

Usage: python3 scripts/gen_textures.py
"""
import struct
import zlib
from pathlib import Path

SIZE = 16

# Palette (RGBA) — shared copper family with gen_probe_texture.py.
COPPER_DARK = (140, 74, 44, 255)
COPPER = (183, 104, 60, 255)
COPPER_LIGHT = (216, 141, 88, 255)
PATINA = (73, 156, 130, 255)
GLOW = (255, 226, 120, 255)
COIL_WIRE = (232, 163, 60, 255)

# Concentric coil-winding ring (Chebyshev radius 4 around the face center) with a
# glow core: reads as a wound inductor from any side.
_CENTER = 7.5


def _chebyshev(x: int, y: int) -> float:
    return max(abs(x - _CENTER), abs(y - _CENTER))


def core_pixel(x: int, y: int):
    # 1px patina frame
    if x in (0, SIZE - 1) or y in (0, SIZE - 1):
        return PATINA
    # inner bevel
    if x in (1, SIZE - 2) or y in (1, SIZE - 2):
        return COPPER_DARK
    ring = _chebyshev(x, y)
    if ring <= 1.0:
        return GLOW
    if ring <= 2.0:
        return COPPER_DARK
    # winding band: alternate wire/dark rows for a coiled look
    if ring <= 4.0:
        return COIL_WIRE if (x + y) % 2 == 0 else COPPER_DARK
    # deterministic hatch pattern for texture depth
    return COPPER_LIGHT if (x * 7 + y * 13) % 5 == 0 else COPPER


def frame_pixel(x: int, y: int):
    # 1px patina frame
    if x in (0, SIZE - 1) or y in (0, SIZE - 1):
        return PATINA
    # thick copper-dark chassis border
    if x in (1, 2, SIZE - 3, SIZE - 2) or y in (1, 2, SIZE - 3, SIZE - 2):
        return COPPER_DARK if (x * 3 + y * 5) % 4 != 0 else COPPER
    # diagonal cross-brace
    if x == y or x + y == SIZE - 1:
        return COPPER_LIGHT
    # deterministic hatch pattern for texture depth
    return COPPER_LIGHT if (x * 7 + y * 13) % 5 == 0 else COPPER


# name -> per-pixel function; later phases append entries only.
TEXTURES = {
    "diagnostic_coil_core": core_pixel,
    "diagnostic_coil_frame": frame_pixel,
}


def png_chunk(tag: bytes, data: bytes) -> bytes:
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def write_png(name: str, pixel) -> None:
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

    out = (Path(__file__).resolve().parent.parent
           / f"src/main/resources/assets/cuprum/textures/block/{name}.png")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png)
    print(f"wrote {out} ({len(png)} bytes)")


def main() -> None:
    for name, pixel in TEXTURES.items():
        write_png(name, pixel)


if __name__ == "__main__":
    main()
