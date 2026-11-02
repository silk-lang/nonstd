# font-raster

The glyph cache for UI text. Glyph outlines from [font-outline](../outline) are filled by
[graphics-vector](../../graphics/vector) once per key and kept in
[graphics-atlas](../../graphics/atlas) tiles, so a frame of text costs one lookup per glyph.
Text is unhinted: glyphs are positioned at a quarter of a device pixel horizontally and corrected
for gamma and contrast when they are blended.

- `key.GlyphKey` identifies a glyph's pixels: font instance, glyph id, size in logical pixels,
  scale factor, subpixel x variant (`SUBPIXEL_VARIANTS` = 4) and whether the color rendering is
  wanted. `key.PenPosition.of(x, y)` splits a device-space pen position into the whole pixel a
  tile is placed from and its variant (error at most 1/8 px horizontally; baselines snap to
  whole pixels).
- `face.FontFace` reads a font instance once (outline tables, units per em, glyph count) and is
  passed to each lookup. Its `id` is the key's `font`.
- `rasterize.GlyphRasterizer` draws an outline in device pixels, fills it with the nonzero rule
  and crops it to the covered pixels (`GlyphImage`: A8 bytes plus the offset from the pen).
- `cache.GlyphCache.glyph(atlas, face, key)` returns a `RasterGlyph` (tile and offset from the
  pen), rasterizing on a miss and queueing the pixels in `uploads()` for the renderer to copy
  into its texture. The atlas is borrowed per call so icons and images can share it. A glyph
  whose tile the atlas evicted is rasterized again on its next lookup; `prune(atlas)` drops such
  entries early. Spaces and glyphs with no outline are cached as `None`.
- `lines.LineCache` caches shaped lines from [font-shape](../shape) in font units, keyed by font
  instance and text. A line not used in the previous frame or the current one is dropped at
  `beginFrame`.
- `gamma.TextGamma` is the CPU reference of the text shader's gamma and contrast correction
  (GPUI's, from Windows Terminal): gamma 1.8 and contrast 1.0 by default.

Drawing a run of text:

```silk
drop atlas.beginFrame()
drop run lines.beginFrame()
let line = run lines.shape(&shaper, face.id, "Hello")
let perUnit = face.scaleFor(f32.toF64(size) * f32.toF64(scale))
let glyphs = lines.glyphs(line)
let mut x = origin.x
let mut i: usize = 0
while i < glyphs.length {
  let glyph = glyphs[i]
  let pen = PenPosition.of(x + i32.toF64(glyph.xOffset) * perUnit, origin.y - i32.toF64(glyph.yOffset) * perUnit)
  let key = GlyphKey { font: face.id, glyph: glyph.glyph, size: size, scale: scale, subpixel: pen.subpixel, color: false }
  if let Option<RasterGlyph>.Some { value } = run cache.glyph(&mut atlas, &face, key) {
    // A sprite at (pen.x + value.left, pen.y + value.top), value.width() x value.height(),
    // sampling value.tile.
  }
  x = x + i32.toF64(glyph.xAdvance) * perUnit
  i = i + 1
}
// Copy cache.uploads() into the atlas textures, then cache.clearUploads().
```

Color glyphs (COLR, CBDT, sbix into polychrome tiles) are not drawn yet: a key with `color: true`
currently gets the outline.

## Tests

```sh
silk test --manifest-path font/raster/silk.toml --root src/tests.silk
```

The tests use the Noto subsets in `images/svg/tests/fonts`. They check that each tile equals a
direct `vector` fill of the same outline at the same position (within 1/255, from f32 rounding at
different coordinates), that variants move a stem by a quarter pixel, cache hits, empty glyphs,
eviction and re-rasterization, a full atlas, the line cache against direct shaping, the gamma
formula against GPUI's values, and two text goldens (`tests/golden/text-1x.pgm` and
`text-2x.pgm`, raw coverage). Each golden run writes its output to `build/font-raster/`; after a
deliberate change, inspect it and copy it over the golden.
