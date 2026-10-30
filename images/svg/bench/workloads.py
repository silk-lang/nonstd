#!/usr/bin/env python3
"""Deterministic original workloads plus a separately cached, licensed Tiger.

No generated or third-party SVG is added to production dependencies. The Tiger
source is downloaded verbatim only on explicit request. A separately named,
hash-pinned derivative adds an explicit common host viewport for both engines;
all viewBox, geometry and paint attributes are preserved.
"""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent


def svg(size, shapes):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">\n'
            + "\n".join(shapes) + "\n</svg>\n").encode()


def generate_icons(config):
    size, state = config["size"], config["seed"]
    files = {}
    for index in range(config["count"]):
        state = (1664525 * state + 1013904223) & 0xffffffff
        color = f"#{state & 0xffffff:06x}"
        inset = 2 + index % 5
        shapes = [
            f'<rect x="1" y="1" width="{size - 2}" height="{size - 2}" rx="4" fill="{color}"/>',
            f'<circle cx="{size // 2}" cy="{size // 2}" r="{5 + index % 6}" fill="#ffffff"/>',
            f'<path d="M {inset} {size - inset} L {size // 2} {inset} L {size - inset} {size - inset} Z" fill="none" stroke="#183048" stroke-width="1" stroke-linejoin="round"/>',
            f'<path d="M 4 {8 + index % 8} Q 16 2 28 24" fill="none" stroke="#905020" stroke-width="2"/>',
            '<circle cx="10" cy="12" r="2" fill="#204060"/>',
            '<circle cx="22" cy="12" r="2" fill="#204060"/>',
        ]
        files[f"icon-{index:03d}.svg"] = svg(size, shapes)
    return files


def generate_map(config):
    size, grid = config["size"], config["grid"]
    step = size // grid
    shapes = []
    for y in range(grid):
        for x in range(grid):
            left, top = x * step + 2, y * step + 2
            right, bottom = (x + 1) * step - 2, (y + 1) * step - 2
            color = ("#ccd9b5", "#d9d0ba", "#b9d3cc")[(x * 7 + y * 11) % 3]
            shapes.append(f'<path d="M {left} {top} L {right} {top + (x + y) % 4} L {right - x % 3} {bottom} L {left} {bottom} Z" fill="{color}" stroke="#596559" stroke-width="1"/>')
            shapes.append(f'<path d="M {left + 3} {top + 4} h {step // 3} v {step // 3} h {-step // 3} Z" fill="#a39186"/>')
    for i in range(1, grid):
        at = i * step
        shapes.append(f'<path d="M 0 {at} H {size} M {at} 0 V {size}" fill="none" stroke="#f5f1df" stroke-width="3"/>')
    shapes.append(f'<path d="M 0 {size // 3} C {size // 3} 0 {size // 2} {size} {size} {size // 2}" fill="none" stroke="#5096bb" stroke-width="9"/>')
    return {"largemap.svg": svg(size, shapes)}


def generate_curves(config):
    size, grid = config["size"], config["grid"]
    step = size // grid
    shapes = []
    for y in range(grid):
        for x in range(grid):
            left, top = x * step, y * step
            color = ("#356a97", "#b65939", "#6b8350")[(x + y) % 3]
            shapes.append(f'<g transform="translate({left} {top})"><path d="M 2 24 C 3 0 24 0 28 18 Q 18 30 2 24 Z" fill="{color}" stroke="#27313b" stroke-width="1"/><path d="M 3 10 Q 14 30 28 5" fill="none" stroke="#efe6bc" stroke-width="2" stroke-linecap="round"/></g>')
    return {"mixedcurves.svg": svg(size, shapes)}


def generate_stylesheets(config):
    """Shared CSS subset: selective child/class rules over a dense rectangle grid."""
    size, rows, columns = config["size"], config["rows"], config["columns"]
    width, height = size // columns, size // rows
    rules = []
    groups = []
    for row in range(rows):
        cells = []
        for column in range(columns):
            red = 32 + (row * 37 + column * 17) % 192
            green = 32 + (row * 13 + column * 43) % 192
            blue = 32 + (row * 29 + column * 7) % 192
            rules.append(f".r{row} > rect.c{column} {{ fill: #{red:02x}{green:02x}{blue:02x}; }}")
            cells.append(f'<rect class="c{column}" x="{column * width}" y="{row * height}" width="{width - 1}" height="{height - 1}"/>')
        groups.append(f'<g class="r{row}">' + "".join(cells) + "</g>")
    return {"stylesheets.svg": svg(size, ["<style>" + "\n".join(rules) + "</style>", *groups])}


