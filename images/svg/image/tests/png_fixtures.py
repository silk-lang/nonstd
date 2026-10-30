#!/usr/bin/env python3
"""Original PNG decoder vectors; zlib creates streams independently of Silk's encoder."""
import struct
import zlib
import subprocess
from pathlib import Path


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def png(depth, color, row, extras=b''):
    header = struct.pack('>IIBBBBB', 2, 1, depth, color, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header) + extras
            + chunk(b'IDAT', zlib.compress(b'\0' + row)) + chunk(b'IEND', b''))


def literal(data):
    return 'b"' + ''.join(f'\\x{v:02x}' for v in data) + '"'


cases = []
for depth in (1, 2, 4, 8, 16):
    # Two extremes make reduction independent of rounding policy.
    row = bytes([((1 << depth) - 1) << (8 - depth * 2)]) if depth < 8 else (b'\0\xff' if depth == 8 else b'\0\0\xff\xff')
    cases.append((f'gray{depth}', png(depth, 0, row), b'\0\0\0\xff\xff\xff\xff\xff'))
for depth in (8, 16):
    expand = lambda b: b if depth == 8 else bytes(v for x in b for v in (x, x))
    cases.append((f'rgb{depth}', png(depth, 2, expand(b'\xff\0\0\0\xff\0')), b'\xff\0\0\xff\0\xff\0\xff'))
    cases.append((f'grayAlpha{depth}', png(depth, 4, expand(b'\xff\x80\xff\0')), b'\x80\x80\x80\x80\0\0\0\0'))
    cases.append((f'rgba{depth}', png(depth, 6, expand(b'\xff\0\0\x80\0\xff\0\xff')), b'\x80\0\0\x80\0\xff\0\xff'))
for depth in (1, 2, 4, 8):
    row = bytes([1 << (8 - depth * 2)]) if depth < 8 else b'\0\1'
    extra = chunk(b'PLTE', b'\xff\0\0\0\xff\0') + chunk(b'tRNS', b'\x80\xff')
    cases.append((f'palette{depth}', png(depth, 3, row, extra), b'\x80\0\0\x80\0\xff\0\xff'))

def frame(width, height, depth, color, raw, interlace=0):
    header = struct.pack('>IIBBBBB', width, height, depth, color, 0, 0, interlace)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
            + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def paeth(a, b, c):
    p = a + b - c
    return min((a, b, c), key=lambda x: abs(p - x))


