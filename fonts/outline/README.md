# font-outline

Glyph outlines for Silk: reads `glyf` (with `gvar` variations), `CFF` or `CFF2` through
[font-parse](../parse) and draws each glyph into any `PathSink`.

- `outline.Outlines` loads a font's outline tables once and draws glyphs at variation
  coordinates.
- `outline.Recorder` writes flat `f32` commands (an `Op` code, then its coordinates). The SVG
  text layout and the WebAssembly shaping exports use it.
- `vector_path.PathRecorder` writes into a [graphics-vector](../../graphics/vector) `Path`,
  scaled from font units (y up) to pixels (y down) around a pen position on the baseline.

```sh
silk test --manifest-path fonts/outline/silk.toml --root src/tests.silk
```
