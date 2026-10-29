# read-fonts for Silk

Font parsing for [Silk](https://github.com/silk-lang/silk), ported from Google's
[read-fonts and font-types](https://github.com/googlefonts/fontations). It parses
sfnt and TTC files, core, layout, variation, AAT, bitmap, COLR and CFF/CFF2
tables, and provides a font model for metrics, character maps, names, glyph
outlines and bounds. The native [harfrust port](shape/README.md) adds Unicode text
shaping, OpenType and AAT layout, and the `hr_shape` CLI.

## Layout

- `font/types/`: endian scalars, tags, identifiers, fixed-point numbers and geometry.
- `font/parse/`: borrowed parsing, generated tables, integer sets and the font model.
- `font/parse/dump/`: CLI that prints every parsed field of a font as text.
- `text/ucd/`: Unicode 18 properties, canonical pairs, bidi, line breaking, segmentation,
  script itemization and vertical orientation; see [the package API](../text/ucd/docs/ucd.md).
- `text/ucd/dictionary/`: optional ICU Thai, Lao, Khmer and Myanmar dictionaries and breaker.
- `text/ucd/bench/`: Unicode algorithm workloads with pinned Rust/ICU4X comparisons.
- `font/shape/`: native text shaping, reusable plans, custom font callbacks and tracing.
- `font/shape/cli/`: glyph-string CLI, data-driven shaping suite and benchmark runner.
- `font/parse/bench/`: library workloads (cmap lookups, glyf decoding, hmtx advances) timed
  against a Rust twin in `font/scripts/rust-font-dump/src/bin/font-bench.rs`.
- `font/parse/tools/font-codegen-silk/`: the upstream codegen grammar parser with Silk backends.
- `scripts/`: code generation, the test corpus harness, and the Rust baseline dumper.
- `font/parse/upstream/`, `font/shape/test-data/harfrust/`: read-only submodules with the pinned
  fontations source and the font corpus (566 fonts).
- `svg_*/`: [SVG implementation packages and conformance tooling](../images/svg/README.md).

## Set up

```sh
git clone --recurse-submodules https://github.com/julia-script/read-fonts.git
cd read-fonts
export PATH="$(scripts/install-silk):$PATH"   # the Silk release pinned in the manifests
export SILK_CLANG="$(scripts/install-llvm)"   # Clang 22 (Silk needs 22 or newer)
```

The scripts need Python 3.11+. Code generation and the Rust baseline need a
stable Rust toolchain.

## Checks

Pull request CI ([ci.yml](.github/workflows/ci.yml)) has a hard 15 minute budget
and runs bounded jobs in parallel:

```sh
# Silk tests
silk test --manifest-path font/types/silk.toml --root src/tests.silk
silk test --manifest-path font/parse/silk.toml --root src/tests.silk
silk test --manifest-path text/ucd/silk.toml --root src/tests.silk
silk test --manifest-path text/ucd/dictionary/silk.toml --root src/tests.silk
# Full Unicode 18 conformance commands and baseline tools: text/ucd/docs/ucd.md
# Generated code, formatting and tools
font/scripts/generate --check   # regenerates and runs silk format; fails on any change
python3 -m unittest discover -s font/scripts/tests
# Corpus and corrupted fonts: every corpus font plus 4 seeded corruptions of
# each must dump without a trap, crash, hang or incomplete output
font/scripts/build --release
READ_FONTS_PROFILE=release font/scripts/check-robustness
# Native shaping (6,090 pinned cases, no known failures)
rm -rf build/llvm build/cache
silk test --release --manifest-path font/shape/silk.toml --root src/tests.silk
rm -rf build/llvm build/cache
silk build --release --manifest-path font/shape/cli/silk.toml
build/llvm/x86_64-unknown-linux-gnu/release/hr_shape --suite font/shape/tests/shaping.bin
build/llvm/x86_64-unknown-linux-gnu/release/hr_shape --regressions
font/scripts/check-shaping-trace
font/scripts/check-shaping-malformed
```

The comparisons against the Rust read-fonts the port started from are slower
and run weekly or by hand ([baseline.yml](.github/workflows/baseline.yml)).
They dump the corpus, generated fixtures and a malformed-input campaign with both
implementations and report the first differing line:

```sh
font/scripts/build --release
export READ_FONTS_PROFILE=release
font/scripts/compare
scripts/check-{core,table,layout,variation,aat,cff,model,misc-table}-fixtures
font/scripts/check-malformed --report build/malformed-report.json.gz
font/scripts/benchmark --report build/benchmark-report.json
font/scripts/bench-library   # library only, no dump output; checksums must match Rust
```

Checks run on every core; set `READ_FONTS_JOBS` to change that. `--fonts FILE`
limits a check to the fonts listed in FILE, one per line.

## Use the CLI

```sh
font/scripts/build --release
build/llvm/x86_64-unknown-linux-gnu/release/font_dump path/to/font.ttf
```

The output format is described in [font/parse/docs/dump-format.md](parse/docs/dump-format.md).

The shaping [validation and performance guide](shape/README.md) documents
the Rust differential harness and benchmark reproduction. The current local
shaping baseline is **8.38× Rust wall time** across seven checksum-matched
workloads (geometric mean); Roboto instruction count is **14.29× Rust**.

## Generated code

`font/scripts/generate` regenerates table accessors from the upstream codegen grammar
and the test fixtures, then runs `silk format` on every package. Do not edit `generated_*.silk` files. The plan in
`font/parse/tools/codegen-plan.toml` lists each generated file; its `extensions` entries
append handwritten `tables/*_impl.silk` files to their table's module.

## Notes

- [Porting decisions](docs/porting-decisions.md)
- [Compiler bugs](compiler-bugs/README.md) with minimal reproducers
- [Standard library gaps](docs/stdlib-gaps.md)

## License

Available under either [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE),
following fontations. The harfrust port uses its upstream [MIT license](shape/LICENSE). The submodules keep their own notices and font licenses.
`ucd` retains its [MIT implementation notice](../text/ucd/LICENSE) and
[Unicode data license](../text/ucd/LICENSE-UNICODE). Optional dictionaries retain the
complete [ICU license and third-party notices](../text/ucd/dictionary/LICENSE).