# Every filter is exercised on multiple rows, with byte wraparound and distinct channels.
width, height = 3, 3
pixels = bytes((i * 71 + 17) % 256 for i in range(width * height * 4))
expected = bytes(v for r, g, b, a in zip(*[iter(pixels)] * 4)
                 for v in ((r*a+127)//255, (g*a+127)//255, (b*a+127)//255, a))
for kind in range(5):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(kind)
        for x in range(stride):
            a = pixels[y*stride+x-4] if x >= 4 else 0
            b = pixels[(y-1)*stride+x] if y else 0
            c = pixels[(y-1)*stride+x-4] if y and x >= 4 else 0
            prediction = (0, a, b, (a+b)//2, paeth(a,b,c))[kind]
            raw.append((pixels[y*stride+x]-prediction) % 256)
    cases.append((f'filter{kind}', frame(width, height, 8, 6, raw), expected))

# Adam7 starts/strides from PNG section 8; each pass is an independent filter image.
passes = [(0,0,8,8), (4,0,8,8), (0,4,4,8), (2,0,4,4),
          (0,2,2,4), (1,0,2,2), (0,1,1,2)]
for width, height in [(1,1), (1,9), (9,1), (9,9)]:
    for depth in (1,8):
        values = [[(x+y) % 2 if depth == 1 else (x*37+y*71)%256
                   for x in range(width)] for y in range(height)]
        raw = bytearray()
        for left, top, dx, dy in passes:
            if left >= width or top >= height:
                continue
            for y in range(top,height,dy):
                samples = [values[y][x] for x in range(left,width,dx)]
                raw.append(0)
                if depth == 8:
                    raw.extend(samples)
                else:
                    raw.extend(sum(v << (7-i) for i,v in enumerate(samples[start:start+8]))
                               for start in range(0,len(samples),8))
        expected = bytes(v for row in values for x in row for v in ((x*255 if depth==1 else x),)*3+(255,))
        cases.append((f'adam7Gray{depth}Size{width}By{height}', frame(width,height,depth,0,raw,1), expected))

# PNG 3 requires decoders to mask unused high bits of tRNS samples.
cases.append(('grayTransparencyHighBits', png(8,0,b'\0\xff',chunk(b'tRNS',b'\x01\0')), b'\0\0\0\0\xff\xff\xff\xff'))
cases.append(('rgbTransparencyHighBits', png(8,2,b'\0'*6,chunk(b'tRNS',b'\x01\0\0\0\0\0')), b'\0'*8))

def control(sequence, width, height, x=0, y=0, dispose=0, blend=0):
    return chunk(b'fcTL', struct.pack('>IIIIIHHBB', sequence,width,height,x,y,1,10,dispose,blend))

apng_header = chunk(b'IHDR',struct.pack('>IIBBBBB',2,1,8,6,0,0,0))
apng_start = b'\x89PNG\r\n\x1a\n'+apng_header+chunk(b'acTL',struct.pack('>II',2,0))
apng_default = chunk(b'IDAT',zlib.compress(b'\0\xff\0\0\xff\xff\0\0\xff'))
apng_end = chunk(b'IEND',b'')
first_default = (apng_start+control(0,2,1)+apng_default+control(1,1,1,1)
                 +chunk(b'fdAT',struct.pack('>I',2)+zlib.compress(b'\0\0\xff\0\xff'))+apng_end)
first_separate = (apng_start+apng_default+control(0,1,1,1,0,2,1)
                  +chunk(b'fdAT',struct.pack('>I',1)+zlib.compress(b'\0\0\xff\0\x80'))
                  +control(2,2,1)+chunk(b'fdAT',struct.pack('>I',3)+zlib.compress(b'\0'+b'\xff'*8))+apng_end)
cases.append(('apngDefaultFirst',first_default,b'\xff\0\0\xff'*2))
cases.append(('apngSeparateFirst',first_separate,b'\0'*4+b'\0\x80\0\x80'))
# Split fdAT chunks carry a single zlib stream, excluding each sequence prefix.
first_stream=zlib.compress(b'\0\0\xff\0\x80')
first_split=(b'\x89PNG\r\n\x1a\n'+apng_header+chunk(b'acTL',struct.pack('>II',1,1))
             +apng_default+control(0,1,1,1)
             +chunk(b'fdAT',struct.pack('>I',1)+first_stream[:4])
             +chunk(b'fdAT',struct.pack('>I',2)+first_stream[4:])+apng_end)
cases.append(('apngSplitFrame',first_split,b'\0'*4+b'\0\x80\0\x80'))
source = '''//! Independent PNG sample vectors generated by ../tests/png_fixtures.py.
//! https://www.w3.org/TR/png-3/#11IHDR and #11tRNS
import png
import image { Image, ImageError }
import png_decode { PngError }
import silk.core.effect { Effect }
import silk.mem.allocator { Allocator, OutOfMemoryError }
import silk.testing.testing { Testing, AssertionError }

effect fn check(data: &[u8], expected: &[u8], width: u32, height: u32) -> ()
  ! PngError | ImageError | OutOfMemoryError | AssertionError<'static>
  ? &mut Allocator {
  let image = run png.decode(data)
  run Testing.expect(image.width() == width && image.height() == height, "decoded dimensions")
  let pixels = image.data()
  run Testing.expect(pixels.length == expected.length, "decoded length")
  let mut i: usize = 0
  while i < pixels.length {
    run Testing.expect(pixels[i] == expected[i], "straight samples become premultiplied RGBA")
    i = i + 1
  }
}
'''
for name, data, expected in cases:
    width, height = struct.unpack('>II', data[16:24])
    source += f'''
test effect fn {name}() -> ()
  ! PngError | ImageError | OutOfMemoryError | AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run check({literal(data)}, {literal(expected)}, {width}, {height})
    |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
target = Path(__file__).resolve().parents[1].joinpath('src/png_decode_tests.silk')
target.write_text(source)
subprocess.run(['silk', 'format', str(target)], check=True)

# Decoder failures are tested independently of encoder output and must not escape as panics.
valid = png(8, 6, b'\xff\0\0\xff\0\xff\0\xff')
header = chunk(b'IHDR', struct.pack('>IIBBBBB', 2, 1, 8, 6, 0, 0, 0))
stream = zlib.compress(b'\0\xff\0\0\xff\0\xff\0\xff')
signature = b'\x89PNG\r\n\x1a\n'
end = chunk(b'IEND', b'')
bad = [
    ('badCrc', valid[:-1] + bytes([valid[-1] ^ 1])),
    ('unknownCritical', signature + header + chunk(b'ABCD', b'') + chunk(b'IDAT', stream) + end),
    ('duplicateHeader', signature + header + header + chunk(b'IDAT', stream) + end),
    ('separatedData', signature + header + chunk(b'IDAT', stream[:4]) + chunk(b'tEXt', b'k\0v') + chunk(b'IDAT', stream[4:]) + end),
    ('excessInflation', frame(2,1,8,6,b'\0' + b'\xff'*10000)),
    ('shortInflation', frame(2,1,8,6,b'\0\xff')),
    ('badFilter', frame(2,1,8,6,b'\x05' + b'\xff'*8)),
    ('extraCompressedBytes', signature + header + chunk(b'IDAT', stream+b'junk') + end),
    ('invalidZlibChecksum', signature + header + chunk(b'IDAT', stream[:-1]+bytes([stream[-1]^1])) + end),
    ('hugeDimensions', frame(2147483647,2147483647,8,6,b'')),
    ('zeroWidth', frame(0,1,8,6,b'')),
    ('badDepth', frame(2,1,4,6,b'\0\0')),
    ('paletteIndex', png(8,3,b'\0\2',chunk(b'PLTE',b'\xff\0\0'))),
]
bad.extend([
    ('zeroGamma', png(8,0,b'\0\xff',chunk(b'gAMA',b'\0'*4))),
    ('duplicateGamma', png(8,0,b'\0\xff',chunk(b'gAMA',struct.pack('>I',45455))*2)),
    ('shortChromaticities', png(8,0,b'\0\xff',chunk(b'cHRM',b'\0'*31))),
    ('badSrgbIntent', png(8,0,b'\0\xff',chunk(b'sRGB',b'\x04'))),
    ('lateGamma', signature+header+chunk(b'IDAT',stream)+chunk(b'gAMA',struct.pack('>I',45455))+end),
    ('badProfileName', png(8,2,b'\0'*6,chunk(b'iCCP',b' bad\0\0'+zlib.compress(b'profile')))),
    ('badProfileCompression', png(8,2,b'\0'*6,chunk(b'iCCP',b'name\0\x01'+zlib.compress(b'profile')))),
    ('badProfileStream', png(8,2,b'\0'*6,chunk(b'iCCP',b'name\0\0broken'))),
    ('profileInflationBomb', png(8,2,b'\0'*6,chunk(b'iCCP',b'name\0\0'+zlib.compress(bytes(16777217))))),
])
bad.extend([
    ('apngSequence', apng_start+control(1,2,1)+apng_default+apng_end),
    ('apngFrameCount',apng_start+control(0,2,1)+apng_default+apng_end),
    ('apngOutsideCanvas',apng_start+apng_default+control(0,2,1,1)+chunk(b'fdAT',struct.pack('>I',1)+first_stream)+apng_end),
    ('apngMissingFrameData',apng_start+control(0,2,1)+apng_default+control(1,1,1)+apng_end),
    ('apngInvalidBlend',apng_start+control(0,2,1,blend=2)+apng_default+apng_end),
    ('apngDefaultPartial',apng_start+control(0,1,1)+apng_default+apng_end),
])
invalid_source = '''//! PNG malformed-input contracts: framing, integrity, bounds and sample validity.
import png
import png_decode { PngError }
import image { Image, ImageError }
import silk.collections.slice { Slice }
import silk.core.effect { Effect }
import silk.core.result { Result }
import silk.mem.allocator { Allocator, OutOfMemoryError }
import silk.testing.testing { Testing, AssertionError }

effect fn rejects(data: &[u8]) -> ()
  ! OutOfMemoryError | AssertionError<'static>
  ? &mut Allocator {
  let result = run Effect.result(png.decode(data))
  let rejected = match &result {
    Result<Image, PngError | ImageError | OutOfMemoryError>.Success { value } => false
    Result<Image, PngError | ImageError | OutOfMemoryError>.Failure { error } => match &error {
      PngError problem => true
      ImageError problem => true
      OutOfMemoryError problem => { fail OutOfMemoryError {} }
    }
  }
  run Testing.expect(rejected, "invalid PNG is rejected without a partial image")
}
'''
for name,data in bad:
    invalid_source += f'''
test effect fn {name}() -> () ! OutOfMemoryError | AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run rejects({literal(data)}) |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
invalid_source += f'''
effect fn allTruncations() -> () ! OutOfMemoryError | AssertionError<'static> ? &mut Allocator {{
  let data = {literal(valid)}
  let mut length: usize = 0
  while length < data.length {{
    run rejects(Slice.view<u8>(data, 0, length))
    length = length + 1
  }}
}}
test effect fn truncatedAtEveryByte() -> () ! OutOfMemoryError | AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run allTruncations() |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
target = Path(__file__).resolve().parents[1].joinpath('src/png_invalid_tests.silk')
target.write_text(invalid_source)
subprocess.run(['silk','format',str(target)],check=True)

profile = bytearray(132)
profile[:4] = struct.pack('>I', len(profile))
profile[16:20] = b'RGB '
profile[36:40] = b'acsp'
metadata_chunks = (chunk(b'gAMA', struct.pack('>I',45455))
                   + chunk(b'cHRM', struct.pack('>8I',31270,32900,64000,33000,30000,60000,15000,6000))
                   + chunk(b'sRGB', b'\x02'))
metadata_png = png(8,6,b'\xff\0\0\xff\0\xff\0\xff',metadata_chunks)
icc_png = png(8,2,b'\xff\0\0\0\xff\0',chunk(b'iCCP',b'fixture\0\0'+zlib.compress(profile)))
metadata_source = '''//! PNG color metadata is preserved for the color-management consumer.
import png
import png_decode { PngError, Chromaticities }
import image { ImageError }
import silk.core.option { Option }
import silk.core.effect { Effect }
import silk.mem.allocator { Allocator, OutOfMemoryError }
import silk.testing.testing { Testing, AssertionError }
'''
metadata_source += f'''
effect fn metadata() -> () ! PngError | ImageError | OutOfMemoryError | AssertionError<'static> ? &mut Allocator {{
  let decoded = run png.decodeWithMetadata({literal(metadata_png)})
  run Testing.expect(match &decoded.metadata.gamma {{ Option<u32>.Some {{ value }} => value == 45455 _ => false }}, "gamma stored in PNG integer units")
  run Testing.expect(match &decoded.metadata.srgbIntent {{ Option<u8>.Some {{ value }} => value == 2 _ => false }}, "sRGB rendering intent")
  run Testing.expect(match &decoded.metadata.chromaticities {{
    Option<Chromaticities>.Some {{ value }} => value.whiteX == 31270 && value.redX == 64000 && value.greenY == 60000 && value.blueY == 6000
    _ => false
  }}, "chromaticity coordinates retained")
  let icc = run png.decodeWithMetadata({literal(icc_png)})
  let bytes = icc.metadata.iccProfile.asSlice()
  run Testing.expect(bytes.length == 132 && bytes[36] == 97 && bytes[39] == 112, "ICC profile decompressed and retained")
}}
test effect fn retainsColorMetadata() -> () ! PngError | ImageError | OutOfMemoryError | AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run metadata() |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
target = Path(__file__).resolve().parents[1].joinpath('src/png_metadata_tests.silk')
target.write_text(metadata_source)
subprocess.run(['silk','format',str(target)],check=True)
