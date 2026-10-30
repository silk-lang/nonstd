#!/usr/bin/env python3
"""Source colour management probes: embedded ICC profiles and PNG gAMA/cHRM.

Profiles are crafted here byte by byte (ICC.1:2022 §7, §10). Expected colours come
from an independent double-precision evaluation of the matrix/TRC model (§F.3)
with the sRGB encoding (IEC 61966-2-1), in the same operation order as the renderer,
and are written as rectangles in the reference SVGs. Needs Pillow for the JPEG case.
"""
import base64
from io import BytesIO
import json
import math
from pathlib import Path
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1] / 'tests/fixtures/color'
D50 = (0.964202880859375, 1.0, 0.8249053955078125)
SRGB_COLORANTS = [0.4360747, 0.3850649, 0.1430804,
                  0.2225045, 0.7168786, 0.0606169,
                  0.0139322, 0.0971045, 0.7141733]
SPEC_ICC = 'https://www.color.org/specification/ICC.1-2022-05.pdf#page=115'  # Annex F.2, F.3
SPEC_EMBED = 'https://www.color.org/specification/ICC.1-2022-05.pdf#page=97'  # Annex B

# Samples: primaries, secondaries, a gray ramp and mid colours.
PIXELS = [(255, 0, 0), (0, 255, 0), (0, 0, 255), (255, 255, 255),
          (128, 128, 128), (64, 32, 200), (10, 240, 90), (0, 0, 0)]


# ---- ICC profile writing ---------------------------------------------------

def s15(value):
    return struct.pack('>i', round(value * 65536))


def xyz_tag(x, y, z):
    return b'XYZ \0\0\0\0' + s15(x) + s15(y) + s15(z)


def curv(values):
    if isinstance(values, float):
        return b'curv\0\0\0\0' + struct.pack('>IH', 1, round(values * 256)) + b'\0\0'
    body = b'curv\0\0\0\0' + struct.pack('>I', len(values)) + b''.join(struct.pack('>H', v) for v in values)
    return body + b'\0' * (-len(body) % 4)


def para(kind, params):
    return b'para\0\0\0\0' + struct.pack('>HH', kind, 0) + b''.join(s15(p) for p in params)


def profile(space, tags):
    entries = []
    offset = 128 + 4 + 12 * len(tags)
    data = b''
    for name, body in tags:
        entries.append(name + struct.pack('>II', offset + len(data), len(body)))
        data += body
        data += b'\0' * (-len(data) % 4)
    size = 128 + 4 + 12 * len(tags) + len(data)
    header = struct.pack('>I', size) + b'none' + b'\x02\x40\0\0' + b'mntr' + space + b'XYZ '
    header += b'\0' * 12 + b'acsp' + b'\0' * (128 - 40)
    header = header[:68] + s15(D50[0]) + s15(D50[1]) + s15(D50[2]) + header[80:]
    return header + struct.pack('>I', len(tags)) + b''.join(entries) + data


def rgb_profile(colorants, curves):
    r, g, b = colorants
    return profile(b'RGB ', [(b'rXYZ', xyz_tag(*r)), (b'gXYZ', xyz_tag(*g)), (b'bXYZ', xyz_tag(*b)),
                             (b'rTRC', curves[0]), (b'gTRC', curves[1]), (b'bTRC', curves[2])])


# ---- Independent evaluation (mirrors images/svg/image/src/icc.silk) --------

def read16(d, o):
    return d[o] * 256 + d[o + 1]


def read32(d, o):
    return d[o] * 16777216 + d[o + 1] * 65536 + read16(d, o + 2)


def fixed(d, o):
    raw = read32(d, o)
    m = raw / 65536.0
    return m - 65536.0 if raw >= 2147483648 else m


def find(d, name):
    for i in range(read32(d, 128)):
        e = 132 + i * 12
        if d[e:e + 4] == name:
            return read32(d, e + 4), read32(d, e + 8)
    return None


def clamp(v):
    return 0.0 if v != v or v <= 0.0 else 1.0 if v >= 1.0 else v


def power(b, e):
    return 0.0 if b <= 0.0 else math.pow(b, e)


