# Test fonts

Subsets of fonts from resvg's test corpus (`crates/resvg/tests/fonts` at the pinned
revision in `tests/suites.lock.json`), used by the font database and text tests. All are
under the SIL Open Font License; the license files sit next to them.

- `NotoSans-{Regular,Bold,Italic,Black,Light,Thin}`, `NotoSerif-Regular`, `NotoMono-Regular`:
  `pyftsubset <font>.ttf --unicodes="U+0020-007E" --layout-features='*' --name-IDs='*' --name-languages='*'`
- `RobotoFlex`: resvg's subset with every axis but `wght`, `wdth` and `slnt` pinned to its
  default (`fontTools.varLib.instancer`).
