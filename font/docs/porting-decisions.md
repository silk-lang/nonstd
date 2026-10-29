# Porting decisions and deviations

Decisions recorded while porting, grouped by the milestone that made them. The
port started from Rust read-fonts as a baseline; later changes need not match it.

## Milestone 0

- The destination is `julia-script/read-fonts`, as supplied by the user, rather than
  the working repository name `fontations-silk` in the plan.
- Fontations and the HarfRust corpus are vendored as pinned Git submodules. They
  are read-only reference snapshots. Their licenses and copyright notices remain
  intact. Initialize them recursively; never update implicitly to a branch tip.
- The root manifest also defines an empty `fontations_silk` library so **every**
  `silk.toml`, including the workspace root, has an effective `[package].silk-version`
  pin. The three requested packages retain their separate identities and path dependencies.
- The current reference dump covers directory fields and lookup availability.
  No table parser, scalar port, generated Silk, model API, or parity gate is claimed.
  Generator copying and `silk-parse` start at milestone 2, after the core gate.
- At the pinned fontations revision, `test_data/extracted` contains 19 glyph
  expectation `.txt` files and no font containers. They remain in the snapshot and
  are listed as excluded inputs; later glyph/model checks can consume them.
- HarfRust's `DFONT.dfont` is included. Upstream `FileRef` reports
  `InvalidSfnt(0x00000100)`. This is a recorded oracle result, not a successful face.
- Upstream's `experimental_traverse` feature is now an empty compatibility feature
  (traversal was removed). The reference dumper calls concrete upstream accessors.
  Later generated dumping must not assume a reflection/traversal API exists.
- No deliberate change to parser error semantics or public font APIs has been made.

## Silk observations for the next gate

Reference source: `silk-lang/silk` at `1120049495d3b59f2524a0094430fb3aed83fd66`,
read outside this repository. The bundled release compiler/stdlib remain unchanged.

- `effect fn` constructs a deferred computation. `run` executes it and propagates
  typed failures; traps are separate and cannot be caught as `ReadError`.
- The hosted entry supplies `HostInput`, but allocation and output still need
  explicit providers. The skeleton provides its allocator and stdout/stderr writers.
- Packages export modules explicitly. A path dependency alone does not expose its
  modules; library manifests initially export `lib`.
- `Result` uses `Success { value }` and `Failure { error }`, not Rust's `Ok`/`Err`.
  Borrowed bytes and UTF-8 `string` are separate types; flags are decoded, while font
  paths can remain bytes.
- Root/library builds check source but do not emit a binary. Build `font_dump` from
  its member directory. The output tree is a real directory, with no symlink.
- `SILK_CLANG` must name an absolute executable path. The first CI run used a bare
  `clang-18` value and failed during linking with `cannot resolve path: invalid path`;
  the workflow now uses `/usr/bin/clang-18`, matching the local absolute-path setup.
- Keep borrowed table data lifetimes explicit; use finite generic specialization
  (GEN-006), eager offsets, checked arithmetic, and nominal unions for format groups.
  No `mod.silk` barrels are used.

## Milestone 1

- `Scalar` exposes `rawByteLen`, exact-width `read`, and prefix-writing `write`.
  Associated Rust types become explicit interface parameters (`FontRead<'a, Args>`,
  `FontReadAt<'a, Args>`, `ComputeSize<Args>`); `ReadArgs::Args` has no separate Silk
  type projection. `FixedSize` has a `rawByteLen` operation.
- `BigEndian<T>` owns eight bytes and exposes only the scalar's encoded prefix.
  Its native layout is not a packed font record. Borrowed scalar/record arrays
  retain the original byte slice and decode one item at a time, with no allocation
  or unaligned casts. Rust's `bytemuck` layout and raw reference APIs are represented
  by these views. The parser never uses `sizeof(BigEndian<T>)` as a disk stride.
- Associated constants use camelCase factory functions (`Fixed.one()`,
  `GlyphId.notdef()`, `NameId.familyName()`, etc.). The release admits functions,
  not associated constant declarations, in inherent impls. Root sfnt constants
  remain module constants. Struct constructors cannot run in a constant initializer
  unless declared static; no compiler modification was made to bypass this rule.
- `FontData.slice(start, end)` uses explicit endpoints instead of Rust RangeBounds.
  Reads retain Result/Option errors and the checked bounds order. Offsets have
  generic `resolve`/`resolveWithArgs` helpers; zero and out-of-range remain distinct.
- Generic geometry operations whose bounds vary by operation use a method type
  parameter, e.g. `Matrix.identity<f32>()`. `Matrix.transform` returns the nominal
  `Coordinates<T>` tuple because Silk has no anonymous tuple types in signatures.