def evaluate(d, name, x):
    o, size = find(d, name)
    if d[o:o + 4] == b'curv':
        n = read32(d, o + 8)
        if n == 0:
            return x
        if n == 1:
            return power(x, read16(d, o + 12) / 256.0)
        p = x * float(n - 1)
        i = int(math.floor(p))
        if i >= n - 1:
            i = n - 2
        lo = read16(d, o + 12 + i * 2) / 65535.0
        hi = read16(d, o + 14 + i * 2) / 65535.0
        return clamp(lo + (hi - lo) * (p - float(i)))
    kind = read16(d, o + 8)
    count = [1, 3, 4, 5, 7][kind]
    ps = [fixed(d, o + 12 + 4 * k) for k in range(count)]
    g = ps[0]
    a = ps[1] if count > 1 else 1.0
    b = ps[2] if count > 2 else 0.0
    c = ps[3] if count > 3 else 0.0
    dd = ps[4] if count > 4 else 0.0
    e = ps[5] if count > 5 else 0.0
    f = ps[6] if count > 6 else 0.0
    if kind == 0:
        v = power(x, g)
    elif kind == 1:
        v = power(a * x + b, g) if x >= -b / a else 0.0
    elif kind == 2:
        v = power(a * x + b, g) + c if x >= -b / a else c
    elif kind == 3:
        v = power(a * x + b, g) if x >= dd else c * x
    else:
        v = power(a * x + b, g) + e if x >= dd else c * x + f
    return clamp(v)


def multiply(a, b):
    return [a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]
            for r in range(3) for c in range(3)]


def inverse(m):
    c0 = m[4] * m[8] - m[5] * m[7]
    c1 = m[5] * m[6] - m[3] * m[8]
    c2 = m[3] * m[7] - m[4] * m[6]
    det = m[0] * c0 + m[1] * c1 + m[2] * c2
    return [c0 / det, (m[2] * m[7] - m[1] * m[8]) / det, (m[1] * m[5] - m[2] * m[4]) / det,
            c1 / det, (m[0] * m[8] - m[2] * m[6]) / det, (m[2] * m[3] - m[0] * m[5]) / det,
            c2 / det, (m[1] * m[6] - m[0] * m[7]) / det, (m[0] * m[4] - m[1] * m[3]) / det]


PCS = inverse(SRGB_COLORANTS)


def srgb_decode(v):
    return v / 12.92 if v <= 0.04045 else math.pow((v + 0.055) / 1.055, 2.4)


def srgb_encode(v):
    v = clamp(v)
    e = v * 12.92 if v <= 0.0031308 else 1.055 * math.pow(v, 1.0 / 2.4) - 0.055
    return int(math.floor(clamp(e) * 255.0 + 0.5))


def icc_transform(d):
    """(tables, matrix) or None, as fromProfile."""
    space = d[16:20]
    if space == b'GRAY':
        t = [evaluate(d, b'kTRC', i / 255.0) for i in range(256)]
        w = [PCS[r * 3] * D50[0] + PCS[r * 3 + 1] * D50[1] + PCS[r * 3 + 2] * D50[2] for r in range(3)]
        return [t, t, t], [w[0], 0.0, 0.0, 0.0, w[1], 0.0, 0.0, 0.0, w[2]]
    if space != b'RGB ' or find(d, b'rXYZ') is None:
        return None
    cols = []
    for name in (b'rXYZ', b'gXYZ', b'bXYZ'):
        o, _ = find(d, name)
        cols.append([fixed(d, o + 8), fixed(d, o + 12), fixed(d, o + 16)])
    source = [cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1],
              cols[0][2], cols[1][2], cols[2][2]]
    tables = [[evaluate(d, n, i / 255.0) for i in range(256)] for n in (b'rTRC', b'gTRC', b'bTRC')]
    return tables, multiply(PCS, source)


def bradford(x, y, z):
    cone = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296]
    s = [cone[r * 3] * x + cone[r * 3 + 1] * y + cone[r * 3 + 2] * z for r in range(3)]
    t = [cone[r * 3] * D50[0] + cone[r * 3 + 1] * D50[1] + cone[r * 3 + 2] * D50[2] for r in range(3)]
    scale = [t[0] / s[0], 0.0, 0.0, 0.0, t[1] / s[1], 0.0, 0.0, 0.0, t[2] / s[2]]
    return multiply(inverse(cone), multiply(scale, cone))


def png_transform(gamma, chrm):
    matrix = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]
    if chrm is not None:
        wx_, wy_, rx, ry, gx, gy, bx, by = [v / 100000.0 for v in chrm]
        primary = [rx / ry, gx / gy, bx / by, 1.0, 1.0, 1.0,
                   (1.0 - rx - ry) / ry, (1.0 - gx - gy) / gy, (1.0 - bx - by) / by]
        wx = wx_ / wy_
        wz = (1.0 - wx_ - wy_) / wy_
        sv = inverse(primary)
        sr = sv[0] * wx + sv[1] + sv[2] * wz
        sg = sv[3] * wx + sv[4] + sv[5] * wz
        sb = sv[6] * wx + sv[7] + sv[8] * wz
        to_xyz = multiply(primary, [sr, 0.0, 0.0, 0.0, sg, 0.0, 0.0, 0.0, sb])
        matrix = multiply(PCS, multiply(bradford(wx, 1.0, wz), to_xyz))
    if gamma is not None:
        e = 100000.0 / gamma
        t = [power(i / 255.0, e) for i in range(256)]
    else:
        t = [srgb_decode(i / 255.0) for i in range(256)]
    return [t, t, t], matrix


