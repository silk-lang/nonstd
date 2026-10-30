# Test fonts

Subsets of fonts from resvg's test corpus (`crates/resvg/tests/fonts` at the pinned
revision in `tests/suites.lock.json`), used by the font database and text tests. All are
under the SIL Open Font License; the license files sit next to them.

- `NotoSans-{Bold,Italic,Black,Light,Thin}`, `NotoSerif-Regular`, `NotoMono-Regular`:
  `pyftsubset <font>.ttf --unicodes="U+0020-007E" --layout-features='*' --name-IDs='*' --name-languages='*'`
- `NotoSans-Regular`: the same, with `--unicodes="U+0020-007E,U+00A0-00FF,U+0300-036F,U+0370-03FF,U+FB01-FB02"`
  for marks, composition and fallback.
- `RobotoFlex`: resvg's subset with every axis but `wght`, `wdth` and `slnt` pinned to its
  default (`fontTools.varLib.instancer`).
