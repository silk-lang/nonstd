# Silk editor

An experimental retained editor library: a Silk document compiled to WebAssembly, the existing
Silk WebGPU renderer, and a dependency-free JavaScript API with TypeScript declarations.

The scene lives in WASM. JavaScript owns immutable property snapshots, undo history, DOM input,
and application events. Rectangles, ellipses, text, gradients, borders, and rectangle shadows
are composited on one WebGPU canvas. Application panels remain ordinary HTML.

## Try the demo

From the repository root, using its pinned Silk compiler and Clang 22+:

```sh
python3 graphics/editor/scripts/browser serve
```

Open **http://127.0.0.1:8050/** in a WebGPU browser. The studio includes a layer list,
property inspector, shape insertion, JSON export, a 100,000-layer stress scene, and a performance
lab that compares Silk with full DOM, viewport-culled DOM, and DOM with a compositor hint.
The default stress scene fits every artboard into view; choose a cropped workload to exercise culling.
The lab also supports zoom plus 1,000 width edits per frame and optional shadows. Its bars show
frame cadence (higher is better); synchronous CPU time alone excludes DOM layout and painting.

Drag to move; drag the bottom-right handle to resize. Shift-click extends selection.
Space-drag or middle-button-drag pans. Ctrl/Command-wheel zooms around the pointer.
Arrow keys nudge, Shift-arrow moves ten units, Delete removes, Command/Ctrl-Z undoes,
and Command/Ctrl-Shift-Z redoes. Escape cancels a drag. `pointercancel`, lost capture,
and focus loss also cancel it.

## Embed the library

```sh
python3 graphics/editor/scripts/browser build
```

`dist/` is a self-contained browser distribution: `editor.js`, `interaction.js`, their `.d.ts`
files, the WASM module, and the generated WebGPU host. Copy the **whole directory** to your
application. Serve WASM as `application/wasm` and JavaScript as `text/javascript` over HTTPS
or localhost. No bundler or runtime npm dependency is required. `package.json` also exposes
these files for package-aware consumers; this package has not been published to npm.

A complete browser example, with `dist/` next to the page:

```html
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Silk canvas</title>
<style>
  #stage { position: relative; width: 800px; height: 600px; }
  canvas { display: block; width: 100%; height: 100%; }
  #selection { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
</style>
<div id="stage">
  <canvas id="canvas" aria-label="Design canvas"></canvas>
  <div id="selection" aria-hidden="true"></div>
</div>
<script type="module">
  import { Editor } from './dist/editor.js';
  import { attachInteractions } from './dist/interaction.js';

  const editor = await Editor.create({ canvas: document.querySelector('canvas') });
  attachInteractions(editor, { overlay: document.querySelector('#selection') });
  const card = editor.rect({
    x: 80, y: 80, width: 240, height: 150, radius: 16,
    fill: '#c0acef', border: '#ffffff50', borderWidth: 1,
    shadow: '#00000040', blur: 24, shadowY: 8,
  });
  editor.text('Hello, Silk.', { x: 105, y: 115, fontSize: 28, fill: '#312944' });
  editor.on('change', event => console.log('Changed IDs:', event.detail.ids));
  editor.on('error', event => console.error(event.detail.error));
  editor.select([card]);
  window.addEventListener('pagehide', () => editor.destroy(), { once: true });
</script>
</html>
```

Each editor owns an independent WASM instance, GPU device, atlas, and canvas surface. Creation
rejects if WebGPU is unavailable, initialization fails, or it takes over 30 seconds. Call
`destroy()` at unmount to release input listeners, observers, pending frames and GPU handles.
Destruction is idempotent. Device/rendering errors are surfaced; automatic device recovery
is not implemented.

## API

The complete declarations are in [`js/editor.d.ts`](js/editor.d.ts). Useful operations:

