# font

Fonts for Silk, from reading the file to shaping text.

| Package | Path | What it does |
| --- | --- | --- |
| [font-types](types) | `font/types` | OpenType scalars: big-endian codecs, fixed point, tags, glyph IDs |
| [font-parse](parse) | `font/parse` | Parses sfnt/TTC files and their tables, plus a font model for metrics, character maps, names and outlines |
| [font-shape](shape) | `font/shape` | Text shaping: OpenType, AAT and the complex-script shapers |

Unicode properties and text segmentation live in [text-ucd](../text/ucd), which font-shape uses.

The three packages started as ports of Google's
[fontations](https://github.com/googlefonts/fontations) (read-fonts, font-types, parts of
skrifa) and of [harfrust](https://github.com/harfbuzz/harfrust). Those projects are now
baselines rather than targets. Weekly CI still compares against them, and today Silk is at or
below their run time on everything except cmap lookups.

## Shared tooling

- [`font/scripts`](scripts) holds code generation, the corpus test harness, the robustness and
  malformed-input campaigns, the benchmarks, and the Rust baseline twins
  (`rust-font-dump`, `rust-hr-shape`). Every script runs from the repository root.
- [`font/docs`](docs) holds the [porting decisions](docs/porting-decisions.md) and the
  [standard library gaps](docs/stdlib-gaps.md) the port ran into.

The `font` CI workflow runs the tests, generated-code checks, the corpus robustness check,
native and WebAssembly shaping, and the weekly baselines.

## License

font-types and font-parse are [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), following
fontations. font-shape is [MIT](shape/LICENSE), following harfrust.
