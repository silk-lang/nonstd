"""Original JPEG metadata regression vectors, assembled without decoder helpers."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
def literal(data):
    return 'b"'+''.join(f'\\x{b:02x}' for b in data)+'"'
def segment(marker, payload):
    return bytes([255, marker])+(len(payload)+2).to_bytes(2,'big')+payload
valid = (root/'tests/jpeg/orientedRgb.jpg').read_bytes()
sos = valid.index(b'\xff\xda')
with_xmp = valid[:sos]+segment(225,b'http://ns.adobe.com/xap/1.0/\0<xmp/>')+valid[sos:]
source = '''//! EXIF metadata must survive unrelated APP1 segments.
import jpeg
import jpeg_header { JpegError }
import image { ImageError }
import silk.testing.testing { Testing, AssertionError }
'''
source += f'''
test effect fn xmpDoesNotEraseOrientation() -> () ! JpegError | ImageError | AssertionError<'static> {{
  let header = run jpeg.inspect({literal(with_xmp)})
  run Testing.expect(header.orientation == 6, "unrelated APP1 retains EXIF orientation")
}}
'''
(root/'src/jpeg_metadata_tests.silk').write_text(source)
source += '''
import jpeg_metadata
import jpeg_metadata { Metadata }
import silk.core.effect { Effect }
import silk.core.result { Result }
import silk.mem.allocator { Allocator, OutOfMemoryError }
'''
def icc(index,count,data):
    return segment(226,b'ICC_PROFILE\0'+bytes([index,count])+data)
def image_with(parts):
    return valid[:sos]+b''.join(parts)+valid[sos:]
profile = b'opaque-profile-bytes-for-assembly'
parts = [icc(2,2,profile[9:]), segment(226,b'unrelated'), icc(1,2,profile[:9])]
source += f'''
effect fn assembledBody() -> () ! JpegError | ImageError | OutOfMemoryError | AssertionError<'static> ? &mut Allocator {{
  let decoded = run jpeg_metadata.decodeWithMetadata({literal(image_with(parts))})
  run Testing.expect(decoded.metadata.orientation == 6 && decoded.image.width() == 9 && decoded.image.height() == 7, "raw dimensions and orientation retained")
  let actual = decoded.metadata.iccProfile.asSlice()
  let expected = {literal(profile)}
  run Testing.expect(actual.length == expected.length, "all ICC chunks assembled")
  let mut i: usize = 0
  while i < expected.length {{
    run Testing.expect(actual[i] == expected[i], "chunk sequence controls assembly, not marker order")
    i = i + 1
  }}
}}
test effect fn reorderedProfileChunks() -> () ! JpegError | ImageError | OutOfMemoryError | AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run assembledBody() |> Effect.provideMut<Allocator>(&mut allocator)
}}
effect fn rejects(data: &[u8]) -> () ! AssertionError<'static> ? &mut Allocator {{
  let result = run Effect.result(jpeg_metadata.read(data))
  let rejected = match &result {{
    Result<Metadata, JpegError | ImageError | OutOfMemoryError>.Success {{ value }} => false
    Result<Metadata, JpegError | ImageError | OutOfMemoryError>.Failure {{ error }} => true
  }}
  run Testing.expect(rejected, "malformed ICC chunk framing rejected")
}}
'''
for name,parts in [('missingChunk',[icc(1,2,b'one')]),('duplicateChunk',[icc(1,1,b'one'),icc(1,1,b'one')]),('conflictingCount',[icc(1,2,b'one'),icc(2,3,b'two')]),('zeroSequence',[icc(0,1,b'one')]),('truncatedIccHeader',[segment(226,b'ICC_PROFILE\0')])]:
    source += f'''
test effect fn {name}() -> () ! AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run rejects({literal(image_with(parts))}) |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
(root/'src/jpeg_metadata_tests.silk').write_text(source)
import subprocess
subprocess.run(['silk','format',str(root/'src/jpeg_metadata_tests.silk')],check=True)
progressive = (root/'tests/jpeg/progressiveGray.jpg').read_bytes()
second_scan = progressive.index(b'\xff\xda', progressive.index(b'\xff\xda')+2)
trailing = progressive[:second_scan]+icc(1,1,profile)+progressive[second_scan:]
source += f'''
effect fn trailingProfileBody() -> () ! JpegError | ImageError | OutOfMemoryError | AssertionError<'static> ? &mut Allocator {{
  let decoded = run jpeg_metadata.decodeWithMetadata({literal(trailing)})
  run Testing.expect(decoded.metadata.iccProfile.asSlice().length == {len(profile)}, "APP2 between progressive scans retained")
}}
test effect fn profileBetweenScans() -> () ! JpegError | ImageError | OutOfMemoryError | AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run trailingProfileBody() |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
(root/'src/jpeg_metadata_tests.silk').write_text(source)
subprocess.run(['silk','format',str(root/'src/jpeg_metadata_tests.silk')],check=True)
