# font-shape-wasm

[font-shape](..) and [font-parse](../../parse) glyph outlines, built for
`wasm32-unknown-unknown`, with a TypeScript wrapper in `js/`. A web page can shape text and
draw the glyphs without any native code.

Build and test from the repository root:

```sh
font/scripts/build-wasm                      # writes font/shape/wasm/js/dist/harfrust.wasm
cd font/shape/wasm/js && npm ci && npm test  # compares against native font-shape-cli output
```

Linking needs `wasm-ld` on `PATH`.

## JavaScript

```ts
import { Harfrust } from 'harfrust-wasm'

const harfrust = await Harfrust.instantiate(new URL('harfrust.wasm', import.meta.url))
const font = harfrust.font(new Uint8Array(await (await fetch('Amiri.ttf')).arrayBuffer()))
const { glyphs, outlines } = font.shape('بِسْمِ', {
  features: ['-liga'],
  variations: { wght: 600 },
  outlines: true,
})
```

`glyphs` holds glyph ids, UTF-8 byte clusters, advances and offsets in font units, in visual
order. `outlines` maps glyph ids to SVG path data (font units, y up). `harfrust-wasm/effect`
wraps the same calls in an Effect `Shaper` service with tagged errors.

## Module interface

The module keeps no state between calls, so it has no allocation or handle exports. Each export
takes the byte lengths of its inputs; the module allocates them and calls the import
`host.input(slot, pointer, length)` for the host to copy each one in. Results come back through
`host.output(kind, pointer, byteLength)`, valid only during that call. Both exports return 0 on
success, or 1 invalid font, 2 invalid UTF-8, 3 invalid feature string, 4 shaping failed, 5 out of
memory.

- `hr_font_info(fontLength, faceIndex)` outputs kind 2: i32 units per em, ascender, descender,
  line gap, glyph count, axis count, then per axis its tag and 16.16 minimum, default, maximum.
- `hr_shape(fontLength, faceIndex, textLength, featuresLength, variationsLength,
  directionLength, scriptLength, languageLength, flags)` reads slots 0 font, 1 UTF-8 text,
  2 comma-separated features, 3 little-endian `(tag: u32, value: f32)` pairs, 4 direction,
  5 script, 6 language. It outputs kind 0 (i32 direction, script tag, then six i32 per glyph:
  id, cluster, x/y advance, x/y offset), kind 1 once per distinct glyph when flag 1 is set
  (f32 glyph id then path commands: 0 move x y, 1 line x y, 2 quad, 3 cubic, 4 close), kind 3
  newline-separated glyph names when flag 2 is set, and kind 4 the normalized coordinates as
  i32 F2Dot14 bits.

The module also imports `math.sin`, `math.cos`, `math.tan` and `math.hypot` (f64), because
font-parse calls libm's `sinf`, `cosf`, `tanf` and `hypotf` for COLR transforms and the
standalone wasm runtime links no C library. `src/libm.silk` forwards them to the host.