| Operation | Contract |
| --- | --- |
| `rect(properties)`, `ellipse(properties)`, `text(content, properties)` | Add an element and return a nonzero stable numeric ID. Insertion order is paint order. |
| `get(id)`, `elements()` | Immutable snapshots; iteration follows paint order, including after undo. Unknown IDs return `undefined`. |
| `update(id, patch)` | Validate before replacing properties; unknown IDs throw. |
| `remove(id)` | Remove an element; unknown IDs return `false`. |
| `batch(editor => …)` | Synchronous transaction, one change event and one undo step. Exceptions roll back document changes. Nested or async transactions are unsupported. |
| `beginTransaction()`, `commitTransaction()`, `cancelTransaction()` | Group an interactive gesture across multiple pointer events. Rendering can continue during a group. |
| `undo()`, `redo()`, `clearHistory()` | Up to 100 change groups. Restoring a removed element preserves its identity and paint order. |
| `select(ids)`, `selection` | Select live, visible, unlocked elements. Selection is separate from undo history. |
| `hitTest(x, y)` | Topmost visible, unlocked shape at a world point, or `null`. Rounded corners and ellipses use geometric tests. Shadows do not receive hits. Text hits its rectangular bounds. |
| `setViewport({x,y,zoom})`, `zoomAt(zoom, screenX, screenY)` | Camera origin in world units; zoom in CSS pixels per world unit. |
| `screenToWorld(x,y)`, `worldToScreen(x,y)` | Convert coordinates relative to the canvas's CSS content box. |
| `resize(width,height,pixelRatio)` | CSS viewport size and device scale. ResizeObserver tracks layout size; call resize to change device scale. |
| `render()`, `invalidate()`, `flush()` | Submit immediately, schedule one frame, or wait for submitted GPU work. Normal rendering never waits for GPU completion. |
| `stats`, `diagnostics` | Last frame's build/encode times, visible elements, main-pass visits and draw batches; WASM bytes, live GPU handles and text runs. |
| `toJSON()`, `load(document)` | Version-one geometry/style document. Loading replaces elements in one undo group and allocates new IDs. The exported camera is informational; load keeps the current camera. |

Positions use world units, positive y down. Sizes must be positive; radius, blur and border widths
must be nonnegative. Numeric geometry is finite, bounded to ±1,000,000, and stored in WASM as f32.
Zoom ranges from 0.02 to 64. Canvas dimensions are limited to 8192 physical pixels per side.
Colors accept `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`, in straight-alpha sRGB.

Rectangle styles include a uniform corner radius, uniform border, two-stop linear gradient
(`gradient: {to: '#hex', angle: 90}`), and an optional drop shadow. Gradient angles are clockwise
from up; blur follows CSS's convention (twice the Gaussian sigma). Ellipses support fills and
gradients; borders and shadows on ellipses are explicitly rejected.

`hidden` suppresses painting and hits. `locked` suppresses hits but keeps painting. Transparent
shapes still hit their geometric area. Making an element hidden or locked removes it from selection.

Text is one line, shaped and rasterized by browser Canvas2D once at 2×, then uploaded as a
premultiplied texture to Silk's atlas. The browser's installed fonts determine its appearance;
await your webfonts before creating text. `fontFamily`, numeric `fontWeight`, `fontSize`, and
`fill` control the raster. Width/height changes scale the existing raster. Text is not re-rasterized
on zoom; large magnification can look soft. Atlas entries are immutable so undo can reuse them;
they live until destruction, with at most 4096 cached runs and eight atlas textures. Full atlases
raise an error. Text bounds are not tight glyph hit regions. Text has no native editing/IME API yet.

Events are `CustomEvent`s; payloads are in `event.detail`. `on(name, listener)` returns an
unsubscribe function. `change` reports affected IDs and a source, `selectionchange` reports IDs,
`viewportchange` reports the camera, and `render` reports timings. The optional input controller
also emits `pointerdown`, `pointermove`, `transformstart`, `transform`, and `transformend`.
Preventing `pointerdown` or `transformstart` stops the default manipulation. Notifications fire
after WASM calls return, so event listeners do not reenter an outstanding Silk loan.

Keep event listeners lightweight. Listeners that synchronously mutate the document should avoid
creating notification loops. Undo and rollback restore element state, not selection, camera,
or external side effects performed by a callback.

## Architecture and performance

