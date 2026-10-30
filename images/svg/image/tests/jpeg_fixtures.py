from pathlib import Path
import io
from PIL import Image
p=Path('images/svg/image/tests/jpeg')
files=[]
for name,mode,color,progressive,orientation in [('baselineGray','L',128,False,1),('progressiveGray','L',128,True,1),('baselineRgb','RGB',(180,50,90),False,1),('progressiveRgb','RGB',(180,50,90),True,1),('orientedRgb','RGB',(180,50,90),False,6)]:
 im=Image.new(mode,(9,7),color);e=Image.Exif();e[274]=orientation;buf=io.BytesIO();im.save(buf,format='JPEG',quality=95,progressive=progressive,exif=e);data=buf.getvalue();(p/(name+'.jpg')).write_bytes(data);files.append((name,data,progressive,orientation,1 if mode=='L' else 3))
def literal(data):return 'b"'+''.join(f'\\x{b:02x}' for b in data)+'"'
s='''//! JPEG marker/frame metadata from independently encoded fixtures.
import jpeg
import jpeg_header { JpegError }
import image { ImageError }
import silk.testing.testing { Testing, AssertionError }
'''
for name,data,progressive,orientation,components in files:
 s+=f'''
test effect fn {name}() -> () ! JpegError | ImageError | AssertionError<'static> {{
  let header = run jpeg.inspect({literal(data)})
  run Testing.expect(header.width == 9 && header.height == 7, "frame dimensions")
  run Testing.expect(header.progressive == {str(progressive).lower()}, "sequential/progressive frame marker")
  run Testing.expect(header.orientation == {orientation}, "EXIF orientation retained")
  run Testing.expect(header.componentCount == {components} && header.jfif, "component count and JFIF declaration")
}}
'''
Path('images/svg/image/src/jpeg_header_tests.silk').write_text(s)
from pathlib import Path
p=Path('images/svg/image/tests/jpeg/baselineRgb.jpg');valid=p.read_bytes();sof=valid.index(b'\xff\xc0');sos=valid.index(b'\xff\xda');header_end=sos+2+int.from_bytes(valid[sos+2:sos+4],'big')
def change(at,value):
 data=bytearray(valid);data[at]=value;return bytes(data)
bad=[('zeroSampling',change(sof+11,0)),('unknownScanComponent',change(sos+5,99)),('invalidHuffmanSelector',change(sos+6,0x44)),('emptyScan',change(sos+4,0)),('duplicateComponent',change(sof+13,valid[sof+10]))]
def literal(data):return 'b"'+''.join(f'\\x{b:02x}' for b in data)+'"'
s='''//! JPEG header rejection before entropy decoding.
import jpeg
import jpeg_header { Header, JpegError }
import image { ImageError }
import silk.collections.slice { Slice }
import silk.core.effect { Effect }
import silk.core.result { Result }
import silk.testing.testing { Testing, AssertionError }
effect fn rejects(data: &[u8]) -> () ! AssertionError<'static> {
  let result = run Effect.result(jpeg.inspect(data))
  let rejected = match &result {
    Result<Header, JpegError | ImageError>.Success { value } => false
    Result<Header, JpegError | ImageError>.Failure { error } => true
  }
  run Testing.expect(rejected, "malformed JPEG header rejected")
}
'''
for name,data in bad:s+=f'\ntest effect fn {name}() -> () ! AssertionError<\'static> {{ run rejects({literal(data)}) }}\n'
s+=f'''
test effect fn truncatedHeaders() -> () ! AssertionError<'static> {{
  let data = {literal(valid)}
  let mut length: usize = 0
  while length < {header_end} {{
    run rejects(Slice.view<u8>(data,0,length))
    length = length + 1
  }}
}}
'''
Path('images/svg/image/src/jpeg_invalid_tests.silk').write_text(s)
