# Standard-library gaps

No new missing API blocked milestone 0.

## 001 — truncating and signed bit reinterpretation integer conversions

Big-endian signed font fields and fixed-point arithmetic need signed/unsigned
reinterpretation and truncation. The release's `toI16`/`toU32` conversions trap
outside their numeric ranges; `checkedTo…` correctly returns None but does not
reinterpret bits. `font/types/src/cast.silk` implements these operations using
bounded arithmetic and masks, including signed minimum values. It is covered by
`signedCastBoundaries`; no compiler or stdlib changes are required.

## 002 — reusable buffered stdout writer

`silk.io.writer_native.StdoutWriter` is deliberately unbuffered and the pinned standard
library has no generic buffered writer. Field-by-field differential output can
make millions of small writes. The CLI's `buffered_stdout.silk` implements Writer
with a fixed 64 KiB buffer and explicit fallible flush. The standard library is
unchanged; output bytes and parse behavior are unchanged.

## 003 — mutable slice subviews

The pinned `silk.collections.slice.Slice` exposes only `view(&[T], offset, length) -> &[T]`.
It cannot supply a mutable subrange of an existing `&mut [T]` (and has no
`viewMut` operation). Axis normalization passes checked lengths alongside whole
scratch slices to private helpers, avoiding pointer conversions or an allocation
for each subview. Shared snapshots still use `Slice.view`. The stdlib is unchanged.

## 004 — integer population and leading/trailing bit counts

The pinned `silk.num.u64` module has bitwise operations and shifts but no equivalent
of Rust's `count_ones`, `leading_zeros` or `trailing_zeros`. Sparse integer-set
pages need all three. `collections/int_set/bitpage.silk` supplies bounded SWAR
population counting and binary-search bit scans, including the zero-input result
of 64. The 27 original page tests cover full/empty words, bit 63, page boundaries,
forward/reverse iteration and set counts. The stdlib remains unchanged.

## 005 — platform f32 tangent and trigonometric parity

The pinned f32 module has deterministic sin/cos approximations (documented to
within four ULP), and no tangent function. VARC transform matrices must agree with
upstream's platform f32 trigonometry. `tables/varc_impl.silk` and COLR metric
transforms call the platform `sinf`, `cosf` and `tanf` through the C ABI, as the glyph
loader already does for `hypotf`. The stdlib and compiler remain unchanged. The seven upstream matrix
tests and bitwise differential matrix observations cover this adaptation.

## 006 — `Option<T>` is not `Copy`

