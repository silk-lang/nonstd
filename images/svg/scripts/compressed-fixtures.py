#!/usr/bin/env python3
"""Original compressed-document vectors using Python's independent zlib encoder."""
from pathlib import Path
import base64
import gzip
import subprocess
import zlib
root = Path(__file__).resolve().parents[1]
xml = b"<svg xmlns='http://www.w3.org/2000/svg'><rect id='p' width='2' height='1'/></svg>"
def literal(data): return 'b"'+''.join(f'\\x{b:02x}' for b in data)+'"'
packed = gzip.compress(xml,mtime=0)
s='''//! SVG 1.1 G.7 #ConformingSVGViewers, RFC 1950 §2.2 and RFC 1952 §2.3.1.
import structure { Graph, Options, StructureError, build }
import resources { Resolver, DataOnly, Limits as ResourceLimits }
import url { Url, UrlError }
import silk.core.effect { Effect }
import silk.core.result { Result }
import silk.mem.allocator { Allocator, OutOfMemoryError }
import silk.testing.testing { Testing, AssertionError }
effect fn source(data: &[u8], maximum: usize) -> Graph ! StructureError | UrlError | OutOfMemoryError ? &mut Allocator {
  let base = run Url.parseAbsolute(b"file:///fixtures/input.svgz")
  let mut host = DataOnly.make(ResourceLimits.defaults())
  let mut options = Options.defaults()
  options.limits.maxTotalBytes = maximum
  return run build(data, &base, &options) |> Effect.provideMut<Resolver>(&mut host)
}
effect fn valid(data: &[u8], documents: usize) -> () ! StructureError | UrlError | OutOfMemoryError | AssertionError<'static> ? &mut Allocator {
  let graph = run source(data, 67108864)
  run Testing.expect(graph.documents.length() == documents, "compressed documents parsed and referenced")
}
effect fn rejects(data: &[u8], maximum: usize, limit: bool) -> () ! AssertionError<'static> ? &mut Allocator {
  let result = run Effect.result(source(data,maximum))
  let rejected = match &result {
    Result<Graph, StructureError | UrlError | OutOfMemoryError>.Success { value } => false
    Result<Graph, StructureError | UrlError | OutOfMemoryError>.Failure { error } => match &error {
      StructureError value => if limit { value == StructureError.TooLarge } else { value == StructureError.InvalidXml }
      _ => false
    }
  }
  run Testing.expect(rejected, "invalid compression or bounded expansion rejected with the correct error")
}
'''
external=b"<svg xmlns='http://www.w3.org/2000/svg'><use href='data:image/svg+xml;base64,"+base64.b64encode(packed)+b"#p'/></svg>"
large=xml.replace(b'<rect',b'<!--'+b'A'*20000+b'--><rect')
cases=[('gzipRoot',packed,1),('zlibRoot',zlib.compress(xml),1),('gzipMembers',gzip.compress(xml[:30],mtime=0)+gzip.compress(xml[30:],mtime=0),1),('compressedDataReference',external,2),('streamingOutputChunks',gzip.compress(large,mtime=0),1)]
for name,data,count in cases:
 s+=f'''\ntest effect fn {name}() -> () ! StructureError | UrlError | OutOfMemoryError | AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run valid({literal(data)}, {count}) |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
bad=bytearray(packed);bad[-8]^=1
for name,data,maximum,limit in [('badCrc',bytes(bad),67108864,False),('truncatedTrailer',packed[:-1],67108864,False),('trailingGarbage',packed+b'x',67108864,False),('expansionLimit',packed,len(packed)+len(xml)-1,True),('externalExpansionLimit',external,len(external)+len(packed)+len(xml)-1,True)]:
 s+=f'''\ntest effect fn {name}() -> () ! AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run rejects({literal(data)}, {maximum}, {str(limit).lower()}) |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
(root/'src/compressed_document_tests.silk').write_text(s)
subprocess.run(['silk','format',str(root/'src/compressed_document_tests.silk')],check=True)
s += f'''
test effect fn exactExpansionBudget() -> () ! StructureError | UrlError | OutOfMemoryError | AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  let graph = run source({literal(packed)}, {len(packed)+len(xml)}) |> Effect.provideMut<Allocator>(&mut allocator)
  run Testing.expect(graph.documents.length() == 1, "exact encoded plus decoded budget accepted")
}}
'''
# Optional RFC 1952 fields and header CRC, followed by independently encoded DEFLATE/trailer.
header=b'\x1f\x8b\x08\x1e'+bytes(4)+b'\x00\xff'+b'\x03\x00abc'+b'input.svg\0'+b'original fixture\0'
optional=header+(zlib.crc32(header)&65535).to_bytes(2,'little')+packed[10:]
for name,data in [('gzipOptionalHeader',optional),('gzipUtf16',gzip.compress(xml.decode().encode('utf-16'),mtime=0))]:
 s+=f'''\ntest effect fn {name}() -> () ! StructureError | UrlError | OutOfMemoryError | AssertionError<'static> {{
  let mut allocator = Allocator.systemAllocatorProvider()
  run valid({literal(data)}, 1) |> Effect.provideMut<Allocator>(&mut allocator)
}}
'''
(root/'src/compressed_document_tests.silk').write_text(s)
subprocess.run(['silk','format',str(root/'src/compressed_document_tests.silk')],check=True)
