"""Generate progressive scan regression fixtures with independent libjpeg encoding."""
from pathlib import Path
from io import BytesIO
from PIL import Image

root = Path(__file__).resolve().parents[1]
def literal(data):
    return 'b"' + ''.join(f'\\x{b:02x}' for b in data) + '"'

source = '''//! Progressive reconstruction agrees with sequential coding of the same coefficients.
import jpeg
import jpeg_header { JpegError }
import image { ImageError }
import silk.core.effect { Effect }
import silk.mem.allocator { Allocator, OutOfMemoryError }
import silk.testing.testing { Testing, AssertionError }
'''
for mode, sampling, restart in [('L', 0, 0), ('L', 0, 1), ('RGB', 0, 0), ('RGB', 1, 2), ('RGB', 2, 1)]:
    name = f'progressive{mode}{sampling}Restart{restart}'
    image = Image.new(mode, (23, 19))
    image.putdata([(x*11+y*17)%256 if mode == 'L' else ((x*11+y*17)%256, (x*7+y*3)%256, (x*13+y*19)%256) for y in range(19) for x in range(23)])
    encoded = []
    for progressive in (False, True):
        output = BytesIO()
        image.save(output, format='JPEG', quality=91, progressive=progressive, subsampling=sampling, restart_marker_blocks=restart)
        encoded.append(output.getvalue())
    (root/'tests/jpeg'/f'{name}.jpg').write_bytes(encoded[1])
    source += f'''
effect fn {name}Body() -> () ! JpegError | ImageError | OutOfMemoryError | AssertionError<'static> ? &mut Allocator {{
  let sequential = run jpeg.decode({literal(encoded[0])})
  let progressive = run jpeg.decode({literal(encoded[1])})
  run Testing.expect(progressive.width() == 23 && progressive.height() == 19, "partial MCU dimensions")
  let expected = sequential.data()
  let actual = progressive.data()
  let mut i: usize = 0
  while i < expected.length {{
    run Testing.expect(actual[i] == expected[i], "progressive scans reconstruct identical sequential coefficients")
    i = i + 1
  }}
}}
test effect fn {name}() -> () ! JpegError | ImageError | OutOfMemoryError | AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run {name}Body() |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
(root/'src/jpeg_progressive_scan_tests.silk').write_text(source)

# Hand-assembled T.81 stream: each component occupies a separate sequential scan.
# One-symbol DC/AC tables encode zero difference and EOB as a single zero bit each.
def segment(marker, payload):
    return bytes([255, marker]) + (len(payload)+2).to_bytes(2, 'big') + payload
quant = segment(219, bytes([0]) + bytes([1])*64)
counts = bytes([1]) + bytes(15)
huffman = segment(196, bytes([0])+counts+bytes([0])+bytes([16])+counts+bytes([0]))
frame = segment(192, bytes([8,0,7,0,9,3,1,0x22,0,2,0x11,0,3,0x11,0]))
separate = b'\xff\xd8'+quant+frame+huffman
for component, entropy in [(1, b'\x0f'),(2,b'\x3f'),(3,b'\x3f')]:
    separate += segment(218, bytes([1,component,0,0,63,0])) + entropy
separate += b'\xff\xd9'
source += f'''
effect fn separateBody() -> () ! JpegError | ImageError | OutOfMemoryError | AssertionError<'static> ? &mut Allocator {{
  let decoded = run jpeg.decode({literal(separate)})
  let pixels = decoded.data()
  let mut i: usize = 0
  while i < pixels.length {{
    run Testing.expect(pixels[i] == 128 && pixels[i+1] == 128 && pixels[i+2] == 128 && pixels[i+3] == 255, "separate sequential components")
    i = i + 4
  }}
}}
test effect fn separateSequentialScans() -> () ! JpegError | ImageError | OutOfMemoryError | AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run separateBody() |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
(root/'src/jpeg_progressive_scan_tests.silk').write_text(source)

valid = (root/'tests/jpeg/progressiveL0Restart1.jpg').read_bytes()
first = valid.index(b'\xff\xda')
length = int.from_bytes(valid[first+2:first+4], 'big')
parameter = first+length+1
bad = bytearray(valid)
bad[parameter] = 0x10
source = '''//! Malformed progressive scans must fail without yielding a partial image.
import jpeg
import jpeg_header { JpegError }
import image { Image, ImageError }
import silk.collections.slice { Slice }
import silk.core.effect { Effect }
import silk.core.result { Result }
import silk.mem.allocator { Allocator, OutOfMemoryError }
import silk.testing.testing { Testing, AssertionError }
effect fn rejects(data: &[u8]) -> () ! AssertionError<'static> ? &mut Allocator {
  let result = run Effect.result(jpeg.decode(data))
  let rejected = match &result {
    Result<Image, JpegError | ImageError | OutOfMemoryError>.Success { value } => false
    Result<Image, JpegError | ImageError | OutOfMemoryError>.Failure { error } => true
  }
  run Testing.expect(rejected, "malformed progressive stream rejected")
}
'''
mutations = [('refinementBeforeFirstScan', bytes(bad))]
bad = bytearray(valid);bad[parameter-1] = 63
mutations.append(('dcScanWithAcBand', bytes(bad)))
rst = valid.index(b'\xff\xd0')
bad = bytearray(valid);bad[rst+1]=0xd2
mutations.append(('wrongProgressiveRestart',bytes(bad)))
for name, data in mutations:
    source += f'''
test effect fn {name}() -> () ! AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run rejects({literal(data)}) |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
source += f'''
test effect fn everyProgressiveTruncation() -> () ! AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  let data = {literal(valid)}
  let mut length: usize = 0
  while length < data.length {{
    run rejects(Slice.view<u8>(data, 0, length)) |> Effect.provideMut<Allocator>(&mut allocator)
    length = length + 1
  }}
}}
'''
(root/'src/jpeg_progressive_invalid_tests.silk').write_text(source)

if __name__ == '__main__':
    import subprocess
    subprocess.run(['silk','format',str(root/'src/jpeg_progressive_scan_tests.silk'),str(root/'src/jpeg_progressive_invalid_tests.silk')], check=True)