- Point and Matrix arithmetic operators are generic conformances over the
  coordinate type (compiler report 003 was fixed in Silk dev.22). Generic `==`
  on them still needs a bounded helper (silk-lang/silk#2448).
- `VarLenArray.get` skips repeated iterations after a zero-size item: every later
  index would otherwise revisit the identical offset. It returns the same read of
  the empty extent; `iter` terminates on zero length, as upstream does.
- Core container unit tests use compact synthetic sfnt/TTC data instead of embedding
  whole AHEM/TTC binaries. Full original files are separately included in the
  566-file differential directory gate.
- `TableDataRef` uses `HeaderRead` to construct a borrowed header view instead of
  casting the buffer to a native packed structure. Unaligned headers are supported.
  `BigEndian.new` takes an exact-width slice and returns `Option`, replacing Rust's
  associated fixed-size raw array parameter. `Version16Dot16.toMajorMinor` returns
  the existing `MajorMinor` record instead of an anonymous tuple.
- The CLI uses Silk's rooted filesystem provider, which rejects symlink traversal.
  Corpus paths are ordinary files. This differs from Rust `std::fs::read`, which
  follows symlinks; parser APIs themselves take byte slices and are unaffected.

## Milestone 2

- The generator is a standalone copy of the pinned font-codegen crate, with its
  original Rust modes retained. `silk-parse` reuses its parsed/resolved AST. Two
  traversal modes (`silk-dump`, `rust-dump`) call the respective public accessors;
  the Rust oracle still parses only with the unchanged upstream library.
- Table views store borrowed FontData and precomputed saturating byte ranges.
  They validate the same minimum size as upstream and preserve lazy defaults for
  malformed tails. Fixed records are borrowed positioned views, not native packed
  structs. Byte range saturation is followed by checked reads; it never permits
  unchecked indexing. Remainder arrays discard an incomplete final element.
- Public facades live in `tables/<name>.silk`, with explicit manifest exports and
  selective publication. This permits `read_fonts.tables.head` imports without
  exposing generated filenames or relying on unsupported namespace re-exports.
- Flag constants are camelCase factories. The reserved keyword `union` is exposed
  as `unionValue`; bitwise operators preserve the upstream behavior. Private view
  fields use an internal prefix to avoid collisions with public accessor names.
- Prototype dump paths use a fixed stack of 32 segments. The current generated
  table graph is acyclic and requires at most eight; font bytes cannot increase
  the depth. Recursive grammar groups will need explicit traversal handling.

- Silk inherent impls must share their nominal type's module. Handwritten
  `tables/*_impl.silk` extension templates are therefore appended by `font/scripts/generate`
  to the relevant generated module, like upstream's `include!` arrangement. Edit
  the template, never the generated copy. Selected-table wrappers are ordinary
  separate modules.
- `font/scripts/generate-static` packs post names, Mac Roman, and language-ID strings
  directly from the immutable upstream sources, and retains the OS/2 range data.
  The language map contains duplicate IDs; rightmost-equal binary search preserves
  the pinned Rust library's choice. Packed byte slices are returned by functions,
  as in Silk's Unicode tables, because slice-valued constants are unsupported.
- Iterator tuples use named records (`GlyphNameEntry` with `glyph` and `name`).
  The post iterator keeps upstream's 16 checkpoints, monotonic fast path, and
  first-unreachable-string bound. Tests use fixed stack buffers instead of Vec.
- The metrics fixture tests retain the original CBDT table and the four tested
  Vazirmatn long metrics. Full original fonts are covered by corpus comparison.

- `TableProvider` supplies the supported non-generic table methods as default
  interface operations, so custom providers have the same selection behavior as
  FontRef. Generic `expectTable<T, P>` is a free helper (also a FontRef method)
  because of compiler report 004. `TopLevelTable.tag()` and `Format.formatValue()`
  replace their associated Rust constants.
- Generated defaults use upstream's 262-byte null backing pool, including its
  remainder-array behavior. Only format 0/1 tables get defaults, as upstream does.
- Cmap methods accept explicit u32 codepoints/selectors; convert chars with
  `char.toU32`. Iterator tuples use `CmapMapping` and `UvsMappingEntry`; selected
  records use `BestCmapSubtable` and `SelectedUvsSubtable`. The cache/iteration
  algorithms preserve the pinned upstream overlap and search behavior.
- Cmap10 iteration uses explicit wrapping addition for a malformed range that
  exceeds u32. This matches Rust release arithmetic and avoids a Silk trap; Rust
  debug can overflow on that input. Valid ranges are unchanged.
- The CLI buffers output in a fixed 64 KiB array. The expanded debug corpus uses
  a 120-second per-process limit: FDArrayTest257 emits 2,493,805 lines / 178,689,572
  bytes and took 30.9 seconds locally, exceeding the directory-era 30-second
  limit. No field or semantic observation is suppressed.

## Milestone 3

- Multiple read arguments use `ReadArgs2`/`ReadArgs3` products. Their fields are
  `first`, `second`, and `third`; public table constructors still take separate
  named parameters. Compiler report 005 documents why Copy bounds live on the
  product's conformance instead of its declaration.
- Positioned GPOS records retain the enclosing FontData and their field ranges.
  ValueRecord construction remains lazy, including its saturating u32 position;
  reads of absent or truncated fields preserve Option/Result distinctions.
- GDEF requires ItemVariationStore, so its generated variations dependency and
  TupleIndex scalar are included here. Variation evaluation and its full gate
  remain milestone 4.
- Core layout glyph lookups take explicit GlyphId values. Iterators use named
  ClassEntry/ClassEntry16 records in place of Rust pairs. Set intersections and
  their tests require the IntSet port in milestone 7.
- New layout facades and packed specification fixtures are emitted by the
  generation script; edit extension templates or their upstream-derived fixture
  generator, never generated files.

- `TaggedElement` exposes `tag` and `element`; Rust Deref forwarding is explicit
  access to `element`. ScriptTags exposes `asSlice` and retains the original order.
- Layout conditions need the shared `model.error.Error` type before the model
  milestone. Its error variants and messages match upstream. Callable parameters
  preserve mutable callback state; recursion is capped at 64 and work at 65,536.
- Lookup variation accumulation uses Silk List and HashSet<Word> in place of Vec
  and BTreeSet. It is an allocation effect with an explicit Allocator and
  OutOfMemoryError; lookup order and shared-offset deduplication are unchanged.
- ValueRecord's zero-bit field-offset probe uses wrapping subtraction, matching
  Rust release behavior. Layout test fixtures retain complete original GSUB
  payloads from the four upstream script/feature-test fonts.

- Dump format 3 records table graphs: a view's first visit emits a `.node` ID and
  all its fields; later visits emit `.ref`. The per-top-level identity includes
  the grammar type, the remaining suffix length, and all read arguments. Every
  generated offset resolves a suffix of the same top-level payload, so length
  identifies its start without pointer casts. The fixed cache evicts by printing
  a later visit again; eviction cannot suppress a field. Type-ID collisions fail
  generation. Both parsers construct views independently.
- Traversal implementations live with the DumpTable interface, as required by
  Silk's conformance ownership rule. The generation script builds that module
  from emitted declarations. Traversal limits produce an explicit marker that
  the corpus harness rejects, never a successful parity claim.
- The initial expanded traversal repeated a 55 KiB malformed regression font
  into gigabytes of output and was terminated. With graph references it produces
  5,704,912 lines / 698,627,724 bytes and matches exactly. The harness now streams
  process output through temporary files, comparing every line and hashing every
  byte without retaining whole dumps in memory.

## Milestone 4

- `storeDeltas` accepts an optional borrowed table view by value, instead of an
  optional reference to that view. Its reusable callable snapshots the Copy view
  and retains the font and coordinate lifetimes. Missing or unreadable deltas are
  zero, and condition evaluation preserves fractional 48.16 contributions.
- `Fvar.userToNormalized` accepts a slice of `UserCoordinate { tag, value }` in
  place of a Rust pair iterator. It is an allocation effect: stack scratch covers
  up to 64 coordinates and 128 axis indices, then Silk Lists provide larger
  scratch buffers. The indexed path uses heap sort and binary search, preserving
  duplicate tags and last-user-value precedence without quadratic large-font
  behavior. Version 2 avar arithmetic retains 16.16 values until final conversion.
- `SelectedFeatureVariations` retains the two public Option fields. Silk Option
  is affine, so the containing record is not Copy; its equality and selection
  behavior are preserved.
- Packed stream structs store optional counters as private `bounded`/`limit`
  fields so their cursor snapshots remain Copy. Public optional counts are
  reconstructed; `PackedPointSplit` names the returned points/remainder pair.
- `VarLenArray` now accepts any element type, matching upstream's lazy container.
  Only `get` and `iter` require `FontRead` and `VarSize`; this permits gvar's raw
  header-array view, whose elements require separate axis-count arguments.
- Tuple variation iterators return `ActiveTupleVariation { variation, scalar }`
  instead of a Rust pair. Shared optional views use private presence flags so
  snapshots remain Copy; coordinate/cache borrows remain explicit. `TupleDelta`
  and `PointCoord` operation contracts are separate from the arithmetic/Copy
  bounds required by individual generic methods, since interfaces do not inherit
  other interfaces in this Silk release.
- `GlyphVariationData` is a transparent alias; its format-aware byte constructor
  is `glyphVariationDataWithFormat`, while `TupleVariationData.new` constructs the
  shared representation. Silk does not allow an inherent impl on an alias or a
  specialized generic family. Glyph-only accumulation methods declare their
  concrete receiver within the whole `TupleVariation` family impl.
- Direct tuple-header getters return None for truncated coordinate data instead
  of upstream's internal unwrap panic. Header iteration still checks the entire
  header extent before yielding a value. Signed grammar counts preserve Rust's
  cast to usize before saturating range arithmetic and checked field reads.
- `CurvePoint.onCurvePoint` is the on-curve constructor; `onCurve` remains the
  public boolean field because Silk forbids a field and method sharing a name.
  `GlyfLoca` and `ComponentCountAndInstructions` name Rust pair results. Glyph
  flags, component selection, read-error precedence and coordinate wrapping are
  preserved.
- `PointFrom<C>` expresses the coordinate conversion bound used by glyph delta
  interpolation (identity conversions plus i32 to Fixed). `DeltaBuffers` keeps
  caller-owned mutable slices. Contour interpolation passes checked index ranges
  over those slices because this stdlib lacks mutable slice subviews; the contour
  bounds, arithmetic order, zeroing behavior and error results match upstream.

- Generated variable-record accessors expose the complete suffix, matching
  upstream even when their declared count only positions a subsequent field.
  The M4 corpus smoke test found this distinction in avar2; declared byte ranges
  remain unchanged. The variation dumper resets its graph scope per glyph so
  equal-sized payloads cannot alias. A monotonic node-ID threshold invalidates
  old cache entries without a full per-glyph cache clear.

## Milestone 5

- AAT typed lookups retain `TypedLookup` plus the `LookupU16`, `LookupU32`, and
  `LookupGlyphId` aliases. Dynamic format-2/6 record arrays use borrowed
  `ComputedArray` views; each fetched `LookupSegment2`/`LookupSingle` contains
  decoded scalar fields instead of a packed native structure. Disk widths remain
  explicit and independent of native structure layout.
- State tables take an explicit payload type because Silk has no default generic
  type arguments. `StateEntry` reads payloads through `FontRead` and `FixedSize`,
  replacing Rust's native-layout cast. BigEndian payloads retain their wrapper.
  `ClassMappings` names the first-glyph/classes pair, and `headerLen()` replaces
  the associated constant. Legacy reciprocal division, deleted-glyph classes,
  read-error precedence, and the differing null-offset behavior of `read` versus
  `fromParts` are preserved.
- The morx/mort state payload records remain borrowed generated views and add
  `FontRead` conformance for entry decoding. Cached parts preserve the upstream
  distinction between direct reads and pre-resolved offsets. `SubtableParts`
  stores explicit arrays and `ReadArgs2` carries multi-argument kerning reads.
- `Kern.subtables` returns the named `Subtables` cursor. It preserves the OpenType
  last-subtable length exception and AAT's explicit lengths. `TagIndices` yields
  named index/tag pairs; malformed ranges and invalid UTF-8 are skipped as upstream.
  Kerning, feature-name and AAT lookup searches preserve Rust's exact candidate
  sequence, including malformed unsorted input; sorted duplicate keys select
  the rightmost matching entry.

## Milestone 6

- The CFF grammar emits the `ps.cff.v1` and `ps.cff.v2` public facades, matching
  upstream's ownership of generated types. INDEX offsets stay borrowed and use
  checked multiplication, subtraction and object ranges. The common `Index.Empty`
  retains the upstream distinction between an exact empty blob and a parsed
  zero-count INDEX with a header.
- `font/scripts/generate-ps-data` packs all 391 standard strings, predefined encodings
  and expert charsets from the immutable sources. `Sid.fromI32` explicitly keeps
  the low 16 bits. Charset iterators yield `CharsetEntry { glyph, sid }` in place
  of Rust pairs, retain the range cursor, and reject cumulative overflow.
- Custom encodings expose borrowed scalar/record arrays in named union fields.
  Supplemental lookup precedence, range saturation, glyph-count boundaries and
  Rust's exact FDSelect binary-search candidate sequence are preserved.

- Internal PostScript decoders use typed failures through small adapters, while
  public parsing methods retain Result/Option values. `DynamicFixed { value,
  scale }` names the dynamically scaled number pair. Decimal counters are checked
  and final exponent arithmetic uses wider intermediates so extremely long
  malformed encodings cannot overflow Silk integers.
- `Transform.scale` remains a public Option, so the containing Silk value is
  affine. `identity()` replaces the associated constant. Numeric scaling and
  matrix normalization preserve the upstream fixed-point arithmetic and rounding.
- `Stack.fixedArray(firstIndex, output)` fills a caller-owned slice because this
  compiler has no const-generic array lengths. `dropValues` replaces the reserved
  `drop` identifier. Numeric operands use the `IntoNumber` interface, and cursor
  types replace fixed-value and scalar iterators. Blend state keeps font and
  coordinate lifetimes separate and preserves the 16-entry scalar cache.
- DICT token and entry cursors replace Rust iterators and retain unknown-operator
  consumption, stack clearing and variable-operand state changes. Hinting values
  use fixed-capacity Blues and StemSnaps arrays with borrowed active slices.
  Cff/Cff2 accessors return Copy table views in place of shared references.
- `CffFontRef` and `Subfont` use affine Option fields and expose copied optional
  views. `HintedSubfont { subfont, hinting }` names the returned pair. Metadata
  strings remain borrowed UTF-8 views, with invalid strings absent. The unhinted
  private cursor retains upstream filtering; private offsets use checked addition
  before the same low-32-bit conversion. The SID private-range accessor supports
  the upstream malformed-dictionary tests.
- Charstring evaluation uses static context/sink interfaces and explicit recursive
  calls with unchanged type parameters. Recursion, stack capacity, instruction
  limits, reserved operators, hint callbacks and legacy shared operators follow
  upstream. A context's optional weight-vector slice replaces an empty default
  borrowed slice; None and an empty slice both mean no multiple-master blend.
- CFF evaluation allocates no parser storage. The shared Type 1 BuildChar operator
  keeps 32 inline entries and uses a Silk List only for larger arrays, matching
  upstream's lazy SmallVec allocation; allocation failure becomes InsufficientMemory.
  This does not add a Type 1 font parser. Subroutine index addition uses a wider
  intermediate to reject malformed signed overflow without trapping.
- `PathSinkAdapter` replaces Rust's blanket CommandSink implementation. The small
  shared PathSink contract is included as a CFF drawing dependency. Transform and
  degenerate-path adapters preserve FreeType's operation order and rounding; bounds
  are measured while transforming control points, before any bounding-box reduction.

- Public `ps` and `ps.cff` facades re-export the shared PostScript and unified font
  types. Generated dump imports preserve the CFF namespace instead of assuming
  every grammar lives under `tables`. Both dumpers use the public parsed views.
- Dump format 6 follows the top/font/private dictionary hierarchy, including
  malformed links, without letting arbitrary offsets create recursive traversal.
  Decoded operands are observed without blending; subfont and glyph measurements
  separately use four variation locations. Raw INDEX fields remain complete,
  while extra object/glyph probes explicitly stop at the 65,536-item sfnt domain.
  CFF fixture evidence is gzip-compressed because malformed top-DICT counts can
  produce JSON reports larger than GitHub's per-file limit; no observations are
  removed from those reports.

## Milestone 7

- Integer-set pages retain eight u64 words, cached membership counts, modulo-512
  indexing and ordered bidirectional iteration. Iterator structs expose `next`
  and `nextBack`; inclusive ranges use `U32Range { first, last }`. Local bit-count
  helpers fill stdlib gap 004. The reserved method name `union` is `unionValue`,
  consistent with the earlier flag types. Silk HashKey hashing preserves equality
  and ignores cached counts; its hash bytes are specific to Silk's hasher.
- U32Set retains separate page storage and its sorted page map. Shared lookups
  binary-search the map instead of updating Rust's atomic last-page hint; bulk
  insertion retains a local last-page cache. Set operations merge into fresh
  storage, then replace the receiver, rather than compacting it in place. This
  preserves membership, ordering and empty-page behavior while leaving the old
  set intact if allocation fails. Allocation is an explicit effect. Slice-based
  `fromValues`/`extend` and named cursors replace Rust's iterator/collect contracts.
- IntSet keeps inclusive/exclusive membership and exposes concrete cursors for
  domain values, members and ranges. Domain adds inclusive `nextFrom` and
  `previousFrom` operations to implement Rust's opaque iterators without scanning
  gaps in discontinuous domains. `Bound<T>` and `IntRange<T>` name range arguments
  and results. Equal mixed-membership sets hash their logical ranges identically.
  DomainValues carries no storage bound because compiler bug 007 rejects a
  bounded `Self` result in an interface; its consuming methods enforce Domain.
- Sparse bit streams use a validated BranchFactor enum instead of const-generic
  numeric branch factors. `toSparseBitSetWithBf` takes that enum, and
  `DecodedSparseSet { set, remaining }` names the bounded decoder's pair result.
  Decode errors remain Result values; allocation failures are a separate effect.
  A List with a front cursor replaces VecDeque; decoding preserves breadth-first
  order, early-bound skipping, exact remaining bytes, size limits and encoding
  tie order. Wide intermediate arithmetic avoids malformed-count overflow.
- Coverage and class intersections retain upstream search heuristics, overlap
  stopping rules, short-array handling and class-zero behavior, including the
  distinctions between `intersectedClassGlyphs` and `intersectsClassGlyphs`.
  Allocating intersections use effects; the general ClassDef boolean query also
  needs the allocator because upstream computes a set for wide class formats.
  The coverage heuristic uses explicit wrapping arithmetic for Rust's u32 cast
  and product. Range iteration and absent-class decisions preserve full glyph IDs.
- Blob provides static and owned byte storage. Owned clones copy their bytes:
  Silk Shared only lends data inside callbacks, so it cannot back escaping
  zero-copy table views. TableFunction uses a static TableCallback interface and
  snapshots the upstream tag catalog eagerly, once per tag. Tables owns blobs
  and checked byte ranges; TablesView supplies the borrowed TableProvider.
- Typed model table access reparses immutable bytes and maps parse failures to
  ValidationError, preserving missing-table errors. It has no interior-mutability
  validation flag. Raw named accessors preserve table bytes, while the generic
  TableProvider dataForTag remains absent as upstream. The model forwarding
  generator derives methods from the current provider and raw tags from the
  pinned upstream catalog; Phase 2 adds typed accessors with its parsers.
- Tables.new takes a Blob; fromTableFunction accepts an already resolved
  snapshot. These explicit constructors replace Rust's Into<Source> conversion.
  Variation.fromString replaces the string/tag pair conversion and keeps the
  upstream invalid-tag fallback. Allocation in model ownership is an effect.
- GlyphName keeps 63 inline UTF-8 bytes and its source. GlyphNameMap is an
  explicit provider-backed view for lookup and iteration, with a fromCff
  constructor for standalone CFF; it replaces the omitted full Font facade's
  name cache. GlyphNameIndex owns packed full names and byte ranges, so it has
  no self-reference. Construction sorts temporary borrowed entries before
  packing them; reverse lookup still chooses the first glyph with an exact
  stored name and never indexes synthesized names. Type 1 name tests remain
  outside the requested SFNT/CFF scope.
- Charmap is an explicit provider-backed view with a standalone-CFF constructor.
  It eagerly selects Unicode/variation subtables and retains borrowed raw views
  for individual encoding records. Those records and DMAP matches are resolved
  on request instead of storing a second allocated cache. Copied cursors borrow
  the font bytes, not the temporary facade. Eager TableFunction snapshots replace
  the upstream callback-cache test's lazy timing and full Font instances.
- Batched Unicode lookup accepts input/output slices and processes their shorter
  length, matching the upstream zipped iterator. Format 4/12 batches retain the
  preceding segment/group; all outputs after a miss are still written. Encoding
  keys preserve the 12-byte representation and distinct record identities.
- Unicode lookup and individual encoding lookup retain their different DMAP,
  symbol, Mac Roman and variation-selector rules. The pinned upstream individual
  format-0 encoding cursor appends a second scan after its generic iterator;
  the port preserves those repeated codes. Unicode iteration lists them once.
  Standalone CFF retains native encodings; glyph-name Unicode mapping is absent
  because AGL is explicitly excluded. Type 1-only tests remain out of scope.
- Metrics, GlyphMetrics and scaled metrics use explicit provider/coordinate
  constructors. Immutable table views are captured once per GlyphMetrics value;
  this replaces the full Font model's lazy caches. The base horizontal line is
  read without variation deltas for phantom-point setup, while the instance line
  retains MVAR fractions. Font-data, coordinate and supplied-extents borrows have
  separate lifetimes, including MvarInstance's data and coordinate lifetimes.
- The unhinted glyph loader ports the outline survey, floating-point simple and
  composite loading, phantom points, component transforms and point anchors used
  by metrics. It retains upstream recursion, point and component-edge limits.
  Owned Lists replace the packed scratch allocation; allocation is an explicit
  effect, and malformed outlines leave extents unavailable. No TrueType hinter
  or full public drawing facade is added by this dependency subset.
- PointCoord now supplies comparisons for variation interpolation. Requiring
  Silk's total Order interface excluded f32; concrete comparisons preserve Rust's
  floating-point behavior without adding an invalid total-order conformance.
  Composite offset magnitudes use the platform hypotf, as Rust's f32::hypot does.
- Scale takes an explicit numeric result parameter instead of an associated type.
  ScaledGlyphMetrics carries its static scale and extents-provider types;
  withGlyphExtents can borrow a provider for one query. MetricConverter replaces
  closure arguments in batches, with IdentityConverter for unchanged values.
  Batches process the shorter glyph/output slice. GlyphExtents.fromBounds uses a
  static ExtentsCoord contract so float and fixed coordinates retain their own
  comparison and subtraction behavior.
- Bitmap/COLR/VARC extents and their dependent model tests were completed with
  their Phase 2 parsers in milestone 9. Source-order selection now resolves the
  complete requested chain. The glyph/scaled unit tests are complete; differential
  gate evidence is recorded separately in PROGRESS.md.
- Public GlyphMetrics constructors collapse an all-zero coordinate slice to an
  empty borrowed view, matching the model instance builder's default-instance
  semantics. Callers still supply normalized coordinates explicitly; this subset
  does not introduce the full Font/InstanceBuilder or style-metrics facade.
- Six metrics cache tests are adapted to eager views: construction captures the
  needed views, default locations request no variation tables, and copied or
  repeatedly queried metrics do not call the provider again. Nondefault views
  may read gvar/glyf/loca even when HVAR/VVAR answers the subsequent query.
  The callback-backed Tables test verifies each extended raw table is supplied
  once; the eager raw-tag catalog also queries legacy tags, unlike upstream's
  demand-driven cache. Parsed values and extended-table precedence are unchanged.
- The two drawing-based glyph-metrics tests use generated expectations from the
  pinned Rust drawing paths. This independently checks every fixture glyph's
  box without adding the full glyf path-drawing API. The generator rebuilds and
  reruns the reference fixture binary, so --check detects expectation drift.
  The CFF/CFF2 drawing implementation itself retains its existing Silk tests.
- The scaled global/style facade is outside the requested GlyphMetrics/
  ScaledGlyphMetrics subset. Its all-fields and clipping-line tests are excluded;
  global line-end scaling is tested directly with a custom rounding Scale, and
  agrees with the vertical advance chosen by ScaledGlyphMetrics.

- Format 7 appends public model observations and layout IntSet intersections to
  the complete existing table dump. Glyph helpers retain the explicit sfnt-domain
  bound and also probe the last declared glyph and invalid IDs; mapping cursors
  have a stated Unicode-domain count bound. Fixed and floating-point values use
  raw bits. Both models read the same whole font/collection through Tables.
- Layout intersection observations run once per concrete graph node. Their
  short-lived allocator is local to the dump adapter; allocation failure becomes
  a dumper failure through WriterError. Public parser/IntSet effects are unchanged.

## Milestone 8

- The whole-corpus corruption campaign found a reversed gvar glyph-data range
  that the port rejected. Rust's Range::is_empty includes start greater than end,
  so dataForGid now returns no data for reversed as well as equal ranges. Offset
  addition remains checked before the emptiness decision. Narrow/extended table
  variants and both offset widths have regression coverage.
- Corruption checks compare complete dumps, including table errors. Process
  failures and traversal limits never count as parity. Resumable receipts bind
  observations to the source, exact executable bytes and mutation settings.
  Binary snapshots prevent a concurrent rebuild from changing a running campaign.

## Milestone 9

- Typed array offsets now resolve directly into borrowed ScalarArray or
  ComputedArray views. Counts are element counts and retain the upstream nullable
  and version-dependent access rules; palette flags/name IDs have a regression.
- BASE baseline constants and the metadata DLNG/SLNG tags use camelCase functions:
  Tag construction is not a const expression in the pinned Silk compiler.
  BaseInstance borrows font data and coordinates independently and exposes base()
  in place of Rust's Deref. Device pixels and design-unit variation deltas remain
  separate in BaseValue.
- Hdmx DeviceRecord exposes the upstream accessor methods. Its backing fields
  have private names because Silk disallows a field and method sharing a name.
- CVT accumulation uses explicit i32 wrapping addition, matching upstream release
  arithmetic and avoiding an integer-overflow trap on malformed tuple streams.
  Upstream's debug-only overflow panic is not reproduced.
- Dump format 8 adds Phase 2 fields and resolved offset arrays. Metadata strings
  are serialized as UTF-8 byte hex, preserving malformed-string errors without
  relying on platform text escaping. Signature blocks follow the public resolver's
  format and exact-length checks.

- The bitmap location/data model uses borrowed SmallGlyphMetrics and
  BigGlyphMetrics records, so BitmapLocation, BitmapMetrics and BitmapData carry
  a font-data lifetime. BitmapContent.Composite is a borrowed ComputedArray.
  Location arithmetic remains checked and indexTablesSize is deliberately ignored,
  matching upstream and FreeType. The five location formats preserve sparse-ID
  errors, image-data bases and empty image sizes.
- Bitmap traversal decodes each declared strike/glyph through the public location
  and image APIs, including metrics, packed bytes, PNG bytes and composite records.
  sbix glyph slices start separate traversal scopes because different bounded
  slices can have equal lengths; equal lengths alone do not identify aliases.

- COLR helpers return named ColorLayer and PaintWithId records in place of Rust
  tuples. PaintId is an offset within the owning COLR table, rather than a raw
  memory address. It preserves identity across base-glyph and layer lists for
  cycle detection within that table; it is not a cross-font identifier.
- The generator now forwards fields shared by every variant of a format group,
  as the Rust backend does, and provides MinByteRange for those groups. BASE's
  coordinate and COLR's clip-box accessors now come from that common generation.
  Resolved offset helpers remain on their concrete variants, as upstream does.

- MathConstant and its 56 selectors are generated from the same field order as
  MathConstants; all() returns a fixed value array rather than a static slice.
  MathKernEntryIter is an explicit cursor. MathValue keeps design-unit values and
  device pixel deltas separate, and VariationIndex records contribute no device
  adjustment, matching the upstream API.

- VARC glyph/component iterators retain copied borrowed table views, so they do
  not borrow a temporary facade. Component axisValues() and transform() return
  copied snapshots instead of references. Parsing borrows the component stream
  independently of the VARC table, as upstream does. Reserved flag payloads and
  packed-delta cursor advancement preserve the upstream lazy validation rules.
- VARC's upstream tests of private component parsing are included beside the
  implementation by the generator; no private parser is added to the public API.
  The existing font_types cast helper is now an exported module for the generated
  random-input test's bit-preserving conversions. Platform trigonometry is
  recorded in STDLIB-GAPS.md #005.

- Bitmap metric snapshots retain their borrowed sbix/CBDT/EBDT sources eagerly.
  Strike selection runs at the query's ppem, preserving the distinction between
  selecting one strike for metrics and searching all strikes for drawing. Only
  bitmap validation, selection and extents needed by GlyphMetrics are added; the
  unrequested pixel-decoding/drawing facade is not introduced.
- BitmapSource and OutlineSource use tryFrom(GlyphSource) and toGlyphSource() in
  place of Rust conversion traits; failure retains the original GlyphSource.

- VARC metrics validate the complete component graph before measuring it, then
  traverse at each component's coordinates. Both walks retain upstream's 64-level
  and 2,048-edge limits; cycles draw nothing and conditional components still
  count during validation. Internal axes come from the maximum fvar/gvar/CFF2
  axis count, so static fonts with internal gvar axes work at the default instance.
- The metrics-only traversal uses allocator-backed coordinate/delta lists instead
  of upstream's caller-supplied scratch block and atomic layout cache. The three
  scratch-layout/cache tests and the ppem-only matrix helper test belong to the
  unrequested drawing facade. Fourteen other VARC model tests are ported, with
  additional repeated-axis, deep-graph and hidden-malformed-component regressions.
  Every transformed control point is accumulated before the resulting extents
  are converted to F48Dot16. These bounds also supply COLR outline clips.

- COLR metric bounds resolve every paint format but retain only values affecting
  bounds. Palette colors and opacity do not affect upstream's BoundsSink. Gradient
  stop ranges and degenerate linear/sweep cases still decide whether a fill
  exists. Glyph clips use drawn outline control boxes, including VARC when its
  source precedes the selected base; a color-only order uses the default outlines.
- COLR transform and clip state is passed by value through the bounded traversal,
  instead of maintaining PaintSink stacks. The 64-level, 16,384-node and paint-ID
  cycle limits are retained, as is transform peeling beneath PaintGlyph. Stack
  unwinding and cached-scalar tests for the unrequested drawing/cache facade have
  no corresponding mutable state here. Variation deltas retain implicit outer
  indices and stop before u32::MAX; metric clip-box deltas round to whole units.
- Rust's f32 min/max ignore a single NaN, while Silk's propagate it. The control
  and clip bound helpers explicitly implement Rust's behavior. This matters for
  overflowed transforms on malformed graphs, even though parsed fields are finite.
- The source-order optimization test uses independent upstream metric records for
  every glyph, seven orders and seven font/instance cases because this port has
  one dispatch path. Provider-probe tests check the established eager snapshot
  contract: queries and order changes never recall the provider or use excluded
  sources. Unrequested Type 1 cases remain excluded.

- Mixed-source metrics reject glyph IDs at or past the font's declared count.
  A sole bitmap or COLR source keeps upstream's independent boundary behavior.
  A failed chosen base can fall through to later layered sources; it never selects
  a second base or enables a VARC source occurring after that base.
- The deliberately 4,096-deep VARC condition is checked directly by the ported
  model rejection test. It is excluded from whole-field differential fixtures
  because it exceeds the dump adapter's graph bound; an incomplete dump is never
  counted as a successful comparison.
- During Phase 2 import expansion, the local incremental cache produced symbol
  resolution errors that disappeared with a clean cache. Three reduced incremental
  builds (adding and reordering exported modules and imports) all passed. This is
  an unreproduced cache incident, not a confirmed additional compiler defect;
  compiler-bugs/ holds the independently reproducible reports. Generation
  and compilation are serialized to avoid reading sources while they are replaced.

- Drawn glyf bounds pass through the upstream contour-to-path state machine,
  including cubic controls and implied midpoint interpolation. Malformed contours
  reject the entire outline; a COLR clip discards any points emitted before that
  rejection. Raw glyph metrics retain their distinct point/header bounds. The
  private dependency supports f32, which is the precision used by these model
  queries; twelve upstream path tests are ported with fixed command traces.