def convert(transform, rgb):
    if transform is None:
        return rgb
    tables, m = transform
    lr, lg, lb = tables[0][rgb[0]], tables[1][rgb[1]], tables[2][rgb[2]]
    return (srgb_encode(m[0] * lr + m[1] * lg + m[2] * lb),
            srgb_encode(m[3] * lr + m[4] * lg + m[5] * lb),
            srgb_encode(m[6] * lr + m[7] * lg + m[8] * lb))


def identity(transform):
    for v in range(256):
        for probe in ((v, 0, 0), (0, v, 0), (0, 0, v), (v, v, v)):
            if convert(transform, probe) != probe:
                return False
    return True


def effective(transform):
    return None if transform is None or identity(transform) else transform


# ---- Images ----------------------------------------------------------------

def chunk(kind, body):
    return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))


def png(pixels, chunks=(), gray=False):
    if gray:
        rows = b'\0' + bytes(p[0] for p in pixels)
        header = struct.pack('>IIBBBBB', len(pixels), 1, 8, 0, 0, 0, 0)
    else:
        rows = b'\0' + bytes(c for p in pixels for c in p)
        depth = 6 if len(pixels[0]) == 4 else 2
        header = struct.pack('>IIBBBBB', len(pixels), 1, 8, depth, 0, 0, 0)
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
    for kind, body in chunks:
        out += chunk(kind, body)
    return out + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')


def iccp(data):
    return (b'iCCP', b'probe\0\0' + zlib.compress(data))


def url(data, mime='image/png'):
    return f'data:{mime};base64,' + base64.b64encode(data).decode()


