#!/usr/bin/env python3
"""Writes the color glyph test fonts in fonts/raster/tests/fonts.

Needs fontTools (not part of the gate; the fonts are committed). Units per em are 1000, and
every glyph's outline is a plain square from (100, 0) to (900, 800), which a renderer that
draws the color version never shows.

- `ColrV0.ttf`: COLR version 0 with a CPAL palette. `A` (glyph 1) is three layers: an opaque
  red rectangle (100, 0)-(600, 800), a half-transparent blue rectangle (400, 0)-(900, 800) over
  it, and a foreground-color (palette index 0xFFFF) bar (100, 350)-(900, 450) on top. `B` (glyph
  2) has no color layers.
- `Sbix.ttf`: an `sbix` table with one 20 ppem strike. `A` is a 16 x 16 PNG, left half opaque
  green and right half opaque blue, placed 2 pixels right of the pen and 1 pixel below the
  baseline (origin offset (2, -1)).
- `Cbdt.ttf`: `CBDT`/`CBLC` with one 20 ppem strike of image format 17 (small metrics, PNG).
  `A` is the same 16 x 16 PNG with bearing (2, 15).
"""
import struct
import zlib
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import newTable
from fontTools.ttLib.tables import sbixStrike, sbixGlyph
from fontTools.ttLib.tables.DefaultTable import DefaultTable
from fontTools.colorLib.builder import buildCOLR, buildCPAL

OUT = Path(__file__).resolve().parents[1] / 'tests/fonts'


def rect(pen, x0, y0, x1, y1):
    pen.moveTo((x0, y0))
    pen.lineTo((x0, y1))
    pen.lineTo((x1, y1))
    pen.lineTo((x1, y0))
    pen.closePath()


def glyph(x0, y0, x1, y1):
    pen = TTGlyphPen(None)
    rect(pen, x0, y0, x1, y1)
    return pen.glyph()


def png(width, height, pixel):
    """A truecolor-with-alpha PNG; `pixel(x, y)` returns (r, g, b, a)."""
    rows = b''.join(
        b'\x00' + b''.join(bytes(pixel(x, y)) for x in range(width)) for y in range(height)
    )

    def chunk(kind, data):
        return (struct.pack('>I', len(data)) + kind + data
                + struct.pack('>I', zlib.crc32(kind + data) & 0xFFFFFFFF))

    header = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + chunk(b'IDAT', zlib.compress(rows, 9))
            + chunk(b'IEND', b''))


def halves(x, y):
    return (0, 200, 0, 255) if x < 8 else (0, 0, 220, 255)


def base(names, family):
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder(names)
    builder.setupCharacterMap({0x41 + i - 1: name for i, name in enumerate(names) if i > 0 and len(name) == 1})
    builder.setupHorizontalMetrics({name: (1000, 100) for name in names})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({'familyName': family, 'styleName': 'Regular'})
    builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
    builder.setupPost()
    builder.setupHead(unitsPerEm=1000, created=0, modified=0)
    return builder


def colr():
    names = ['.notdef', 'A', 'B', 'red', 'blue', 'bar']
    builder = base(names, 'Raster COLRv0')
    glyphs = {name: glyph(100, 0, 900, 800) for name in ['.notdef', 'A', 'B']}
    glyphs['red'] = glyph(100, 0, 600, 800)
    glyphs['blue'] = glyph(400, 0, 900, 800)
    glyphs['bar'] = glyph(100, 350, 900, 450)
    builder.setupGlyf(glyphs)
    # Left side bearings must equal each outline's xMin, or readers shift the points to match.
    builder.setupHorizontalMetrics({name: (1000, 400 if name == 'blue' else 100) for name in names})
    builder.font['COLR'] = buildCOLR({'A': [('red', 0), ('blue', 1), ('bar', 0xFFFF)]}, version=0)
    builder.font['CPAL'] = buildCPAL([[(1.0, 0.0, 0.0, 1.0), (0.0, 0.0, 1.0, 0.5)]])
    builder.save(OUT / 'ColrV0.ttf')


def sbix():
    names = ['.notdef', 'A', 'B']
    builder = base(names, 'Raster sbix')
    builder.setupGlyf({name: glyph(100, 0, 900, 800) for name in names})
    table = newTable('sbix')
    strike = sbixStrike.Strike(ppem=20, resolution=72)
    image = sbixGlyph.Glyph(glyphName='A', graphicType='png ', originOffsetX=2, originOffsetY=-1,
                            imageData=png(16, 16, halves))
    strike.glyphs['A'] = image
    table.strikes[20] = strike
    builder.font['sbix'] = table
    builder.save(OUT / 'Sbix.ttf')


def cbdt():
    names = ['.notdef', 'A', 'B']
    builder = base(names, 'Raster CBDT')
    builder.setupGlyf({name: glyph(100, 0, 900, 800) for name in names})
    image = png(16, 16, halves)
    # CBDT: version 3.0, then glyph 1 in format 17 (small metrics, data length, PNG).
    record = struct.pack('>BBbbB', 16, 16, 2, 15, 20) + struct.pack('>I', len(image)) + image
    cbdt_bytes = struct.pack('>HH', 3, 0) + record
    # CBLC: one BitmapSize for glyph 1 with one index subtable of format 1.
    line = struct.pack('>bbBbbbbbbbbb', 16, -4, 20, 0, 0, 0, 0, 0, 0, 0, 0, 0)
    array_offset = 8 + 48
    subtable = struct.pack('>HHI', 1, 17, 4) + struct.pack('>II', 0, len(record))
    array = struct.pack('>HHI', 1, 1, 8)
    size = (struct.pack('>IIII', array_offset, len(array) + len(subtable), 1, 0) + line + line
            + struct.pack('>HHBBBb', 1, 1, 20, 20, 32, 1))
    cblc_bytes = struct.pack('>HHI', 3, 0, 1) + size + array + subtable
    for tag, data in (('CBDT', cbdt_bytes), ('CBLC', cblc_bytes)):
        table = DefaultTable(tag)
        table.data = data
        builder.font[tag] = table
    builder.save(OUT / 'Cbdt.ttf')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    colr()
    sbix()
    cbdt()


if __name__ == '__main__':
    main()