def generate_instances(config):
    """Nested use shadows sharing two source paths, with per-instance inherited paint."""
    size, grid = config["size"], config["grid"]
    step = size // grid
    definitions = (
        '<defs><symbol id="tile" viewBox="0 0 16 16">'
        '<path d="M1 1H15V15H1Z"/>'
        '<path fill="white" d="M4 4H12V6H4Z M4 8H10V10H4Z"/>'
        '</symbol><g id="badge"><use href="#tile" width="16" height="16"/></g></defs>'
    )
    instances = []
    for row in range(grid):
        for column in range(grid):
            fill = "#e67e22" if (row + column) % 2 else "#2388dd"
            instances.append(
                f'<use href="#badge" x="{column * step}" y="{row * step}" fill="{fill}"/>'
            )
    return {"instances.svg": svg(size, [definitions, *instances])}


def generate_paintservers(config):
    """Painted mosaic: shared user-space tiles containing linear/radial gradients."""
    size, grid = config["size"], config["grid"]
    step = (size - 64) // grid
    edge = step - 8
    definitions = (
        '<defs>'
        '<linearGradient id="panel" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#b5dbd8"/>'
        '<stop offset="0.5" stop-color="#548b97"/>'
        '<stop offset="1" stop-color="#24475d"/>'
        '</linearGradient>'
        '<linearGradient id="thread" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="16" y2="16">'
        '<stop offset="0" stop-color="#163347"/>'
        '<stop offset="0.5" stop-color="#418a92"/>'
        '<stop offset="1" stop-color="#91c4b0"/>'
        '</linearGradient>'
        '<radialGradient id="bead" gradientUnits="userSpaceOnUse" cx="8" cy="8" r="6" fx="8" fy="8" fr="0">'
        '<stop offset="0" stop-color="#fff1b0"/>'
        '<stop offset="0.5" stop-color="#d4a45c"/>'
        '<stop offset="1" stop-color="#80512e"/>'
        '</radialGradient>'
        '<radialGradient id="jewel" cx="0.5" cy="0.5" r="0.5" fx="0.5" fy="0.5" fr="0">'
        '<stop offset="0" stop-color="#e5f5df"/>'
        '<stop offset="0.4" stop-color="#7bb9a0"/>'
        '<stop offset="1" stop-color="#205263"/>'
        '</radialGradient>'
        '<pattern id="weave" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">'
        '<rect width="16" height="16" fill="url(#thread)"/>'
        '<path d="M0 4H16 M0 12H16" fill="none" stroke="#163347" stroke-width="2"/>'
        '<path d="M4 0V16 M12 0V16" fill="none" stroke="#91c4b0" stroke-width="1"/>'
        '</pattern>'
        '<pattern id="beads" patternUnits="userSpaceOnUse" patternContentUnits="userSpaceOnUse" x="0" y="0" width="16" height="16">'
        '<rect width="16" height="16" fill="url(#thread)"/>'
        '<circle cx="8" cy="8" r="6" fill="url(#bead)"/>'
        '</pattern>'
        '</defs>'
    )
    shapes = [
        definitions,
        f'<rect width="{size}" height="{size}" fill="#102738"/>',
        f'<rect x="16" y="16" width="{size - 32}" height="{size - 32}" rx="12" fill="url(#panel)"/>',
        f'<rect x="24" y="24" width="{size - 48}" height="{size - 48}" rx="8" fill="#163347"/>',
    ]
    # Absolute coordinates and identical user-space tile definitions allow reuse
    # across every panel; no per-shape transforms or object-bounding-box patterns.
    for row in range(grid):
        for column in range(grid):
            left, top = 32 + column * step, 32 + row * step
            cx, cy = left + edge // 2, top + edge // 2
            shapes.extend([
                f'<rect x="{left}" y="{top}" width="{edge}" height="{edge}" rx="6" fill="url(#panel)"/>',
                f'<rect x="{left + 3}" y="{top + 3}" width="{edge - 6}" height="{edge - 6}" rx="4" fill="url(#weave)"/>',
                f'<circle cx="{cx}" cy="{cy}" r="{edge // 3}" fill="url(#beads)" stroke="#e2c27a" stroke-width="2"/>',
                f'<circle cx="{cx}" cy="{cy}" r="{edge // 6}" fill="url(#jewel)" stroke="#163347" stroke-width="1"/>',
            ])
    return {"paintservers.svg": svg(size, shapes)}


def generate_compositing(config):
    """Overlapping layers exercise all blend modes and nested isolation/opacity."""
    size, grid = config["size"], config["grid"]
    step = size // grid
    modes = ("normal", "multiply", "screen", "overlay", "darken", "lighten",
             "color-dodge", "color-burn", "hard-light", "soft-light", "difference",
             "exclusion", "hue", "saturation", "color", "luminosity")
    shapes = [f'<rect width="{size}" height="{size}" fill="#315579"/>']
    for row in range(grid):
        for column in range(grid):
            mode = modes[(row * grid + column) % len(modes)]
            left, top = column * step, row * step
            shapes.append(
                f'<g style="isolation:isolate" opacity="0.8">'
                f'<rect x="{left}" y="{top}" width="{step}" height="{step}" fill="#cc6633"/>'
                f'<g style="mix-blend-mode:{mode}">'
                f'<rect x="{left + 2}" y="{top + 2}" width="{step}" height="{step}" fill="#3399cc"/>'
                f'<circle cx="{left + step // 2}" cy="{top + step // 2}" r="{step // 3}" fill="#99cc55"/>'
                '</g></g>')
    return {"compositing.svg": svg(size, shapes)}


