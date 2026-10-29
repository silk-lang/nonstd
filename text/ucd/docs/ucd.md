# ucd

`ucd` is the font-independent Unicode data package, imported as `ucd.lib`.
It exposes typed character properties and raw canonical composition queries.
It has no dependency on `font_types` or `read_fonts` and performs no allocation
in property queries.

## Data and regeneration

The data is Unicode **18.0.0**, generated directly from the final files at
<https://www.unicode.org/Public/18.0.0/ucd/>. Every property and conformance input
is SHA256-pinned in `text/ucd/scripts/unicode-18.0.0.sha256`; `text/ucd/scripts/fetch-unicode`
populates and verifies `build/ucd/18.0.0/`, preserving upstream relative paths.
A checksum mismatch fails rather than silently refreshing a cached source.
The generator honors property `@missing` defaults, including bidi defaults
for unassigned right-to-left characters.

`text/ucd/scripts/generate-unicode` needs no Harfrust checkout. It chooses the smallest
total byte representation among two- and three-stage tables, searching leaf
blocks of 4–512 entries and middle blocks of 4–256 entries. Index widths are
chosen independently (1, 2, or 4 bytes); trailing default entries are omitted.
Tables and script-extension sets remain static byte literals. Lookup helpers
inline and have one explicit code-point range check.

```sh
text/ucd/scripts/fetch-unicode            # download or verify every pinned input
text/ucd/scripts/generate-unicode         # properties only, no Harfrust source dependency
font/scripts/generate                 # all data and Silk formatting
font/scripts/generate --check         # committed output must be current
silk test --manifest-path text/ucd/silk.toml --root src/tests.silk
rm -rf build/llvm build/cache
silk test --release --manifest-path text/ucd/silk.toml --root src/sweep.silk
font/scripts/check-unicode-equivalence # full-domain source/table comparison, outside PR CI
```

`text/ucd/scripts/generate-unicode` owns the Unicode tables. The separate
`font/scripts/generate-shaping-unicode` owns modified combining classes, RTL-script
policy, Arabic/Thai state machines and fallback forms, and AAT features.
OpenType script tags remain in harfrust. No property table is generated twice.
Focused package tests run in their own bounded PR CI job; the full code-point
sweep runs in the scheduled/manual baseline workflow.

