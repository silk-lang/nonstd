# font-shape API notes

Details behind the overview in the [README](../README.md).

Allocation uses `OutOfMemoryError` and the `Allocator` effect. `shape` returns
`Result<(), ShapeError>` for invalid buffer/plan use. Malformed layout tables
are ignored or stop the affected operation. `Buffer.allocationSuccessful`
reports shaping work/size limits; system allocation failure remains an effect.
`Buffer.reset` also restores configuration defaults. Text appended with
`pushStr` uses UTF-8 byte clusters; `pushText(..., false)` uses character indices.

`ConfiguredShaper.setVariations` accepts `Variation` values. `setScale` accepts
separate signed X/Y scales in units per em; callback metrics are already scaled.
`ShapeOptions` accepts features, a borrowed `ShapePlan`, and point size.
Build a plan after setting segment properties and variations, then use
`ShapePlanKey.matches` in an application-owned cache. Keep caches per font.
Direction and script mismatches are rejected; the caller is responsible for
selecting a plan with matching font, features, language and variation coordinates.

`ConfiguredShaper.withFuncs` accepts a native `FontFuncs` implementation for
nominal/variation mapping, scalar/batch advances, origins and extents. Batch
views provide checked construction and indexed access, and preserve full
32-bit glyph IDs, including zero. Callbacks can query the font's default
implementations. For tracing, implement `tracing` and `message`; returning false
from a start message skips that operation. End/recursion messages are
informational. `Buffer.setTracing` toggles delivery across buffer reuse.

`serialize`, `serializeOptional`, `serializeWithoutFont`, and `serializeUnicode`
produce HarfBuzz text formats. `SerializeFlags`, `BufferFlags`, `GlyphFlags`,
`Feature`, `Language`, `Script`, and the `harfrust.unicode` module provide the
corresponding public options and queries. See the ordinary tests for complete
examples, including custom callbacks and plan reuse.

Unicode properties and the ISO `Script` value are supplied by the independent
[`ucd` package](../../../text/ucd/README.md). `harfrust.unicode` forwards the property queries
and keeps shaping-specific modified combining classes and RTL policy.
Font-specific script operations are functions in `harfrust.script`:
`tag(script)`, `horizontalDirection(script)`, `tags(script)`, and
`tagsForLanguage(script, language)`. `Script.fromIso15924Tag` now accepts a `u32`,
not a font `Tag`; `Script.parse` returns `Option<Script>`, while
`harfrust.script.parse` retains `Result<Script, ParseError>`.