`Option<T>` has no `Copy` impl even when `T` is `Copy`, and a struct with an
`Option` field cannot be declared `Copy` (SEM0083). Copyable model snapshots
therefore use `model/optional.silk`'s `Maybe<T>`, and `CffFontRef` keeps its
optional top dict fields as `Maybe` so `GlyphMetrics` can hold a parsed font
instead of re-parsing it per glyph. Filed as
[silk-lang/silk#2434](https://github.com/silk-lang/silk/issues/2434).

## 007 — Unicode normalization data version and missing combining classes

The pinned stdlib reports Unicode 17.0.0, while `ucd` owns Unicode 18.0.0.
The difference is not solely a version upgrade: 34 nonzero combining classes
already assigned in Unicode 17 are missing from stdlib data. Another 34 are
genuine Unicode 18 additions. Full-domain raw canonical pair maps agree;
all 20,171 Unicode 18 normalization rows expose 134 NFC and 134 NFD mismatches.
`text/ucd/scripts/check-normalization-gap` reproduces and classifies these differences.
The minimal CCC/NFC/NFD reproducer is
[silk-lang/silk#2487](https://github.com/silk-lang/silk/issues/2487),
reported as [silk-lang/silk#2487](https://github.com/silk-lang/silk/issues/2487).
Harfrust uses `ucd`'s Unicode 18 classes and raw pairs, not stdlib string
normalization. No compiler or stdlib data is patched or vendored.

## 008 — SVG floating-point math

The dev.27 numeric modules lack `atan2`, `hypot` and the wider transcendental
surface required by SVG arcs, CSS colors and filters. Existing request
[silk-lang/silk#2539](https://github.com/silk-lang/silk/issues/2539) now includes
a minimal SVG reproduction. `images/svg/geometry/src/math.silk` supplies pure-Silk
finite-input geometry helpers; no libc shim, compiler or stdlib patch is used.

## 009 — checked DEFLATE output bound

`Deflate.encode` takes caller-owned storage without exposing a capacity bound.
`images/svg/image/src/png.silk` derives the zlib bound from the pinned fixed-Huffman
algorithm and validates dimensions before allocation. Filed with a self-contained
reproducer as [silk-lang/silk#2565](https://github.com/silk-lang/silk/issues/2565).

## 010 — XML and PNG APIs

The pinned stdlib has no XML parser or PNG codec. The original `svg_xml` and
`svg_image` implementations isolate those responsibilities, reusing stdlib
collections, Unicode, compression and checksums. Requests with minimal manifests
and observed missing-module diagnostics:
[XML #2563](https://github.com/silk-lang/silk/issues/2563) and
[PNG #2564](https://github.com/silk-lang/silk/issues/2564).
There is no working stdlib alternative for a before/after Ir comparison.

## 011 — reusable CSS syntax, selectors and cascade

The dev.27 source/module inventory contains JSON/TOML scanners and UTF-8/Unicode
primitives, but no CSS tokenizer, component-value/rule/declaration parser,
selector parser/matcher/specificity API, or property-independent cascade.
Filed [silk-lang/silk#2577](https://github.com/silk-lang/silk/issues/2577).
The [pinned import probe](https://github.com/silk-lang/silk/issues/2577) names an
illustrative namespace; absence of that name alone is not the inventory evidence.
`svg_css` owns syntax, static selectors, cascade, variables and conditional-rule
evaluation. Replace the general-purpose pieces when released APIs cover their
standards and bounded-resource contracts; SVG property semantics, element-tree
adaptation and computed-value projection remain project-owned.

## 012 — WHATWG URLs and IDNA

Filed [silk-lang/silk#2578](https://github.com/silk-lang/silk/issues/2578).
The existing `silk.uri` API implements RFC 3986, not WHATWG URL parsing:
`uri/uri.silk:1-14` excludes normalization/default-port rules and
`uri/reference.silk:21-24` excludes raw non-ASCII input.
`net/address.silk:415-416,897-931` checks ASCII/Punycode labels but explicitly
leaves Unicode mapping, contextual/bidi checks and internationalized-name
conversion to callers. It is not a complete UTS #46 implementation.
The [real-API probe](https://github.com/silk-lang/silk/issues/2578) distinguishes this
documented contract from the WHATWG acceptance condition; it is not a claim that
the RFC 3986 API is broken. `images/svg/src/url*.silk` owns URL parsing/resolution/
serialization and IDNA mapping/Punycode, reusing `ucd` normalization/properties.
Replace those general-purpose parts together when released URL/IDNA semantics
and resource bounds match; SVG resource authorization remains local.

## 013 — WHATWG legacy character encodings

Filed [silk-lang/silk#2579](https://github.com/silk-lang/silk/issues/2579).
The dev.27 `silk.text` inventory provides strict UTF-8 decoding and Unicode
normalization; `silk.encoding` contains Base64 and UUID, not text codecs.
There is no Encoding Standard label registry, legacy single-/multibyte decoder
suite, or replacement-decoding API. This includes windows-1252, GBK/GB18030,
Big5, EUC-JP, ISO-2022-JP, Shift_JIS and EUC-KR, not merely a missing UTF-8 helper.
See the [pinned import probe](https://github.com/silk-lang/silk/issues/2579).
`css/style/src/encoding*.silk` owns label lookup, pinned decoding tables and bounded
Unicode/legacy replacement decoding. Replace the generic codecs/tables when the
stdlib supplies equivalent error/reconsumption and output-bound contracts;
stylesheet protocol/`@charset`/environment fallback selection remains CSS-owned.
The existing XML request #2563 does not cover this web legacy decoder suite.

For 011–013, dev.27 source inventory establishes the gaps; illustrative import
names alone do not. Duplicate searches found no covering upstream requests.
The linked reproducers record observed macOS arm64 results: CSS/encoding import
checks report `MOD0001`; the real URI probe checks/builds successfully but rejects
the Unicode-host URL. There is no working stdlib A/B path, so no runtime
instruction saving is claimed. Local parsing, matching, decoding, normalization
and storage have real costs; full-renderer measurements do not isolate them.