Shaping extraction is gated with the full harfrust suite, regressions, Rust
comparison, tracing, malformed-font campaign and all seven callgrind workloads.
Clear `build/llvm` and `build/cache` before release builds (Silk #2468).
For before/after instruction counts, use identical executable and corpus paths:
process startup and path handling are included in callgrind's totals.
The hot property entrypoints inline explicitly. Canonical composition searches
packed triples; Hangul composition/decomposition remains algorithmic.

## API

```silk
import ucd.lib as Unicode
import ucd.lib { Script }

// Code points are u32; scripts hold big-endian ISO 15924 tags.
let latin = Unicode.script(0x41)             // Script { value: 0x4c61746e }
let category = Unicode.generalCategory(0x41) // GeneralCategory.Lu
let acute = Unicode.combiningClass(0x301)    // CanonicalCombiningClass.Above
let order = acute.number()                  // 230
let composed = Unicode.composeRaw(0x41, 0x301) // U+00C1
```

- `generalCategory(cp) -> GeneralCategory` uses the Unicode aliases (`Lu`,
  `Mn`, etc.). `combiningClass(cp) -> CanonicalCombiningClass` uses UCD named
  values (`Not_Reordered`, `Above`, `CCC10`, etc.); `.number() -> u8` gives the
  canonical ordering value.
- `script(cp) -> Script` returns the ISO tag. `scriptExtensions(cp) -> ScriptSet`
  returns an immutable packed set with `length`, `get(index) -> Option<Script>`,
  and `contains(Script)`. Its default is the singleton primary script.
- `bidiClass`, `bidiPairedBracketType`, `joiningType`, `joiningGroup`,
  `lineBreak`, `eastAsianWidth`, `graphemeBreak`, `wordBreak`, `sentenceBreak`,
  `indicConjunctBreak`, and `verticalOrientation` return their corresponding
  typed enums. Joining groups remain separate from joining types.
- `mirror(cp)`, `bidiPairedBracket(cp)`, and `vertical(cp)` return a mapped code
  point or the input. `vertical` preserves presentation-form mappings; it is
  **not** UAX #50 orientation.
- `isMark`, `isVariationSelector`, `isDefaultIgnorable`, `isEmoji`,
  `isEmojiPresentation`, `isEmojiModifier`, `isEmojiModifierBase`,
  `isEmojiComponent`, `isRegionalIndicator`, and `isExtendedPictographic`
  are normative Boolean queries. Default ignorables are generated from UCD.
- `decomposeRaw(cp) -> Decomposition { first, second }` returns one canonical
  decomposition step, including Hangul. Both fields zero mean absent; a zero
  `second` denotes a singleton. It does not recursively normalize strings.
- `composeRaw(first, second) -> u32` returns zero for an absent composition.
  `compose` and `decompose` expose equivalent `Option` results, with the latter
  using `Decomposed.Singleton` or `Decomposed.Pair`.
- `composesAsSecond(cp)` is the packed composition-table filter, excluding
  algorithmic Hangul; `composeRaw` handles Hangul before consulting it.
- `Script { value: u32 }` is the ISO value type.
  `Script.fromIso15924Tag(u32)` normalizes case and historical script aliases;
  zero returns `None`. `Script.parse(string)` reads up to four UTF-8 bytes,
  pads short inputs with spaces, and returns `Option<Script>`.

Out-of-range `u32` inputs are safe: unassigned category, zero combining class,
unknown script (`Zzzz`), no decomposition/composition, false Boolean queries,
and identity mappings. Surrogates retain their Unicode category.

### Harfrust migration

`harfrust.unicode` converts typed properties to its existing shaping encodings
and retains `modifiedCombiningClass`, `isRtl`, and the explicit policies below.
`harfrust.lib.Script` re-exports the same
`ucd.Script` type. Font-specific operations now live in `harfrust.script`:
`tag`, `horizontalDirection`, `tags`, and `tagsForLanguage` are module functions,
not `Script` methods. Its `parse` function returns the shaping API's
`Result<Script, ParseError>`; `ucd.Script.parse` returns `Option<Script>`.
Silk requires inherent implementations in the type's declaring module
(SEM0194), so font-specific methods cannot remain attached to `ucd.Script`.

### Source equivalence and explicit shaping policies

The pre-cutover baseline is read-only Harfrust commit
`1503ff054384cc1d6a701b5ffbdc2f24118a2790`. Its
`font/shape/src/unicode/ucd_table.rs:1–7` says its XML source is Unicode 18.0.0;
`unicode/emoji_table.rs:10–16` independently identifies Emoji 18.0.0.
The checker decodes the emitted byte tables, independently parses pinned UCD,
and compares every code point (including surrogate slots) for all properties.
It separately compares the preserved Harfrust view against the old tables and
predicates, plus the complete decomposition and composition maps. Unexplained
differences fail; there is no version-difference allowlist.

These are **shaping-policy differences, not Unicode version changes**:

- Normative `Default_Ignorable_Code_Point` is true for U+115F, U+1160, U+3164,
  U+FFA0, U+1BCA0, U+1BCA1, U+1BCA2, and U+1BCA3. The Harfrust shim excludes
  exactly those eight characters so existing fonts retain visible Hangul
  fillers and shorthand controls. Evidence:
  `font/shape/src/unicode/mod.rs:549–555,586–614` at the pinned source revision
  (also [HarfBuzz #503](https://github.com/harfbuzz/harfbuzz/issues/503)).
- Normative `Variation_Selector` includes U+180B, U+180C, U+180D, and U+180F.
  The Harfrust shim excludes exactly those four Mongolian selectors because
  the Arabic shaper handles them. Evidence: upstream `unicode/mod.rs:617–621`.
- The preserved `vertical` presentation map is not a normative UCD property.
  It joins single-character `<vertical>` decompositions with `<wide>`
  decompositions so ASCII punctuation maps from its fullwidth counterpart,
  not from ASCII. U+FE33 is the straight low line; the duplicate decomposition
  U+FE34 is selected for the wavy low line U+FE4F. Multi-character vertical
  digraph decompositions are not single-code-point mappings. The complete
  source domain is U+2013, U+2014, U+2025, U+2026, U+3001, U+3002,
  U+3008–U+3011, U+3014–U+3017, U+FE4F, U+FF01, U+FF08, U+FF09, U+FF0C,
  U+FF1A, U+FF1B, U+FF1F, U+FF3B, U+FF3D, U+FF3F, U+FF5B, and U+FF5D.
  Evidence: upstream `unicode/mod.rs:624–671`; the checker requires the
  complete mapping to match, not merely this domain.
- Joining_Type `C` maps to Harfrust's dual/join-causing state 3; Joining_Group
  `Alaph` and `Dalath_Rish` override its state to 4 and 5. Those shaping states
  are intentionally absent from the typed UCD property enums.


### Normalization version gap

Silk dev.23's `silk.unicode` reports Unicode **17.0.0**, but also omits 34
nonzero combining classes already assigned in Unicode 17. Another 34 CCC
differences are genuine Unicode 18 additions. These are not interchangeable
normalization datasets. Reported as
[silk-lang/silk#2487](https://github.com/silk-lang/silk/issues/2487).

`text/ucd/scripts/check-normalization-gap` checks CCC over all 1,114,112 code-point slots,
raw non-Hangul decomposition/composition maps, and all ten canonical invariants
in each of Unicode 18's 20,171 normalization rows. Observed: zero raw-pair
differences, 68 CCC differences, 134 NFC and 134 NFD mismatches. Its separately
SHA256-pinned Unicode 17 source distinguishes stdlib data errors from version
changes; detailed results go to `build/normalization-gap.json`.

Harfrust depends on canonical ordering, so these differences matter to shaping.
It uses `ucd`'s correct Unicode 18 properties and raw pairs and never calls
stdlib NFC/NFD. No compiler/stdlib data is patched or vendored.

## Text algorithms

Algorithms accept UTF-8 `&[u8]`. Every position is a byte offset into that
input, and every range is `[start, end)`; nothing depends on a layout engine's
types. Invalid UTF-8 consumes one byte as U+FFFD, so malformed input cannot
stall a scan. List results are appended to a caller-cleared list; reuse the
list to keep its capacity.

| Module | Entry point | Result |
|---|---|---|
| `ucd.bidi` | `analysis.analyze(text, direction)` | `BidiAnalysis`: `paragraphs()`, `runs()` |
| `ucd.line_break` | `breaks(text, options, &mut output)` | `List<BreakOpportunity>` |
| `ucd.segmentation` | `graphemes`, `words`, `sentences` | `List<usize>` byte boundaries |
| `ucd.itemization` | `scripts(text, &mut output)` | `List<ScriptRun>` with ISO script tags |
| `ucd.vertical` | `orientations(text, &mut output)` | `List<OrientationRun>` |

```silk
import ucd.bidi { BidiAnalysis, ParagraphDirection }
import ucd.line_break as LineBreaking
import ucd.line_break { LineOptions, BreakOpportunity }

let mut bidi = BidiAnalysis.make()             // reuse it across texts
run bidi.analyze(text, ParagraphDirection.Auto)
// bidi.runs()[i]: start, end, level (shape with it), unwrappedLevel, removed

let mut breaks = List<BreakOpportunity>.make()
run LineBreaking.breaks(text, LineOptions.make(), &mut breaks)
// breaks[i].offset ends a line; breaks[i].kind is Allowed, Mandatory or Hyphenated
```

`BidiAnalysis.analyze` replaces the analysis' contents and keeps its storage.
`ParagraphDirection` is `Auto`, `Ltr`, or `Rtl`; `Auto` resolves each paragraph
separately. `paragraphs()` lists every P1 paragraph (`start`, `end` including
its separator, `level`, `hasStrong`); empty text has one empty paragraph.
`runs()` are maximal contiguous ranges that never cross a paragraph, each with
the resolved `level` (before L1; shape with it), `unwrappedLevel` (after L1
with the whole paragraph as one line) and `removed` (X9: explicit formatting
and BN, which keep their bytes and take the preceding level). `runAt(offset)`
and `paragraphAt(offset)` look results up by byte. The complete UAX #9
implementation includes explicit embeddings, isolates, overflow handling,
canonical bracket pairs, N0, and X9 removal affinity. Paragraphs without RTL
characters, Arabic numbers or explicit formatting take a fast path.

For a wrapped line, apply L1 to the line's levels and call
`reorder(levels, &mut indices)` for L2 (excluding X9 characters). The lower-level
`BidiWorkspace` with `analyzeClasses`/`analyzeCodepoints` resolves one paragraph
of classes or code points and exposes per-character `level`, `unwrappedLevel`,
`isRemoved` and `visualOrder`; the conformance runners use it.

`LineOptions.make()` selects untailored UAX #14 with manual soft hyphens.
`LineBreakMode` supports `Auto`, `Loose`, `Normal`, `Strict`, and `Anywhere`;
`WordBreakMode` supports `Normal`, `BreakAll`, and `KeepAll`. Set
`LineLanguage.Japanese` or `.Chinese` for CSS CJK punctuation tailoring.
Mandatory breaks take precedence; `Anywhere` preserves extended graphemes and
overrides `word-break`. `Hyphens.Manual` marks U+00AD opportunities as
`BreakKind.Hyphenated`; `.None` suppresses them. No automatic hyphenation
patterns are included. The output always ends with a `Mandatory` opportunity
at the end of the text (offset 0 for empty text). The default SA behavior needs
the optional dictionary provider for language-specific word opportunities.

Segmentation implements extended graphemes, default UAX #29 words, and default
sentences, not locale-specific word tailoring. Boundary lists contain zero and
the input length exactly once, including the single zero for empty input.
`GraphemeCursor` also exposes streaming cluster iteration without an output list.
The Unicode 18 GB9c linker rule is used rather than an older Unicode rule set.

Script itemization intersects `Script_Extensions`, resolves surrounding
Common/Inherited characters, retains combining marks with their base, and
inherits a closing bracket's script from its opener. Ambiguous isolated sets
prefer an available primary script, then the lowest ISO tag.

Vertical orientation applies UAX #50 to whole grapheme clusters, with enclosing
marks forcing upright orientation. `U`/`Tu` fall back upright and `R`/`Tr`
rotated clockwise. This is not glyph substitution: a font consumer must still
distinguish `Tu`/`Tr` through `verticalOrientation(cp)` and apply available
vertical alternates before choosing fallback orientation.

## Conformance

```sh
text/ucd/scripts/fetch-unicode
rm -rf build/llvm build/cache
silk test --release --manifest-path text/ucd/silk.toml --root src/bidi_conformance.silk
rm -rf build/llvm build/cache
silk test --release --manifest-path text/ucd/silk.toml --root src/line_break_conformance.silk
rm -rf build/llvm build/cache
silk test --release --manifest-path text/ucd/silk.toml --root src/segmentation_conformance.silk
rm -rf build/llvm build/cache
silk test --release --manifest-path text/ucd/silk.toml --root src/normalization_conformance.silk
```

The runners consume every data row of both bidi files and all four break-test
files, without code-point filters or skipped cases. Clear the compiler caches
before each release invocation as noted above. PR CI runs these suites in
parallel bounded jobs; full-domain equivalence and performance references stay
in the scheduled/manual workflow.
The normalization runner reconstructs canonical forms from `ucd`'s raw APIs
inside the test only, checking all ten canonical invariants per fixture row.
No public string-normalization implementation is duplicated.

## Optional Southeast Asian dictionaries

Add `ucd_dictionary` only when Thai, Lao, Khmer, or Myanmar dictionary breaking
is needed. Ordinary `ucd` does not depend on it. `IcuDictionary.make()` implements
`ucd.dictionary.DictionarySegmenter`; pass it to
`ucd.line_break.withDictionary(text, options, &dictionary, &mut output)`.
Its direct `breaks` interface returns original-byte word boundaries including
zero and EOF. It is not a replacement for default UAX #29 word segmentation.

The package ports ICU's ordered three-word lookahead, unknown-prefix handling,
language-specific resynchronization, combining marks, and Thai suffix rules.
Construction allocates nothing; only caller-list growth allocates during use.
The four tries contain 179,081 entries in **2,867,684 packed bytes**.
ICU release-78.1 commit `049e0d6a420629ac7db77256987d083a563287b5`,
dictionaries, engine sources, rules, reference cases and license are SHA256-pinned
by `text/ucd/scripts/generate-unicode-dictionaries`. Its `--offline` and `--check` modes
support reproducible cache-only validation. The ordinary `font/scripts/generate`
includes this data. No Chinese/Japanese dictionary or ICU LSTM model is shipped.

All 51 extracted ICU reference cases run in the dictionary package's tests;
expectations come from upstream, not this implementation. See
[`text/ucd/dictionary/NOTICE`](../dictionary/NOTICE) for provenance and the
UTF-8 versus UTF-16 UText minimum-span distinction.

## Reference comparisons and benchmarks

```sh
cargo build --locked --release --manifest-path text/ucd/scripts/rust-ucd-bench/Cargo.toml --target-dir build/ucd-rust
rm -rf build/llvm build/cache
silk build --release --manifest-path text/ucd/bench/silk.toml
text/ucd/scripts/bench-unicode
text/ucd/scripts/bench-unicode --callgrind --iterations 1 --samples 1
text/ucd/scripts/check-normalization-gap
text/ucd/scripts/check-unicode-itemization
```

Benchmark defaults use the x86_64 Linux executable path, like `bench-shaping`;
pass `--silk PATH` on other targets. `--baseline-only` runs references without
a Silk executable. `--filter`, `--algorithm`, `--samples`, `--iterations`, and
`--report` select workloads and JSON output. Callgrind requires Linux/Valgrind.
The itemization comparison requires C++17, `pkg-config`, and ICU development
files; it reports the linked version and checks 123 shared cases plus four
explicit Script_Extensions/combining-mark differences against ICU's pinned
ScriptRun sample. Native ICU is never linked into either Silk library.

The 30 benchmark comparisons cover Latin, mixed RTL, Indic, CJK, and emoji.
All boundary/level checksums match. Pinned references are `unicode-bidi` 0.3.18
(Unicode 16), `unicode-linebreak` 0.1.5 (Unicode 15), `unicode-segmentation`
1.12.0, and ICU4X segmenter 2.4.0's stable constructors. They are performance
references, not Unicode 18 conformance oracles. ICU's non-complex word
constructor does not support CJK, so default-word comparisons use
`unicode-segmentation` rather than silently accepting its different boundaries.

Measured on x86_64 Linux, Silk dev.25, clang 22.1.8, Rust 1.97, Valgrind 3.22,
with 10 iterations so per-run startup does not dominate.
[`text/ucd/bench/baseline.json`](../bench/baseline.json) records all 30 counts,
checksums, reference versions and the measured source revision:

| Algorithm | Reference | Silk/reference instruction range |
|---|---|---:|
| Bidi | unicode-bidi | 0.24–0.79x |
| Line breaks | unicode-linebreak | 2.16–2.92x |
| Line breaks | ICU4X | 0.65–0.94x |
| Graphemes | ICU4X | 0.38–0.93x |
| Words | unicode-segmentation | 0.62–0.74x |
| Sentences | ICU4X | 0.61–1.08x |

`unicode-linebreak` implements only the default UAX #14 pair table: no CSS
strictness, word-break or hyphenation options and no dictionary segmentation
for SA scripts, which the Silk line breaker evaluates per pair.

These are whole-process measurements, including input and checksum work, not
speed-parity claims. Boundary buffers are reused in both implementations;
Silk line breaking stores richer layout records than the references' indices.
Bidi uses reusable Silk workspace versus the reference's allocating API.
Inlining token readers and hoisting context-independent AL/HL/NU rules reduced
the Latin line workload by 33.5% instructions on dev.22 without changing
conformance. A generated table of context-free class pairs, plus a loop copy
with constant options for the untailored profile, cut it a further 16%
(14–18% wall time across the five workloads). The phase-1 extraction merged with no shaping instruction
increases. On dev.23, the subsequent UCD table-layout cutover preserves all
seven shaping checksums versus main `487488c`; instruction changes range from
−0.48% to +0.74%, with a +0.12% geometric mean.

## Licenses

The inherited implementation retains the MIT notice in `text/ucd/LICENSE`.
Unicode source data retains `text/ucd/LICENSE-UNICODE` (Unicode License v3).
The optional dictionary package copies ICU's complete license, including its
Unicode License v3 and Lao/Burmese word-list notices.