- [`src/document.silk`](src/document.silk): stable slots, rounded/ellipse hits, conservative
  64-element bounds blocks, and lowering into `ui_scene.Scene`. Dirty block bounds rebuild once
  before the next hit test or frame, even after many edits to that block. Consecutive rectangle runs
  share one conservative ordering bound, even among shadows, paths, and text. Runs stop at
  mixed primitives and culling-block boundaries. Entire rectangle-only scenes without shadows
  use one pinned order. The shared scene sorter sorts equal-key runs and copies them in bulk.
- [`browser/src/bridge.silk`](browser/src/bridge.silk): the owned WASM token, asynchronous GPU
  initialization, surface, and reusable renderer/atlas. The raw C ABI is private and trusted;
  use the validated JS wrapper. Never call it with invented pointers or expired tokens.
- [`js/editor.js`](js/editor.js): validated property snapshots, change groups, history, camera,
  on-demand scheduling and text uploads. [`js/interaction.js`](js/interaction.js) is optional.
- Existing [`ui_scene`](../ui_scene), [`ui_renderer`](../ui_renderer), [`vector`](../vector),
  [`atlas`](../atlas), and [`gpu/webgpu`](../../gpu/webgpu) own ordering, path coverage, shaders,
  persistent GPU buffers, atlas allocation, and browser GPU bindings.

A frame culls world-space paint bounds **including shadow reach**, transforms visible shapes
once into physical pixels, and lets the existing renderer batch them. Ordering bounds round
out to covered pixels, so fractional edges keep painter order. `stats.visited` counts main-pass
element visits; rectangle-run bounds lookahead is additional and limited to the same 64-slot block.
The cropped 100,000-rectangle grid draws about 110 visible elements in one instanced draw. The overview benchmark
keeps all 100,000 elements visible across 1,000 synthetic artboards, with no level-of-detail
removal or artboard raster cache. These artboards are flat background rectangles, and their
text-like bars are rectangles, not text. Idle editors schedule no frames.

Blocks follow insertion order. Spatially coherent documents benefit most; randomly interleaved
or heavily overlapping shapes can force a full scan. Removed slots are kept for stable IDs and
undo, so repeated import/delete cycles can grow the slot store. Recreate the editor to compact
it. This is an initial library boundary, not a completed design application: there are no groups,
rotation, arbitrary paths/images in the JS API, blend modes, collaboration, snapping, export to
SVG/PDF, or semantic accessibility tree for canvas content. The application supplies accessible
panels/alternatives and any text-entry overlay.

Measurements, methodology, raw samples, and the optimization record are in
[`bench/RESULTS.md`](bench/RESULTS.md). DOM performance depends strongly on workload and culling;
these tests do not establish universal renderer rankings.

## Validation

```sh
python3 graphics/editor/scripts/check
# Point these at installations already available on your machine:
export PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright
export PLAYWRIGHT_CHROMIUM_EXECUTABLE=/absolute/path/to/chrome
python3 graphics/editor/scripts/check --browser
node graphics/editor/web/test.mjs --bench
EDITOR_WORKLOAD=edit node graphics/editor/web/test.mjs --bench
EDITOR_WORKLOAD=overview EDITOR_MODES=silk,dom-composited node graphics/editor/web/test.mjs --bench
EDITOR_COUNTS=100000 EDITOR_SHADOWS=1 node graphics/editor/web/test.mjs --bench
```

Browser tests check GPU pixels, clipping, conservative shadow culling, camera/DPR transforms,
text atlas output, translucent rectangle ordering across fast/mixed paths, history, identity,
transaction rollback, independent instances, destruction,
and real pointer drag/resize/cancel plus keyboard edits. Browser/benchmark output goes to
`build/editor-results/` (override with `EDITOR_RESULTS`). Benchmarks have no timing assertions.

On Linux, run browser commands under `xvfb-run -a` and set `EDITOR_SOFTWARE_GPU=1` if hardware
WebGPU is unavailable. Software GPU numbers must not be compared to the hardware results here.
The test runner uses existing browser installations; it does not download browsers.

On macOS, pinned Silk dev.45's unit runner references `alarm`, which its generated libSystem
stub omits. `scripts/check` runs native tests with Clang 22 and the SDK's real libSystem instead;
this only changes the test link command. It does not patch the compiler or standard library.
