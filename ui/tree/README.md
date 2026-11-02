# ui-tree

The retained UI tree: nodes a client creates and changes with plain-data mutations, laid out by
[css-layout](../../css/layout) with [ui-text](../text), and painted into a
[ui_scene](../../graphics/ui_scene) `Scene` that the CPU reference or
[ui_renderer](../../graphics/ui_renderer) draws. It has no closures and no callbacks: ids are
integers the client chooses, and everything that crosses the boundary is a `Mutation` going in or
an `Event` coming out, so a framework in Silk or a JavaScript host can drive it the same way.

## Driving a tree

```silk
let mut tree = run UiTree.make(&collection)       // borrows a font_collection FontCollection
let mut batch = Batch.make()
run batch.fontFamily(1, "Inter, Noto Sans, sans-serif")
run batch.create(1, NodeKind.Box)
run batch.style(1, &[Property.Padding { side: Side.Top, value: Length.Px { value: 16.0 } }])
run batch.root(1)
run batch.text(1, 2, "Hello")                     // create, set text, append to 1
run tree.apply(run batch.take())
run tree.frame(FrameInput { width: 800.0, height: 600.0, scale: 2.0, time: 0.0 })
// tree.scene() is the frame; tree.pendingUploads() the atlas tiles it rasterized.
```

- **Mutations** (`mutation.silk`): `Create`, `InsertBefore`, `Remove`, `Destroy`, `SetStyle`
  (per `StyleState`: base, hover, active, focus), `ClearStyle`, `SetText`, `SetAttribute` (role,
  label, test id, tab index, cursor, disabled), `SetListeners` (a `LISTEN_*` bit set), `SetRoot`,
  `Focus`, `Blur`, `SetSource`, `SetCanvas`, and the resource definitions `DefineFontFamily`,
  `DefineImage` (PNG or JPEG bytes) and `DefineIcon` (SVG bytes). `apply` stops at the first
  mutation that fails and returns a `TreeError` naming its index; the ones before it stay
  applied. Destroyed ids can be used again.
- **Node kinds**: box, text, image, icon (an SVG tinted with the text color, sized to the font
  size unless styled), input (a box with an inner text run; editing comes with T5) and canvas
  (fill and stroke path commands in the node's content box).
- **Styles** are typed `Property` values. Text properties (family, size, weight, style, line
  height, color, alignment, white space, direction, decoration) inherit; the rest do not. Hover,
  active and focus variants apply over the base style while the node is in that state.
- **Events** (`node.Event`) carry the kind, the target id, the full root to target id path and a
  payload (pointer position, modifiers, value). Focus changes queue `Focus` and `Blur` events
  for nodes that listen; `takeEvents` drains them. Pointer and key routing is T4.

## Frames

`frame` resolves styles, lays out, and paints:

- **Layout** is incremental. Style changes reach css-layout only when they change a layout
  input, and an unchanged tree at an unchanged size skips `compute`.
- **Paint** walks the layout fragments, not the nodes. Boxes paint their background (solid or
  linear gradient), border (solid or dashed, per side, with radii), outer and inset shadow,
  opacity (an isolated layer) and `overflow: hidden` clip. Text is drawn from css-layout's text
  fragments: each fragment's `shapeKey` names the glyph run ui-text shaped during layout, so
  nothing is shaped twice. Inline boxes paint their decorations per fragment, so a highlighted
  span split across lines gets one background per line with the outer edges only on its first
  and last pieces. Underline, overline and line-through follow the text color or a decoration
  color, wavy or straight. Glyphs, icons and images go through the shared atlas as sprites.
- **Replay.** Each fragment gets a hash of everything that affects its subtree's paint. When a
  subtree's hash, clip and scale match the previous frame, its operations are copied with
  `Scene.replay` instead of being painted again. `tree.stats` (`FrameStats`) counts replayed and
  repainted subtrees, painted fragments, glyphs, primitives and layout work.

## Inspection

For people and agents looking at a running UI (`inspect.silk`):

- `info(tree, id)` gives a node's kind, parent, bounds, focus and hover state and paint order;
  `fragmentsOf` its layout fragments with border, padding and content rects; `childrenOf`, and
  `findAll(tree, value)` finds nodes by test id, label or text.
- `describe(tree, options, &mut out)` writes a deterministic text snapshot, one line per node
  with role, label, test id, text and rects, and with `DescribeOptions.withStyles()` the styles
  that differ from the defaults or the parent. `describeNodeById` does one subtree.
- `CpuSnapshot` renders the whole frame, or one node's subtree cropped to its box
  (`renderNode`), with the CPU reference; `encodePng` turns either into PNG bytes.

## Tests

```sh
silk test --manifest-path ui/tree/tests/silk.toml --root src/tests.silk
silk build --manifest-path ui/tree/tests/silk.toml
build/llvm/x86_64-unknown-linux-gnu/debug/ui-tree-tests ui/tree/tests/goldens [--update]
python3 ui/tree/scripts/test-browser
```

- The unit tests cover replay (an unchanged frame replays the whole tree; changing one card's
  background repaints that card and its ancestors and replays the rest, with pixels equal to a
  fresh tree), relayout after text changes, failing mutations and id reuse, inheritance and
  state variants, focus events with paths, and the inspection queries.
- The goldens are the two trees in `fixtures/` (a card list with icons, an inline highlight
  across lines, an image, an opacity layer, a canvas chart and a clipped box; a sign-in form
  with a focus ring, a gradient button, a checkbox, an underlined link and a dashed note), each
  as a PNG (tolerance 2 per channel) and a `describe` text that must match exactly.
- `scripts/test-browser` builds `browser/` for wasm32 and draws both trees with ui_renderer on
  `navigator.gpu` in the installed Chromium, RGBA8 and BGRA8, against the CPU reference of the
  same frame, with graphics/demo's limits (max 96, at most 0.2% of channels over 8, mean 0.25).
  On SwiftShader both trees stay under a mean of 0.07; the largest difference (75) is on the
  edge of the form's link underline.

Fixtures use graphics/demo's embedded Noto Sans subsets, icons and photo, so the native tests and
the wasm build draw the same bytes.

## Limits

- Paint follows tree order: no `z-index` stacking contexts yet.
- One box shadow per box, and the `overflow: hidden` clip is the padding box rectangle, not
  rounded.
- Styles are resolved for the whole tree whenever any style changes (cheap next to layout, but
  not incremental).
- Batches are not atomic.
- The atlas never evicts.
- Scrollbars take no space; scrolling, hit testing and pointer events come with T4.
