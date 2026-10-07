#!/usr/bin/env python3
"""Generates the app icons — a barometer dial on a cool near-black field.

No image libraries are available in this repo's toolchain, so the PNGs are
written directly (RGBA, zlib-deflated scanlines). Re-run from this directory
after changing the design:

    python3 make-icons.py
"""
import math
import struct
import zlib

BG = (0x0D, 0x11, 0x17)      # cool near-black, matching the app background
DIAL = (0xE9, 0xEE, 0xF5)    # cool white ring and hub
NEEDLE = (0x8C, 0xC8, 0xFF)  # light blue needle, the app's accent


def blend(dst, src, alpha):
    return tuple(round(d + (s - d) * alpha) for d, s in zip(dst, src))


def coverage(inside, x, y, samples=4):
    """Anti-aliasing: fraction of a pixel's subsamples that are inside the shape."""
    hits = 0
    step = 1.0 / samples
    for sy in range(samples):
        for sx in range(samples):
            if inside(x + (sx + 0.5) * step, y + (sy + 0.5) * step):
                hits += 1
    return hits / (samples * samples)


def render(size):
    c = size / 2.0
    r_outer = size * 0.34
    r_inner = size * 0.27
    # Needle: a line from the dial centre out to ~2 o'clock (rising pressure).
    angle = math.radians(-52)
    nx, ny = math.cos(angle), math.sin(angle)
    half_w = size * 0.028
    length = size * 0.30

    def in_ring(x, y):
        d = math.hypot(x - c, y - c)
        return r_inner <= d <= r_outer

    def in_needle(x, y):
        dx, dy = x - c, y - c
        along = dx * nx + dy * ny
        across = abs(-dx * ny + dy * nx)
        return 0 <= along <= length and across <= half_w * (1 - 0.6 * along / length)

    def in_hub(x, y):
        return math.hypot(x - c, y - c) <= size * 0.045

    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            px = BG
            a = coverage(in_ring, x, y)
            if a:
                px = blend(px, DIAL, a)
            a = coverage(in_needle, x, y)
            if a:
                px = blend(px, NEEDLE, a)
            a = coverage(in_hub, x, y)
            if a:
                px = blend(px, DIAL, a)
            row += bytes((*px, 255))
        rows.append(row)
    return rows


def write_png(path, size):
    rows = render(size)
    raw = b"".join(b"\x00" + bytes(r) for r in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)
    print(f"wrote {path} ({size}x{size})")


if __name__ == "__main__":
    write_png("icon-192.png", 192)
    write_png("icon-512.png", 512)
    write_png("apple-touch-icon.png", 180)
