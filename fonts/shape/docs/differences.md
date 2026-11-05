# Differences from harfrust

No glyph-result differences are known in the pinned non-macOS suite. The port
retains upstream's observable work-limit output, including partial results,
and the insertion driver's ignored Kashida-like setting.

The native API borrows `FontRef` bytes through `ShaperData` instead of duplicating
Rust's owning font/instance wrappers. `UnicodeBuffer` and `GlyphBuffer` name the
same checked `Buffer` type. Glyph views project from combined internal storage;
they are not Rust-layout slices or raw HarfBuzz strided pointers. Static
`FontFuncs` implementations replace Rust trait objects and closures; tracing
callbacks live in those implementations. Optional ICU and libm Rust dependency
switches have no Silk equivalent; the pinned Unicode tables are used directly.
Plan keys conservatively compare all variation coordinates. CLI differences
are described above.

Silk workarounds are documented and reproduced in
[silk-lang/silk#2425](https://github.com/silk-lang/silk/issues/2425)
(plans store table offsets instead of views),
[silk-lang/silk#2428](https://github.com/silk-lang/silk/issues/2428)
(an owned one-element coordinate array) and
[silk-lang/silk#2431](https://github.com/silk-lang/silk/issues/2431)
(glyph insertion and removal).
Neither the compiler nor its standard library is patched or vendored.
