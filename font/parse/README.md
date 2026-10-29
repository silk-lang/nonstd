# font-parse

Font file parsing for Silk. It is a port of Google's
[read-fonts](https://github.com/googlefonts/fontations/tree/main/read-fonts), plus the parts of
[skrifa](https://github.com/googlefonts/fontations/tree/main/skrifa) that build a font model
on top of it. Parsing borrows the font bytes and never copies them. Malformed input is
reported as an error and never traps. It builds on [font-types](../types) and is what
[font-shape](../shape) and [images/svg](../../images/svg) read fonts with.

## What it reads

- **Containers:** sfnt files (`FontRef`), TrueType collections (`CollectionRef`), or either
  (`FileRef`).
- **Core tables:** `head`, `hhea`, `hmtx`, `maxp`, `name`, `OS/2`, `post`, `cmap`, `loca`,
  `glyf`, `vhea`, `vmtx`, `VORG`, `gasp`, `hdmx`, `meta`, `DSIG`.
- **Layout:** `GDEF`, `GSUB`, `GPOS`, `BASE`, `MATH`, `STAT`, with feature variations,
  conditions and glyph-set intersection.
- **Variations:** `fvar`, `avar`, `gvar`, `cvar`, `HVAR`, `VVAR`, `MVAR`, `VARC`, with item
  variation stores and delta sets.
- **AAT:** `morx`, `mort`, `kerx`, `kern`, `trak`, `ankr`, `feat`, `ltag`.
- **Color and bitmaps:** `COLR`, `CPAL`, `SVG `, `sbix`, `CBDT`/`CBLC`, `EBDT`/`EBLC`.
- **PostScript outlines:** `CFF ` and `CFF2`, with charstrings, subroutines, blending and
  hinting parameters.

Most table accessors are generated from fontations' codegen grammar. The `*_impl.silk`
files beside them add the handwritten parts.

On top of the tables, `read_fonts.model` provides a font model:

- character maps (`Charmap`), including batched lookups;
- global and per-glyph metrics, scaled and at variation locations;
- glyph extents and bounds;
- glyph outlines through a `PathSink`, for `glyf`, `CFF`, `CFF2` and `VARC`;
- bitmap glyphs;
- localized names and glyph names.

## Example

```silk
import read_fonts.lib { FontRef, ReadError }
import read_fonts.model.charmap { Charmap }
import read_fonts.model.metrics { GlyphMetrics }
import font_types.lib { GlyphId, F2Dot14 }
import silk.core.option { Option }
import silk.core.result { Result }

/// The horizontal advance, in font units, of the glyph that `codepoint` maps to.
pub fn advanceOf<'a>(data: &'a [u8], codepoint: u32) -> Option<f32> {
  let font = match move FontRef.new(data) {
    Result<FontRef<'a>, ReadError>.Success { value } => value
    _ => {
      return Option<f32>.None
    }
  }
  let glyph = match move Charmap.mapUnicode(&Charmap.new(&font), codepoint) {
    Option<GlyphId>.Some { value } => value
    _ => {
      return Option<f32>.None
    }
  }
  let location: [F2Dot14; 0] = []
  let metrics = GlyphMetrics.new(&font, &location)
  return Option<f32>.Some { value: GlyphMetrics.hAdvance(&metrics, glyph) }
}
```

Dependents import the package as `read_fonts`.

## Packages and tools

| Path | Package | What it is |
| --- | --- | --- |
| `font/parse` | `font-parse` | The library |
| `font/parse/dump` | `font-parse-dump` | Prints every parsed field of a font as text ([format](docs/dump-format.md)) |
| `font/parse/bench` | `font-parse-bench` | Library workloads timed against a Rust twin |
| `font/parse/tools/font-codegen-silk` | (Rust) | The fontations codegen grammar parser with Silk backends |
| `font/parse/upstream` | | The pinned fontations checkout. It is the codegen input and the Rust baseline, and is never modified |

Shared scripts for the font packages live in [`font/scripts`](../scripts). All of them run
from the repository root.

## Generated code

`font/scripts/generate` regenerates the table accessors and test fixtures, then formats every
Silk source. `font/parse/tools/codegen-plan.toml` lists each generated file. Never edit a
`generated_*.silk` file by hand; `font/scripts/generate --check` fails when a generated file
is stale.

## Tests

From the repository root:

```sh
silk test --manifest-path font/parse/silk.toml --root src/tests.silk
font/scripts/generate --check
python3 -m unittest discover -s font/scripts/tests
silk build --release --manifest-path font/parse/dump/silk.toml
READ_FONTS_PROFILE=release font/scripts/check-robustness --mutations-per-font 4
```

The robustness check dumps every one of the 566 corpus fonts, plus four seeded corruptions of
each. None may trap, crash, hang or produce incomplete output. These checks run in the `font`
CI workflow.

Every week the workflow also compares against the Rust read-fonts the port started from:

- the corpus dumps;
- generated fixtures for every table family;
- a malformed-input campaign;
- the benchmarks.

The Rust version is a baseline, not a target, so a difference is a reason to look rather than
automatically a bug.

## Performance

These figures are from 2026-10-29 (Silk dev.29, release builds, wall time relative to Rust
read-fonts and skrifa on the same corpus):

| Workload | Silk / Rust |
| --- | ---: |
| glyf outlines | 0.93× |
| hmtx metrics | 0.90× |
| CFF outlines | 0.92× |
| CFF subroutines | 0.90× |
| cmap lookups | 1.23× |
| Dumping all 566 fonts | 0.52× |

cmap lookup is the one workload behind. Each call still pays for subtable dispatch and checks
that Rust hoists out of the loop.

## Notes

- [Porting decisions](../docs/porting-decisions.md)
- [Standard library gaps](../docs/stdlib-gaps.md)

## License

[MIT](../LICENSE-MIT) or [Apache-2.0](../LICENSE-APACHE), following fontations. The fontations
checkout and its fonts keep their own notices.
