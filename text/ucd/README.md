# text-ucd

Unicode 18 character data and text algorithms for Silk. It contains:

- typed character properties;
- canonical composition;
- bidirectional text (UAX #9);
- line breaking (UAX #14), with the CSS options;
- grapheme, word and sentence segmentation (UAX #29);
- script itemization;
- vertical orientation (UAX #50).

It does not depend on any font package, and property queries never allocate. It is headed for
the Silk standard library and lives here until then.

## Example

```silk
import ucd.lib as Unicode
import ucd.lib { GeneralCategory }
import ucd.line_break as LineBreaking
import ucd.line_break { BreakOpportunity, LineOptions }
import ucd.segmentation as Segmentation
import silk.collections.list { List }
import silk.mem.allocator { Allocator, OutOfMemoryError }

/// Counts the places where `text` may wrap onto a new line.
pub effect fn wrapPoints(text: &[u8]) -> usize
  ! OutOfMemoryError
  ? &mut Allocator {
  let mut breaks = List<BreakOpportunity>.make()
  run LineBreaking.breaks(text, LineOptions.make(), &mut breaks)
  return breaks.length()
}

/// Counts user-perceived characters (extended grapheme clusters).
pub effect fn characters(text: &[u8]) -> usize
  ! OutOfMemoryError
  ? &mut Allocator {
  let mut boundaries = List<usize>.make()
  run Segmentation.graphemes(text, &mut boundaries)
  return boundaries.length() - 1
}

pub fn properties() -> bool {
  return Unicode.generalCategory(0x41) == GeneralCategory.Lu
    && Unicode.combiningClass(0x301).number() == 230
    && Unicode.composeRaw(0x41, 0x301) == 0xC1
}
```

Dependents import the package as `ucd`.

## Properties

`ucd.lib` covers general category, canonical combining class, script and script extensions,
bidi class and paired brackets, joining type and group, line break, East Asian width,
grapheme/word/sentence break, Indic conjunct break, vertical orientation, mirroring, and the
emoji and default-ignorable flags. It also provides one-step canonical decomposition and
composition, including Hangul. Out-of-range input is safe: it gets the Unicode defaults, never
a trap.

Code points are `u32`. Scripts are ISO 15924 values (`Script`).

## Text algorithms

Each algorithm takes UTF-8 bytes and reports byte offsets. An invalid byte reads as U+FFFD, so
a scan always moves forward. Results go into a list the caller owns, which can be reused
without reallocating.

| Module | Entry point | Result |
| --- | --- | --- |
| `ucd.bidi` | `BidiAnalysis.analyze(text, direction)` | Paragraphs and level runs; `reorder` for a wrapped line |
| `ucd.line_break` | `breaks(text, options, &mut output)` | Break opportunities: allowed, mandatory or hyphenated |
| `ucd.segmentation` | `graphemes`, `words`, `sentences` | Boundary offsets |
| `ucd.itemization` | `scripts(text, &mut output)` | Script runs |
| `ucd.vertical` | `orientations(text, &mut output)` | Upright and rotated runs |

The bidi analysis implements the whole of UAX #9: embeddings, isolates, bracket pairs and
X9 removal. Line breaking supports CSS `line-break` (`auto`, `loose`, `normal`, `strict`,
`anywhere`), `word-break` (`normal`, `break-all`, `keep-all`), CJK punctuation tailoring and
manual soft hyphens. It does not do automatic hyphenation.

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `text/ucd` | `text-ucd` | Properties and algorithms |
| `text/ucd/dictionary` | `text-ucd-dictionary` | Optional ICU dictionaries for Thai, Lao, Khmer and Myanmar word breaking |
| `text/ucd/bench` | `text-ucd-bench` | Workloads timed against ICU4X and the Rust unicode crates |

The dictionaries add 2.9 MB of packed tries. Only programs that break Southeast Asian text
need them. Pass `IcuDictionary.make()` to `ucd.line_break.withDictionary`.

## Data

The tables are generated from the final Unicode 18.0.0 files, with every input pinned by
SHA-256 in `scripts/unicode-18.0.0.sha256`. `text/ucd/scripts/generate-unicode` writes them,
choosing the smallest two- or three-stage layout for each property. Never edit
`generated_*.silk` by hand.

## Tests

From the repository root:

```sh
silk test --release --manifest-path text/ucd/silk.toml --root src/tests.silk
silk test --release --manifest-path text/ucd/dictionary/silk.toml --root src/tests.silk
text/ucd/scripts/fetch-unicode
silk test --release --manifest-path text/ucd/silk.toml --root src/bidi_conformance.silk
silk test --release --manifest-path text/ucd/silk.toml --root src/line_break_conformance.silk
silk test --release --manifest-path text/ucd/silk.toml --root src/segmentation_conformance.silk
silk test --release --manifest-path text/ucd/silk.toml --root src/normalization_conformance.silk
```

The conformance runners consume every row of the official bidi, break and normalization test
files, with no skipped cases. The dictionary tests run all 51 of ICU's reference cases. All of
these run in the `text-ucd` CI workflow. Every week it also runs a sweep of every code point
against the source data, and the performance references.

## Performance

Line breaking is ahead of ICU4X on all five benchmark texts by instruction count (0.65–0.94×)
and on four of five by wall time; on the Indic text it is level. Graphemes run at 0.38–0.93×
ICU4X, words at 0.62–0.74× unicode-segmentation, and bidi at 0.24–0.79× unicode-bidi. The one
workload behind is sentence segmentation of Indic text. The [reference](docs/reference.md)
has the full tables and methodology.

## Reference

[docs/reference.md](docs/reference.md) covers:

- every query and its edge cases;
- the algorithms' options;
- how the shaping package uses the data;
- the gap between Unicode 18 and the standard library's normalization tables;
- the dictionary port;
- the benchmarks.

## License

[MIT](LICENSE) for the implementation and [Unicode License v3](LICENSE-UNICODE) for the data. The
dictionary package carries ICU's [license and notices](dictionary/LICENSE).
