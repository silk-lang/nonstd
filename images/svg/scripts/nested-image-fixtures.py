#!/usr/bin/env python3
"""Original SVG-in-image probes; references are independently placed rectangles."""
import base64
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/images'
NS = 'http://www.w3.org/2000/svg'
SPEC = 'https://www.w3.org/TR/2018/CR-SVG2-20181004/embedded.html#ImageElement'


def document(body, attrs='width="12" height="12"'):
    return f'<svg xmlns="{NS}" {attrs}>{body}</svg>\n'


def data(svg):
    return 'data:image/svg+xml;base64,' + base64.b64encode(svg.encode()).decode()


def rect(x, y, width, height, color):
    return f'<rect x="{x}" y="{y}" width="{width}" height="{height}" fill="{color}"/>'


manifest_path = ROOT / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['cases'] = [c for c in manifest['cases'] if not c['id'].startswith('image-nested-')]


def add(name, actual, reference, reason):
    filename = 'nested-' + name + '.svg'
    (ROOT / 'inputs' / filename).write_text(document(actual))
    (ROOT / 'references' / filename).write_text(document(reference))
    manifest['cases'].append(dict(
        id='image-nested-' + name, input='inputs/' + filename,
        references=[dict(path='references/' + filename, relation='==')],
        status='pass', tolerance={}, spec=SPEC, reason=reason))


source = document(rect(0, 0, 1, 1, 'red') + rect(1, 0, 1, 1, 'blue'),
                  'width="2" height="1" viewBox="0 0 2 1"')
url = data(source)
add('intrinsic', f'<image x="1" y="2" href="{url}"/>',
    rect(1, 2, 1, 1, 'red') + rect(2, 2, 1, 1, 'blue'),
    'Absolute root dimensions provide intrinsic size; the embedded SVG is an independent document.')
add('meet', f'<image x="1" y="1" width="8" height="8" href="{url}"/>',
    rect(1, 3, 4, 4, 'red') + rect(5, 3, 4, 4, 'blue'),
    'Default xMidYMid meet fits the intrinsic two-to-one ratio into the image positioning rectangle.')
add('none', f'<image x="1" y="1" width="8" height="8" preserveAspectRatio="none" href="{url}"/>',
    rect(1, 1, 4, 8, 'red') + rect(5, 1, 4, 8, 'blue'),
    'The embedded root preserveAspectRatio is treated as none; the image attribute controls fitting.')
scoped = data(document('<rect width="100%" height="100%"/>', 'width="2" height="2"'))
add('style-isolation', '<style>rect {fill:lime}</style>'
    + f'<image x="1" y="1" width="6" height="6" fill="red" href="{scoped}"/>',
    rect(1, 1, 6, 6, 'black'),
    'Outer selectors and inherited fill must not enter the separate embedded document.')
percentage = data(document(rect(0, 0, '50%', '100%', 'red')
                           + rect('50%', 0, '50%', '100%', 'blue')))
add('percentage-viewport', f'<image x="1" y="1" width="8" height="4" preserveAspectRatio="none" href="{percentage}"/>',
    rect(1, 1, 4, 4, 'red') + rect(5, 1, 4, 4, 'blue'),
    'Percentages in the independent document resolve against its image-rendering viewport.')
external = document(rect(0, 0, 2, 2, 'red') + '<image width="2" height="2" href="nested-external.svg"/>',
                    'width="2" height="2"')
(ROOT / 'inputs/nested-external.svg').write_text(document(rect(0, 0, 2, 2, 'blue'), 'width="2" height="2"'))
(ROOT / 'inputs/nested-secure-source.svg').write_text(external)
add('secure-external', '<image x="1" y="1" width="6" height="6" href="nested-secure-source.svg"/>',
    rect(1, 1, 6, 6, 'red'),
    'The outer static document may fetch the SVG; its embedded document is secure-static and cannot fetch a sibling SVG.')
add('shared-viewports', f'<image x="1" y="1" width="4" height="2" href="{url}"/>'
    + f'<image x="1" y="5" width="8" height="4" href="{url}"/>',
    rect(1, 1, 2, 2, 'red') + rect(3, 1, 2, 2, 'blue')
    + rect(1, 5, 4, 4, 'red') + rect(5, 5, 4, 4, 'blue'),
    'The same resource renders at two occurrence-specific viewport sizes without sharing the wrong layout.')
# Resource files are also direct-render controls, so every tracked SVG has an
# explicit manifest entry and the secure test cannot pass because its payload broke.
for filename in ('nested-external.svg', 'nested-secure-source.svg'):
    reference = 'control-' + filename
    (ROOT / 'references' / reference).write_text(document(rect(0, 0, 2, 2, 'blue'), 'width="2" height="2"'))
    manifest['cases'].append(dict(
        id='image-nested-control-' + filename[:-4], input='inputs/' + filename,
        references=[dict(path='references/' + reference, relation='==')],
        status='pass', tolerance={}, spec=SPEC,
        reason='Direct static rendering validates the resource content and that external image loading works outside secure embedded mode.'))
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
