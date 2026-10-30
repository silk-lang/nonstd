#!/usr/bin/env python3
"""Original retained SVG-image workloads with equivalent inline-vector controls.

Generate with: python3 images/svg/bench/nested.py OUTPUT_DIRECTORY
Measure with images.py --inputs OUTPUT_DIRECTORY and the normal benchmark flags.
"""
import base64
from pathlib import Path
import sys

NS = 'http://www.w3.org/2000/svg'


def source():
    svg = (f'<svg xmlns="{NS}" width="8" height="8" viewBox="0 0 8 8">'
           '<rect width="4" height="8" fill="red"/>'
           '<rect x="4" width="4" height="8" fill="blue"/></svg>')
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()


def generate(directory):
    directory.mkdir(parents=True, exist_ok=True)
    url = source()
    for name, count, varied in [('single', 1, False), ('shared', 16, False),
                                 ('viewports', 16, True)]:
        embedded = []
        inline = []
        for index in range(count):
            x, y = (index % 4) * 32, (index // 4) * 32
            width = 8 + index if varied else 24
            height = 24
            embedded.append(f'<image x="{x}" y="{y}" width="{width}" height="{height}" '
                            f'preserveAspectRatio="none" href="{url}"/>')
            inline.append(f'<rect x="{x}" y="{y}" width="{width / 2}" height="{height}" fill="red"/>'
                          f'<rect x="{x + width / 2}" y="{y}" width="{width / 2}" height="{height}" fill="blue"/>')
        for kind, children in [('embedded', embedded), ('inline', inline)]:
            (directory / f'{kind}-{name}.svg').write_text(
                f'<svg xmlns="{NS}" width="128" height="128">'
                + ''.join(children) + '</svg>\n')


if __name__ == '__main__':
    generate(Path(sys.argv[1]))
