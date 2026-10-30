#!/usr/bin/env python3
"""SVG image rotation workloads and independently pre-oriented source controls."""
import base64
from pathlib import Path
import sys

NS = 'http://www.w3.org/2000/svg'


def source(rows):
    body = ''.join(f'<rect x="{x}" y="{y}" width="1" height="1" fill="{color}"/>'
                   for y, row in enumerate(rows) for x, color in enumerate(row))
    width, height = len(rows[0]), len(rows)
    svg = (f'<svg xmlns="{NS}" width="{width}" height="{height}" '
           f'viewBox="0 0 {width} {height}">{body}</svg>')
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()


def generate(directory):
    directory.mkdir(parents=True, exist_ok=True)
    original = source([['red', 'lime'], ['blue', 'cyan'], ['magenta', 'yellow']])
    oriented = source([['magenta', 'blue', 'red'], ['yellow', 'cyan', 'lime']])
    for count in (1, 16):
        for name, url, hint, width, height in [
                ('none', original, 'none', 48, 72),
                ('rotate', original, '90deg', 72, 48),
                ('control', oriented, 'none', 72, 48)]:
            body = ''.join(f'<image x="{(i % 4) * 128}" y="{(i // 4) * 96}" '
                           f'width="{width}" height="{height}" href="{url}" '
                           f'style="image-orientation:{hint}"/>' for i in range(count))
            (directory / f'{name}-{count}.svg').write_text(
                f'<svg xmlns="{NS}" width="512" height="384">{body}</svg>\n')


if __name__ == '__main__':
    generate(Path(sys.argv[1]))
