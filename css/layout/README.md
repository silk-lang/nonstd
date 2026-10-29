# css-layout

CSS layout for Silk: block, inline, flexbox and grid, with floats, positioning, scrolling,
writing modes and fragmentation. The algorithms are written from the CSS specifications, and
where a browser or another engine disagrees with the specification, the specification wins.
Text and replaced content are measured by a provider you supply, so the engine has no font
backend of its own.

Full CSS conformance is the goal, not the verified status today.
[SPECIFICATIONS.md](SPECIFICATIONS.md) lists the normative references, what is implemented and
the known gaps.

## Example

```silk
import layout.lib { Style, Display, DisplayOutside, DisplayInside, Dimension, Tree, LayoutTree, InvalidNode, OptionalSize, Rect, Measure, TextMeasure, TextError, FragmentationError, compute }
import silk.mem.allocator { Allocator, OutOfMemoryError }

/// Lays out a 300 px flex row holding a fixed 100 px sidebar and a growing main area, and
/// returns the main area's border box.
pub effect fn mainArea<M: Measure + TextMeasure>(provider: &mut M) -> Rect
  ! OutOfMemoryError | InvalidNode | TextError | FragmentationError
  ? &mut Allocator {
  let mut row = Style.make()
  row.display = Display.Box { outside: DisplayOutside.Block, inside: DisplayInside.Flex }
  row.width = Dimension.px(300.0)
  row.height = Dimension.px(200.0)
  let mut tree = run Tree.make(move row)
  let root = tree.root()

  let mut sidebar = Style.make()
  sidebar.width = Dimension.px(100.0)
  drop run tree.append(root, move sidebar)
  let mut main = Style.make()
  main.flexGrow = 1.0
  let content = run tree.append(root, move main)

  let mut output = LayoutTree.make()
  run compute(&tree, &mut output, move provider, OptionalSize.definite(800.0, 600.0))
  return run output.sourceBounds(content) // x 100, width 200, height 200
}
```

The `Measure` and `TextMeasure` interfaces answer measurement requests: font metrics,
scrollbars, sizes of opaque content, natural sizes of replaced resources, and line breaking and
shaping of text. Dependents import the package as `layout`.

## How it works

- **A source tree and a layout tree.** `Tree` holds elements, text and styles. `compute` borrows
  it and writes boxes and fragments into a reusable `LayoutTree`. Elements, generated boxes and
  physical fragments have separate identities, so one element can produce several boxes (for
  example an inline split across lines) or none.
- **Incremental by default.** Calling `compute` again after `setStyle`, `setText` or
  `setMeasurement` lays out only what the change can affect. Size results are cached per box
  and constraint, and unchanged formatting contexts reuse their previous fragments.
  `LayoutTree.stats` reports what each compute did.
- **Logical axes throughout.** Every algorithm works in the box's own writing mode, including
  orthogonal flows, vertical text orientation and full baseline tables.

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `css/layout` | `css-layout` | The engine |
| `css/layout/cli` | `css-layout-cli` | A JSON adapter: one layout request on stdin, one result on stdout |

## Tests

From `css/layout`:

```sh
scripts/check
```

The gate runs the native tests, 689 specification fixtures that cite the section they test,
283 fixtures that agree with Chrome, 271 malformed adapter requests, and a cache-correctness
check that compares layouts after updates with fresh layouts. `scripts/chrome-diff.mjs` compares
against Chrome and fuzzes block, flex and grid trees; it is a diagnostic, not a gate.

## Performance

`scripts/bench-compare` times `compute` alone against [taffy](https://github.com/DioxusLabs/taffy)
(Rust) and [yoga](https://github.com/facebook/yoga) (C++) on shared workloads, after checking
that all engines produce the same geometry. `scripts/bench-compare --updates` does the same for
re-layout after small edits. On the grid workloads, Silk takes between 0.11× and 1.10× taffy's
wall time.

## More

- [Reference](docs/reference.md): incremental layout, display and measurement, scrolling and
  sticky positioning, scrollbars, the JSON adapter schema, and the conformance and benchmark
  tools.
- [SPECIFICATIONS.md](SPECIFICATIONS.md): standards, coverage and policies.
- [LIMITATIONS.md](LIMITATIONS.md): workarounds for compiler gaps.

## License

[MIT](LICENSE). Downloaded specification documents keep their own licenses.
