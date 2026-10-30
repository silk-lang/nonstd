#!/usr/bin/env python3
"""Original image-sampling workloads and independently expanded smooth controls.

Generate with: python3 images/svg/bench/sampling.py OUTPUT_DIRECTORY
Measure with images.py --inputs OUTPUT_DIRECTORY and the normal benchmark flags.
"""
import base64
from pathlib import Path
import struct
import sys
import zlib


def source(mx, my):
    def chunk(kind, body):
        return (struct.pack('>I', len(body)) + kind + body
                + struct.pack('>I', zlib.crc32(kind + body)))

    def pixel(x, y):
        return ((x * 17) % 256, (y * 17) % 256, ((x + y) * 31) % 256)

    rows = b''.join(b'\0' + bytes(c for x in range(16 * mx)
                                 for c in pixel(x // mx, y // my))
                    for y in range(16 * my))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', 16 * mx, 16 * my, 8, 2, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))
    return 'data:image/png;base64,' + base64.b64encode(png).decode()


def generate(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for count, width, height, mx, my in [(1, 435.2, 307.2, 27, 19), (64, 51.2, 44.8, 3, 3)]:
        for name, hint, url in [('auto', 'auto', source(1, 1)),
                                ('pixelated', 'pixelated', source(1, 1)),
                                ('expanded-smooth', 'smooth', source(mx, my))]:
            children = ''.join(
                f'<image x="{(i % 8) * 64}" y="{(i // 8) * 48}" '
                f'width="{width}" height="{height}" preserveAspectRatio="none" '
                f'href="{url}" style="image-rendering:{hint}"/>' for i in range(count))
            (directory / f'{name}-{count}.svg').write_text(
                '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="384">'
                + children + '</svg>\n')


if __name__ == '__main__':
    generate(Path(sys.argv[1]))
