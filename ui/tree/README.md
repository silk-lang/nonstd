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
  (per `StyleState`: base, hover, active, focus, focus-visible), `ClearStyle`, `SetText`,
  `SetAttribute` (role, label, test id, tab index, cursor, disabled, focus trap),
  `SetListeners` (a `LISTEN_*` bit set), `SetRoot`, `Focus`, `Blur`, `ScrollTo`,
  `ScrollIntoView`, `SetSource`, `SetCanvas`, and the resource definitions `DefineFontFamily`,
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
  payload (pointer position, modifiers, button, click count, wheel delta, key and code, value).
  `takeEvents` drains them. See [Interaction](#interaction).

## Interaction

Hosts feed plain-data `Input` records (`input.silk`) to `tree.dispatch`: pointer move, down, up,
leave and cancel, wheel, key down and key up, with positions in CSS pixels and keys named as UI
Events name them (`key` `"Enter"`, `code` `"KeyA"`). [ui-tree-window](window) turns
platform/window events into them; tests and inspectors build them directly. The tree acts on
input against the last frame's layout, and the changes show at the next frame
(`tree.needsFrame()` says whether one is due).

- **Hit testing** walks the fragments topmost first (later siblings and children paint on top),
  skips descendants outside a clipping box's padding box, and skips nodes with
  `pointer-events: none` (not inherited) or `visibility: hidden`. Text is never a target: its
  element is, as in the DOM. `tree.hitTest(x, y)` answers the same question for clients.
- **Hover and active.** The hit node and its ancestors are hovered; pressing the primary button
  makes the pressed node and its ancestors active. Their `Hover` and `Active` looks apply, and
  enter and leave records go to listeners (leave deepest first, enter outermost first). Hover
  follows content that moves under a still pointer after scrolling or relayout.
  `tree.cursor()` is the hovered path's cursor (inputs default to the text cursor).
- **Pointer capture.** The node a primary press lands on gets the moves and the release until
  the button comes up, so drags keep their target. The click goes to the nearest common
  ancestor of the press and release targets, with the click count. Disabled nodes (and their
  subtrees) get no down, up or click and no active state.
- **Focus.** A press focuses the nearest focusable node at or above it, or blurs. Focusable
  means a tab index other than `NOT_FOCUSABLE` (the default for everything but inputs), laid
  out, visible and not disabled. Tab and Shift+Tab move through the tabbable nodes (tab index
  0 or more): positive indices first, lowest first, then tree order, wrapping; inside a node
  with the `FocusTrap` attribute they cycle within it. Focus that came from the keyboard shows
  the `FocusVisible` look (inputs always do), and Tab scrolls the new focus into view.
- **Keys** go to the focused node, or the root, with the key, code, modifiers and repeat.
  Enter on a focused button, link, menu item or tab and Space (on key up) on a button,
  checkbox, radio, menu item or tab queue a click with click count 0.
- **Scrolling.** Boxes with `overflow: auto` or `scroll` on an axis scroll with the wheel. Each
  axis of a wheel delta goes to the nearest container that can still move that way, and the
  rest goes outwards, so nested scroll boxes work. `hidden` scrolls only by mutation:
  `ScrollTo` (clamped at the next frame) and `ScrollIntoView` (the least scroll that shows the
  node, through every container around it). Offsets reach css-layout, which moves the
  fragments; `tree.scrollOffset(id)`, `info` and `describe` report them, and listeners get
  `Scroll` records with the new offset. Scroll containers with something to scroll draw
  overlay thumbs that take no space and can be dragged.
- **Records** for pointer down, up, move, click, wheel and keys are queued when the target or any
  node on its path listens (they bubble, client side). Enter, leave, focus, blur and scroll are
  queued only for a target that listens itself.

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
  with role, label, test id, text, focus, disabled, rects and scroll offsets, and with `DescribeOptions.withStyles()` the styles
  that differ from the defaults or the parent. `describeNodeById` does one subtree.
- `CpuSnapshot` renders the whole frame, or one node's subtree cropped to its box
  (`renderNode`), with the CPU reference; `encodePng` turns either into PNG bytes.
  `renderScene` draws another scene over the tree's atlas, such as an inspector overlay.
- [ui-inspect](../inspect) builds on these: queries by role, name and text, hit paths and an
  element picker, the devtools highlight overlay, a node view, synthetic input, and session
  record and replay.

## Tests

```sh
silk test --manifest-path ui/tree/tests/silk.toml --root src/tests.silk
silk build --manifest-path ui/tree/tests/silk.toml
build/llvm/x86_64-unknown-linux-gnu/debug/ui-tree-tests ui/tree/tests/goldens [--update]
python3 ui/tree/scripts/test-browser
silk test --manifest-path ui/tree/window/tests/silk.toml --root src/tests.silk
python3 ui/tree/demo/scripts/demo [check]
```

- The unit tests cover replay (an unchanged frame replays the whole tree; changing one card's
  background repaints that card and its ancestors and replays the rest, with pixels equal to a
  fresh tree), relayout after text changes, failing mutations and id reuse, inheritance and
  state variants, focus events with paths, and the inspection queries.
- The interaction tests (`tests/src/interaction.silk`) script the inbox fixture with synthetic
  input and check the records (kinds, targets, paths, payloads), the states and looks, and
  what repaints: hover, press, capture and click, disabled nodes, pointer-events, Tab order
  with positive indices and focus traps, keyboard clicks, Tab scrolling the focus into view,
  wheel scrolling with nested chaining and clamping, hover following scrolled content,
  `ScrollTo` and `ScrollIntoView`, thumb dragging, and scrolled pixels equal to a fresh tree
  scrolled by mutations. `window/tests` sends platform/window events through the headless
  backend and the adapter into the same fixture.
- The goldens are the trees in `fixtures/` (a card list with icons, an inline highlight
  across lines, an image, an opacity layer, a canvas chart and a clipped box; a sign-in form
  with a focus ring, a gradient button, a checkbox, an underlined link and a dashed note; an
  inbox with a toolbar, a scrolling list and a nested scroll box with their thumbs), each
  as a PNG (tolerance 2 per channel) and a `describe` text that must match exactly.
- `scripts/test-browser` builds `browser/` for wasm32 and draws the trees with ui_renderer on
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
- Scrollbars are overlays that take no space; the arrow keys, Page Up and Page Down do not
  scroll yet, and the root does not scroll the viewport (give it `overflow: auto`).
- Hit testing uses rectangles: rounded corners and clip radii are not hit shapes.
- No style transitions yet, and no text editing (inputs take focus; editing is T5).
- Tab is always the tree's: a client cannot cancel it (use `FocusTrap` for dialogs).

## Window demo

`demo/` is the inbox in a native window (platform/window, ui_renderer on Dawn) and a tiny client:
it reads the records and answers with mutations (New appends a row and scrolls it into view,
Archive removes the focused row). `scripts/demo check` scripts a hover, a wheel and a Tab, reads
the surface back and compares it with the CPU reference, on X11 and Wayland under Xvfb and
Weston with lavapipe.