def generate_clipping(config):
    """Repeated transformed unions/intersections plus CSS basic-shape clipping."""
    size, grid = config["size"], config["grid"]
    step = size // grid
    shapes = ['<defs><clipPath id="outer" clipPathUnits="objectBoundingBox">'
              '<rect x=".1" y=".1" width=".8" height=".8"/></clipPath>'
              '<clipPath id="union" clipPathUnits="objectBoundingBox" clip-path="url(#outer)">'
              '<circle cx=".35" cy=".5" r=".35"/>'
              '<circle cx=".65" cy=".5" r=".35"/></clipPath></defs>',
              f'<rect width="{size}" height="{size}" fill="#315579"/>']
    for row in range(grid):
        for column in range(grid):
            left, top = column * step, row * step
            shapes.append(
                f'<g transform="translate({left} {top})" clip-path="url(#union)">'
                f'<rect width="{step}" height="{step}" fill="#cc6633"/>'
                f'<rect width="{step}" height="{step}" fill="#3399cc" '
                'style="clip-path:polygon(0 0,100% 25%,75% 100%,25% 75%)"/></g>')
    return {"clipping.svg": svg(size, shapes)}


def verify_asset(data, spec):
    if hashlib.sha256(data).hexdigest() != spec["sha256"]:
        raise ValueError("Tiger SHA-256 mismatch; refusing unpinned content")
    if len(data) != spec["bytes"]:
        raise ValueError("Tiger byte count mismatch")


def normalize_tiger(data, config):
    """Add only root output dimensions; XML serialization may change namespace prefixes."""
    root = ET.fromstring(data)
    if root.tag != "{http://www.w3.org/2000/svg}svg" or root.get("viewBox") != config["viewBox"]:
        raise ValueError("Tiger viewport normalization requires the pinned SVG viewBox")
    ET.register_namespace("", "http://www.w3.org/2000/svg")
    root.set("width", str(config["width"]))
    root.set("height", str(config["height"]))
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def prepare(manifest, cache, fetch_tiger=False, selected=None):
    cache = Path(cache)
    result = {}
    generators = {"iconset": generate_icons, "largemap": generate_map, "mixedcurves": generate_curves, "stylesheets": generate_stylesheets, "instances": generate_instances, "paintservers": generate_paintservers, "compositing": generate_compositing, "clipping": generate_clipping}
    for name, spec in manifest["workloads"].items():
        if selected is not None and name not in selected:
            continue
        directory = cache / name
        directory.mkdir(parents=True, exist_ok=True)
        if name == "tiger":
            path = directory / "tiger.svg"
            if not path.exists():
                if not fetch_tiger:
                    raise FileNotFoundError("pinned Tiger is missing; run python3 images/svg/bench/workloads.py --fetch-tiger (AGPL-3.0-or-later benchmark-only asset)")
                request = urllib.request.Request(spec["url"], headers={"User-Agent": "silk-svg-bench/0.1"})
                with urllib.request.urlopen(request, timeout=60) as response:
                    data = response.read(spec["bytes"] + 1)
                verify_asset(data, spec)
                path.write_bytes(data)
            source = path.read_bytes()
            verify_asset(source, spec)
            normalized = normalize_tiger(source, spec["viewport_normalization"])
            derived_hash = hashlib.sha256(normalized).hexdigest()
            if derived_hash != spec["viewport_normalization"]["sha256"]:
                raise ValueError("normalized Tiger SHA-256 mismatch")
            derived = directory / "tiger-sized.svg"
            if not derived.exists() or derived.read_bytes() != normalized:
                derived.write_bytes(normalized)
            provenance = {**spec, "source_file": path.name, "benchmark_file": derived.name,
                          "derived_sha256": derived_hash, "derived_bytes": len(normalized)}
            (directory / "provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
            result[name] = [derived]
        else:
            files = generators[name](spec["config"])
            paths = []
            for filename, data in sorted(files.items()):
                path = directory / filename
                # Always replace mutated cache content with the deterministic original.
                if not path.exists() or path.read_bytes() != data:
                    path.write_bytes(data)
                paths.append(path)
            result[name] = paths
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fetch-tiger", action="store_true", help="fetch the content-pinned, separately licensed Tiger")
    args = parser.parse_args()
    manifest = json.loads((HERE / "workloads.json").read_text())
    prepared = prepare(manifest, HERE / ".cache/workloads", args.fetch_tiger)
    for name, files in prepared.items():
        print(f"{name}: {len(files)} SVG files, {sum(path.stat().st_size for path in files)} bytes")


if __name__ == "__main__":
    main()