def svg(width, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="1">' + body + '</svg>\n'


def hexcolor(rgb):
    return '#%02x%02x%02x' % tuple(rgb[:3])


def reference(pixels, transform):
    t = effective(transform)
    body = ''
    for x, p in enumerate(pixels):
        out = convert(t, p[:3])
        if len(p) == 4:
            # Premultiplied storage: straight samples are re-derived before conversion.
            a = p[3]
            pre = [(c * a + 127) // 255 for c in p[:3]]
            back = [min(255, (c * 255 + a // 2) // a) for c in pre]
            out = convert(t, back)
            body += (f'<rect x="{x}" width="1" height="1" fill="{hexcolor(out)}" '
                     f'fill-opacity="{a / 255!r}"/>')
            continue
        body += f'<rect x="{x}" width="1" height="1" fill="{hexcolor(out)}"/>'
    return body


# Profiles under test.
WIDE = [(0.6097, 0.3111, 0.0195), (0.2053, 0.6257, 0.0609), (0.1492, 0.0632, 0.7446)]
SRGB_COLS = [(SRGB_COLORANTS[0], SRGB_COLORANTS[3], SRGB_COLORANTS[6]),
             (SRGB_COLORANTS[1], SRGB_COLORANTS[4], SRGB_COLORANTS[7]),
             (SRGB_COLORANTS[2], SRGB_COLORANTS[5], SRGB_COLORANTS[8])]
SRGB_PARA = para(3, [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045])
PROFILES = {
    'srgb': rgb_profile(SRGB_COLS, [SRGB_PARA] * 3),
    'linear': rgb_profile(SRGB_COLS, [curv([])] * 3),
    'wide-gamma': rgb_profile(WIDE, [curv(2.19921875)] * 3),
    'table': rgb_profile(SRGB_COLS, [curv([0, 4000, 16000, 40000, 65535])] * 3),
    'parametric': rgb_profile(WIDE, [para(0, [1.8]), para(1, [2.2, 1.1, -0.1]),
                                     para(4, [2.4, 0.95, 0.05, 0.08, 0.04, 0.01, 0.002])]),
    'gray': profile(b'GRAY', [(b'kTRC', curv(1.0))]),
}


def lut_only():
    # A profile whose only transform is a lut16Type A2B0 tag (§10.11): left for LUT support.
    return profile(b'RGB ', [(b'A2B0', b'mft2\0\0\0\0' + bytes([3, 3, 2, 0]) + b'\0' * 36)])


def jpeg_with(icc):
    from PIL import Image
    out = BytesIO()
    Image.new('L', (4, 1), 128).save(out, format='JPEG', icc_profile=icc, quality=100)
    return out.getvalue()


def main():
    (ROOT / 'inputs').mkdir(parents=True, exist_ok=True)
    (ROOT / 'references').mkdir(exist_ok=True)
    cases = []

    def add(name, data, transform, reason, spec, pixels=PIXELS, mime='image/png'):
        width = len(pixels)
        image = (f'<image href="{url(data, mime)}" width="{width}" height="1" '
                 'style="image-rendering:optimizeSpeed"/>')
        (ROOT / 'inputs' / f'{name}.svg').write_text(svg(width, image))
        (ROOT / 'references' / f'{name}.svg').write_text(svg(width, reference(pixels, transform)))
        cases.append(dict(id='color-' + name, input=f'inputs/{name}.svg',
                          references=[dict(path=f'references/{name}.svg', relation='==')],
                          status='pass', reason=reason, spec=spec, tolerance={}))

    for key, data in PROFILES.items():
        if key == 'gray':
            continue
        add(f'icc-{key}', png(PIXELS, [iccp(data)]), icc_transform(data),
            f'PNG iCCP matrix/TRC profile ({key}) converted to sRGB; expected colours evaluated independently.',
            SPEC_ICC)
    gray_pixels = [(v, v, v) for v in (0, 32, 64, 128, 192, 255)]
    add('icc-gray', png(gray_pixels, [iccp(PROFILES['gray'])], gray=True), icc_transform(PROFILES['gray']),
        'Gray TRC profile (ICC.1:2022 F.2): luminance maps to the PCS white.', SPEC_ICC, gray_pixels)
    alpha_pixels = [(200, 40, 90, 128), (10, 250, 30, 64), (255, 255, 255, 255), (90, 90, 200, 1)]
    add('icc-alpha', png(alpha_pixels, [iccp(PROFILES['linear'])]), icc_transform(PROFILES['linear']),
        'Translucent samples convert their straight values; alpha is unchanged.', SPEC_ICC, alpha_pixels)
    add('icc-lut-unsupported', png(PIXELS, [iccp(lut_only())]), None,
        'LUT-only profiles are not evaluated yet (phase 12C); samples are left as sRGB.', SPEC_ICC)
    add('icc-malformed', png(PIXELS, [iccp(PROFILES['linear'][:100])]), None,
        'A truncated profile is ignored and the samples are treated as sRGB.', SPEC_ICC)
    add('icc-over-gama', png(PIXELS, [(b'gAMA', struct.pack('>I', 100000)), iccp(PROFILES['wide-gamma'])]),
        icc_transform(PROFILES['wide-gamma']), 'iCCP takes precedence over gAMA.', 'https://www.w3.org/TR/png-3/#11iCCP')
    add('gama', png(PIXELS, [(b'gAMA', struct.pack('>I', 100000))]), png_transform(100000, None),
        'gAMA alone: linear = sample^(100000/gAMA) with sRGB primaries ', 'https://www.w3.org/TR/png-3/#11gAMA')
    chrm = (31270, 32900, 64000, 33000, 30000, 60000, 15000, 6000)
    wide_chrm = (34570, 35850, 73470, 26530, 15950, 84270, 3660, 100)
    add('gama-chrm', png(PIXELS, [(b'gAMA', struct.pack('>I', 55556)), (b'cHRM', struct.pack('>8I', *wide_chrm))]),
        png_transform(55556, wide_chrm), 'gAMA with cHRM: primaries and white adapted to D50 with Bradford.', 'https://www.w3.org/TR/png-3/#11cHRM')
    add('chrm-srgb', png(PIXELS, [(b'cHRM', struct.pack('>8I', *chrm))]), png_transform(None, chrm),
        'cHRM with sRGB primaries and no gAMA keeps sRGB samples.', 'https://www.w3.org/TR/png-3/#11cHRM')
    add('srgb-over-gama', png(PIXELS, [(b'sRGB', b'\0'), (b'gAMA', struct.pack('>I', 100000))]), None,
        'An sRGB chunk overrides gAMA and cHRM.', 'https://www.w3.org/TR/png-3/#11sRGB')
    jpeg_pixels = [(128, 128, 128)] * 4
    add('jpeg-icc', jpeg_with(PROFILES['linear']), icc_transform(PROFILES['linear']),
        'JPEG APP2 ICC_PROFILE (ICC.1:2022 Annex B); uniform gray 128 survives the DCT exactly.',
        SPEC_EMBED, jpeg_pixels, 'image/jpeg')

    (ROOT / 'manifest.json').write_text(json.dumps(dict(version=1, suite='own', mode='reference', cases=cases),
                                                   indent=2) + '\n')
    for c in cases:
        print(c['id'])


if __name__ == '__main__':
    main()
