# font-shape

Text shaping for Silk: it turns a string and a font into positioned glyphs. It is a native
port of [harfrust](https://github.com/harfbuzz/harfrust) (itself a Rust port of HarfBuzz),
pinned at [`1503ff0`](https://github.com/harfbuzz/harfrust/tree/1503ff054384cc1d6a701b5ffbdc2f24118a2790),
built on [font-parse](../parse) and [text-ucd](../../text/ucd). There is no Rust, C, FFI or
subprocess anywhere in the library.

## What it shapes

- OpenType GSUB and GPOS, including contextual, chained and variation lookups, GDEF classes
  and the 24-bit extended formats.
- The complex-script shapers: Arabic and Syriac joining, Hebrew, Hangul, Indic, Khmer,
  Myanmar, Thai and Lao, and the Universal Shaping Engine.
- Apple Advanced Typography: `morx`, `mort`, `kerx`, `kern` and `trak`.
- Normalization, fallback mark positioning and fallback substitutions.
- Features with ranges, variation coordinates, all four directions and all cluster levels.
- Reusable shape plans, custom font callbacks (`FontFuncs`) and step-by-step tracing.
- HarfBuzz's text serialization formats.

## Example

```silk
import harfrust.lib { Buffer, GlyphPosition, ShaperData, ShapeError, ShapeOptions, shape }
import read_fonts.lib { FontRef }
import silk.core.option { Option }
import silk.core.result { Result }
import silk.mem.allocator { Allocator, OutOfMemoryError }

/// Shapes `text` with `font` and returns the total horizontal advance in font units.
pub effect fn advance<'a>(font: &FontRef<'a>, text: string) -> i32
  ! OutOfMemoryError
  ? &mut Allocator {
  let data = ShaperData.new(font)
  let shaper = ShaperData.shaper(&data)
  let mut buffer = Buffer.new()
  run Buffer.pushStr(&mut buffer, text)
  Buffer.guessSegmentProperties(&mut buffer)
  if let Result<(), ShapeError>.Failure { error: _ } = run shape(&shaper, &mut buffer, ShapeOptions.new()) {
    return 0
  }
  let positions = Buffer.glyphPositions(&buffer)
  let mut total: i32 = 0
  let mut i: usize = 0
  while i < positions.len() {
    if let Option<GlyphPosition>.Some { value } = positions.get(i) {
      total = total + value.xAdvance
    }
    i = i + 1
  }
  return total
}
```

`Buffer.glyphInfos` gives the glyph IDs and clusters. A buffer can be cleared and reused, and
it keeps its capacity. Malformed layout tables are skipped instead of trapping, and
allocation goes through the `Allocator` effect. The [API notes](docs/api.md) cover plans,
variations, scaling, custom callbacks, tracing and serialization.

The package is still imported as `harfrust` by its dependents, so the dependency key in their
manifests is `harfrust`.

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `font/shape` | `font-shape` | The shaping library |
| `font/shape/cli` | `font-shape-cli` | Command-line shaper and the runner for the pinned test suite |
| `font/shape/wasm` | `font-shape-wasm` | WebAssembly build with a typed JavaScript wrapper ([README](wasm/README.md)) |

`font/shape/test-data/harfrust` is the pinned harfrust checkout. It supplies the test fonts
and expectations and is never modified.

The CLI takes a font and text and prints the glyph string:

```sh
build/llvm/x86_64-unknown-linux-gnu/release/font-shape-cli font.ttf 'office' --features=-liga
build/llvm/x86_64-unknown-linux-gnu/release/font-shape-cli font.ttf --text-file=text.txt --direction=rtl --script=Arab
```

It accepts the shaping and serialization options the upstream suite uses, including
`--variations`, `--font-size`, `--face-index` and `--trace`.

## Tests

All 6,090 data-driven cases of the pinned suite pass, with no skip list. The 129 cases that
need Apple system fonts are excluded. From the repository root:

```sh
silk test --release --manifest-path font/shape/silk.toml --root src/tests.silk
silk build --release --manifest-path font/shape/cli/silk.toml
build/llvm/x86_64-unknown-linux-gnu/release/font-shape-cli --suite font/shape/tests/shaping.bin
build/llvm/x86_64-unknown-linux-gnu/release/font-shape-cli --regressions
font/scripts/check-shaping-trace
font/scripts/check-shaping-malformed
```

These run in the `font` CI workflow. Every week the same workflow also compares all cases
against the pinned Rust harfrust, mutates every corpus font, and runs the benchmarks.
[Validation](docs/validation.md) has the details.

## Performance

`font/scripts/bench-shaping` runs harfrust's own benchmark workloads in both implementations
and checks that their glyph output matches. On 2026-10-29 (Silk dev.29, release builds), Silk
took **0.89×** Rust's wall time and **0.85×** its instruction count, as geometric means over
seven workloads. Every workload except Roboto with long Latin text, which is at parity
(1.01× wall), was faster than Rust.

[Performance history](docs/performance.md) records how the port got there from 11.25×.

## Differences from harfrust

No glyph differences are known on the pinned suite. The API is native Silk rather than a
transliteration: `ShaperData` borrows the font bytes, and custom font functions are interface
implementations, not closures. [Differences](docs/differences.md) lists the rest.

## License

[MIT](LICENSE), keeping harfrust's HarfBuzz and rustybuzz notices. The pinned fonts and Unicode
data keep their own licenses.
