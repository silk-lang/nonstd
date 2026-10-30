#!/usr/bin/env python3
"""Measure retained PNG/JPEG images with the native SVG benchmark protocol.

Original deterministic 512x384 sources; Pillow is needed only to generate JPEG.
Use --generate DIR on a host with Pillow, then --inputs DIR on the measurement host.
Reports distinguish stage wall time from full-process Callgrind instructions.
"""
import argparse
import base64
import io
import json
from pathlib import Path
import statistics
import struct
import subprocess
import tempfile
import zlib

from harness import invoke, callgrind_ir, environment, sha256


def generate(directory):
    from PIL import Image
    directory.mkdir(parents=True, exist_ok=True)
    width, height = 512, 384
    samples = bytes(((x // 16 + y // 16) % 16) * 16
                    for y in range(height) for x in range(width))
    jpeg = io.BytesIO()
    Image.frombytes('L', (width, height), samples).save(jpeg, format='JPEG', quality=90)

    def chunk(kind, body):
        return (struct.pack('>I', len(body)) + kind + body
                + struct.pack('>I', zlib.crc32(kind + body)))

    scanlines = b''.join(b'\0' + samples[y * width:(y + 1) * width] for y in range(height))
    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(scanlines)) + chunk(b'IEND', b''))
    for kind, data in [('png', png), ('jpeg', jpeg.getvalue())]:
        url = f'data:image/{kind};base64,' + base64.b64encode(data).decode()
        for count in (1, 64):
            children = f'<image href="{url}"/>' if count == 1 else ''.join(
                f'<image x="{x * 64}" y="{y * 48}" width="64" height="48" href="{url}"/>'
                for y in range(8) for x in range(8))
            (directory / f'{kind}-{count}.svg').write_text(
                f'<svg xmlns="http://www.w3.org/2000/svg" width="512" height="384">'
                + children + '</svg>\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generate', type=Path)
    parser.add_argument('--inputs', type=Path)
    parser.add_argument('--silk', type=Path)
    parser.add_argument('--rust', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--callgrind', action='store_true')
    parser.add_argument('--iterations', type=int, default=5)
    parser.add_argument('--warmup', type=int, default=1)
    parser.add_argument('--samples', type=int, default=3)
    parser.add_argument('--timeout', type=int, default=300)
    args = parser.parse_args()
    if args.generate:
        generate(args.generate)
        return
    if not all([args.inputs, args.silk, args.rust, args.output]):
        parser.error('measurement requires --inputs, --silk, --rust and --output')
    binaries = {'silk': args.silk.resolve(), 'resvg': args.rust.resolve()}
    report = {'environment': environment(binaries), 'rows': [],
              'iterations': args.iterations, 'warmup': args.warmup, 'samples': args.samples,
              'callgrind_scope': 'full process, including startup, I/O and output checksum'}
    for source in sorted(args.inputs.glob('*.svg')):
        for mode in ('parse', 'render', 'end-to-end'):
            rows = {name: {'engine': name, 'input': source.name, 'mode': mode,
                           'input_sha256': sha256(source), 'samples_ns': []}
                    for name in binaries}
            for sample in range(args.samples):
                names = list(binaries)
                if sample % 2:
                    names.reverse()
                for name in names:
                    result, _ = invoke(binaries[name], mode, source.resolve(), args)
                    row = rows[name]
                    if 'checksum' in row and row['checksum'] != result['checksum']:
                        raise ValueError('output changed between samples')
                    row['checksum'] = result['checksum']
                    row['samples_ns'].append(result['elapsed_ns'] / args.iterations)
            for name, row in rows.items():
                row['median_ns'] = statistics.median(row['samples_ns'])
                if args.callgrind:
                    with tempfile.TemporaryDirectory() as directory:
                        output = Path(directory) / 'callgrind.out'
                        invoke(binaries[name], mode, source.resolve(), args,
                               ['valgrind', '--tool=callgrind', '--error-exitcode=99',
                                f'--callgrind-out-file={output}'])
                        row['process_Ir'] = callgrind_ir(output.read_text())
                report['rows'].append(row)
                print(f'{name} {source.name}/{mode}: {row["median_ns"] / 1e6:.4f} ms', flush=True)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
