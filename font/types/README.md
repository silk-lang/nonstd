# font-types

The scalar types every OpenType table is built from, for Silk. It is a port of
[font-types](https://github.com/googlefonts/fontations/tree/main/font-types) from Google's
fontations, and the foundation of [font-parse](../parse) and [font-shape](../shape).

It has no dependencies and does not allocate.

## What it provides

- **Big-endian codecs.** `BigEndian<T>`, `Scalar` and `readScalar`/`writeScalar` decode and
  encode table fields with bounds checks; `TableDataRef` and `HeaderRead` read fixed-size
  table headers.
- **Integers.** `Uint24`, `Int24`, `GlyphId16`, `GlyphId24`, `GlyphId`, `NameId`,
  `LongDateTime`, and the offsets `Offset16`, `Offset24` and `Offset32` (with `Nullable`
  for null offsets).
- **Fixed point.** `Fixed` (16.16), `F2Dot14`, `F4Dot12`, `F6Dot10`, `F26Dot6` and `F48Dot16`,
  with conversions to and from `f32`/`f64` and fontations' wrapping and rounding rules. Each one
  implements `silk.num.numeric.Zero` and `One`, so it works with the `silk.geometry` types. Signed
  and unsigned bit reinterpretation lives in `cast`.
- **Tags and versions.** `Tag` (with validation), `MajorMinor`, `Version16Dot16`, and
  the sfnt version constants.
- **Font units.** `FWord` and `UfWord`.

## Example

```silk
import font_types.lib { BigEndian, F2Dot14, Tag }
import silk.core.option { Option }

/// Reads a big-endian u16 at the start of `bytes`, or None if it is too short.
pub fn firstU16(bytes: &[u8]) -> Option<u16> {
  return match move BigEndian<u16>.fromSlice(bytes) {
    Option<BigEndian<u16>>.Some { value } => Option<u16>.Some { value: BigEndian<u16>.get(&value) }
    _ => Option<u16>.None
  }
}

pub fn example() -> bool {
  let weight = Tag.fromBeBytes([0x77, 0x67, 0x68, 0x74]) // 'wght'
  // Normalized variation coordinates are 2.14 fixed point.
  let halfway = F2Dot14.fromF32(0.5)
  return Tag.toU32(weight) == 0x77676874 && F2Dot14.toF32(halfway) == 0.5
}
```

## Tests

From the repository root:

```sh
silk test --manifest-path font/types/silk.toml --root src/tests.silk
```

The tests run in the `font` CI workflow.

## License

[MIT](../LICENSE-MIT) or [Apache-2.0](../LICENSE-APACHE), following fontations.
