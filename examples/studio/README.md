# Silk Studio — native

A desktop version of the Studio design editor, written in Silk. The pinned
`lib-ui` packages own the application model, controls, layout and text input;
`lib-native` supplies the native window, menus, clipboard, input method and file
dialogs. Canvas layers use the shared `lib-graphics` editor and renderer on
WebGPU/Dawn. The compiled app needs no browser, webview, JavaScript runtime or server.

## Run

From the repository root, with Node.js 22 or newer, the pinned Silk compiler on
`PATH`, and LLVM 22 configured through `SILK_CLANG`:

```sh
node examples/studio/scripts/studio --release
node examples/studio/scripts/studio --release --file ~/Design.silkdesign
```

The Node runner invokes Silk directly; package manifests provide native dependencies.
On macOS the window bridge requires macOS 14 or newer. Native platform dependencies
on Linux/Windows are the same as pinned `lib-native` and `examples/graphics-demo`; this port
was written on macOS arm64; the `check` run (a scripted click and Tab, read back and
compared with the CPU reference) also passes in X11 windows on Linux lavapipe.

The window app draws through `ui_app_window`, whose frames are drawn on a render thread from
the scene the app hands over. GPU-retained overview images (see
[PERFORMANCE.md](PERFORMANCE.md)) need a draw hook on that thread, so for now only
`--benchmark`, which keeps its own one-thread loop, uses them.

To build a self-contained macOS application, including fallback fonts:

```sh
node examples/studio/scripts/studio --release --bundle
open 'build/Silk Studio.app'
```

The local development bundle is unsigned. Its binary links only to macOS system
libraries/frameworks; it does not depend on a running compiler or this checkout.
The licensed Noto Serif/Mono fallback subsets and their OFL are kept in
`assets/fonts` and staged under `Contents/Resources/examples/studio/assets/fonts`.
The launcher changes to Resources so the same runtime paths work in the bundle.

## In the browser

`examples/studio/browser` (`silk-studio-browser`) is the same editor built for wasm32, in a
browser tab with WebGPU and JSPI (Chrome or Edge 137 or later):

```sh
node examples/browser serve examples/studio/browser   # http://127.0.0.1:8050/
```

The shared browser runner uses the published `lib-ui` browser payload and resolves
WebGPU exports/runtime assets from the pinned `lib-native` Git cache, not sibling
checkouts or deleted source trees. It preserves the 8 MiB wasm linker stack.

It keeps the document in the page's localStorage (under `silk-app:studio`), so a reload finds it
again; the first visit opens the starter design. There are no native menus or file dialogs:
opening, saving as and exporting files are the desktop app's, and the fonts are the bundled Noto
families. Add `?check` to the address for the same check as `--check`.

## Editing

The native shell follows the browser Studio's panel dimensions, compact typography,
sectioned inspector, palette, floating tool dock, zoom controls, and file menu. The
Design heading stays fixed while its properties scroll. Palette colors are ordinary
undoable edits; zoom buttons keep the canvas center fixed, and fit uses the same
artwork margins as the browser. Desktop file operations use native dialogs.
On macOS, the header extends behind the native traffic-light controls without a separate
title bar. Drag passive header space to move the window; buttons and the document name
keep their normal interactions.

- Select, marquee-select, drag, resize, Shift-constrain, Alt-drag duplicate, and
  use H or hold Space to pan. Cmd/Ctrl + wheel and trackpad pinch zoom at the pointer.
- Draw rectangles, ellipses, frames, and text with R, O, F, and T. Double-click text
  to edit it with native text input. V returns to selection.
- Inspect geometry, fills, opacity, strokes, corner radii, typography, outer and
  inner shadows, layer blur, backdrop blur, brightness, contrast, saturation, and
  blend mode. Group/ungroup, align, change order, hide, and lock layers.
- Use undo/redo, copy/paste within the document, pages, and a virtualized layer list
  with nested, collapsible groups/frames and search. Selection changes reuse the cached hierarchy. Shift+1 fits the page, Shift+2 fits selection, and 0 sets 100% zoom.
- **Commands → Add 100k rectangles** creates the supplied image as 100,000
  independently editable rectangles, with small gaps and two labels. It is not a
  flattened bitmap. **Add effects playground** adds a smaller filter demonstration.

## Files and exports

The first launch opens the Form & Field example and autosaves to
`~/.silk-studio.silkdesign`. Edits are encoded and atomically written on a background
thread; close, open, and Save As wait for pending writes. New asks for a separate
file before replacing the current document. Failed writes retain the open design.

Open and Save As use native dialogs. The version-1 `.silkdesign` JSON schema is shared
with the browser Studio. Import validates identifiers, hierarchy, numeric bounds,
colors, and node kinds before replacing the active document. Installed fonts can
produce different text metrics across platforms.

PNG exports selection (including descendants), or the visible page if nothing is
selected, against transparency. It caps the output at 4096 pixels per axis. SVG
keeps editable shapes and text and rejects backdrop blur, which it cannot preserve
reliably. SVG text metrics depend on fonts in the viewer.

## Validation

```sh
node examples/studio/scripts/test --release
node examples/studio/scripts/studio check --release
# After building ui-inspect-cli and ui-inspect-mcp in release mode:
node examples/studio/scripts/inspect-check --stress
node examples/studio/scripts/parity-check
```

The parity check opens an isolated copy of the browser starter at 1440×960 and
1000×700, exercises controls through the inspector, and saves screenshots and
semantic snapshots to `build/native-parity`. See [PARITY.md](PARITY.md) for the
comparison contract and platform differences.

All checks avoid the default user design: the window check uses an in-memory
starter; inspector/parity checks create and clean up fresh temporary documents;
camera checks use an in-memory workload or read `--file` without saving. Native
checks open real windows except `studio check` on Linux, which starts Xvfb and
headless Weston (`--backend x11|wayland|all`) and defaults to lavapipe. Inspector
checks require a working display. To check the bundled launcher safely, pass
`--app "$PWD/build/Silk Studio.app/Contents/MacOS/SilkStudio"` to `parity-check`.
Do not use an ordinary launch without `--file` as a smoke test.

The contract executable tests pointer-driven creation, native inspector input,
undo/redo, subtree transforms, Alt-drag/cancel, validated file round trips, selected
PNG/SVG exports, high-zoom vector text, cache reset, and 100k-element edits. It also
prints CPU timings for selection, UI layout, and scene construction. These are not
GPU timings or display FPS. The macOS test runner retains the SDK-link workaround
for compiler libSystem stubs that omit CPU-renderer math symbols. It requires an
absolute LLVM 22 `SILK_CLANG` path, wraps link invocations only, and removes its
temporary wrapper after the run.

The window check scripts real UI input, reads the GPU surface, compares it with
the CPU rendering of the same scene, and writes `/tmp/silk-studio-native-check.png`.
See [PERFORMANCE.md](PERFORMANCE.md) for the measured workload and limits.

The optional local UI inspector is off in release builds unless explicitly enabled:

```sh
SILK_UI_INSPECT=/tmp/silk-studio.sock node examples/studio/scripts/studio --release --inspect
```

For reproducible window sizes, the executable accepts `--width=1440 --height=960`.

Inspector screenshots include the complete canvas and controls. `--test-id canvas` crops
the canvas; `capture sequence.png --count 10 --interval 100` returns a contact sheet with
actual times and frame numbers. `pointer --phase down/move/up --x X --y Y` and
`key KEY --phase down/up` feed the same UI dispatcher and application event pump as window
input. Compound clicks process each event before the next. See the pinned
`lib-ui` repository's `inspect/cli` and `inspect/mcp` documentation.

Marquee movement requests a frame even when the selected IDs do not change. The canvas
revision participates in invalidation independently of the control tree. This covers empty
marquees, movement through gaps and clearing the marquee on release. Inspector requests
also receive composed frames when the window is occluded.

Canvas layers remain in the drawing document rather than becoming UI tree nodes. OS accessibility exposure is currently limited by the
shared window/UI bridge. Shape clipboard data is currently local to this app;
text fields use the OS clipboard. Snapping currently rounds drag positions to
whole canvas units. Cloud, collaboration, and font discovery are outside this port.

## Code

- `src/model.silk`, `editing.silk`: document state, history, gestures, bulk editing.
- `src/view.silk`: native UI, virtual layer list, inspector and on-canvas text input.
- `src/render.silk`: retained document/scene, scaled text tiles, viewport cropping,
  natural text sizing, selection overlays, and PNG rendering.
- `src/format.silk`, `exports.silk`: validated portable files and SVG output.
- `app/src/files.silk`: atomic storage, detached autosave jobs, desktop fonts.
- `app/src/desktop.silk`: native window, GPU presentation, dialogs, and event loop.

The stress image's 400×250 grayscale samples in `src/pixels.silk` are the same
user-supplied image data used by the browser demo. Text tile caches are invalidated
when replacing documents. Scene geometry is retained across selection-only frames.

## 100k image and text experiment

Open **Commands → Add 100k image + text cards**. Repeating the command returns to
that page without replacing edits. It contains 100,000 groups, each with an editable
image and text child, plus four heading/reference layers: 300,004 layers in total.
Each image is a distinct integer crop of the supplied tweet screenshot. This is
one shared source image, not 100,000 unrelated photos. Labels use 196 word pairs
from the tweet in Arial, Georgia and Courier New, with the normal native fallbacks.

The screenshot is embedded unchanged in the executable and SVG exports. Its ICC
profile is converted to sRGB for the native atlas. The optional, self-contained
Python 3 generator `python3 examples/studio/scripts/embed-tweet` regenerates the
embedded asset from `assets/tweet-challenge.png`; normal builds and checks do not
use Python. Native `.silkdesign` files preserve the browser's `image` and normalized
`imageCrop` fields, including coordinates precise enough for source-pixel round trips.

Repeated labels share measurements and raster tiles by text, font, weight, color
and dimensions. Small labels start with a bounded 4× density cache and use power-of-two raster
buckets. Large text uses finer density steps to avoid unnecessary viewport cropping
at bucket boundaries. Visible text bindings refresh in place. Spatial blocks restrict
quality checks to visible text. The scratch glyph atlas advances between label
rasters, so old font sizes can be evicted without dropping letters. Shared label
bindings carry the allocation generation and are refreshed when they enter view.
Cropped rasters include overscan and remain valid while they cover the visible text;
a small pan does not regenerate them solely because the preferred crop origin moved.
During camera gestures, native composition reuses available text pixels and schedules
full-density refinement after 150 ms without camera changes. Missing or newly exposed
text still renders immediately. The event loop wakes for refinement even if no more
input arrives; CPU captures through `Canvas.frame` and exports resolve text quality
synchronously.
The desktop atlas allocates up to eight 2048-pixel base pages per kind lazily;
high-resolution tiles can request larger pages. Unused canvas text tiles are
reclaimed under atlas pressure without evicting cached UI sprites. Shared renderer changes
batch compatible image crops and reuse image texture bindings within each pass.

Run the release contracts and the real-event inspector checks without a recording:

```sh
node examples/studio/scripts/test --release
node examples/studio/scripts/studio --release --build-only
node examples/studio/scripts/challenge-check --leave-open
```

The headless workload reports input, model, UI layout and scene composition CPU
time, excluding GPU work. The inspector test reports request-to-composed-frame
latency, including IPC and host scheduling. Neither measurement is presentation
FPS. It exercises fit-all through roughly 180% zoom and back twice, panning,
marquee redraw, direct canvas text editing and undo. Logs, PID and JSON report live
in `/tmp/silk-native-tweet` (or `--directory`). Each run uses a fresh temporary
design; `document-path` records its location. Without `--leave-open`, the app exits
and that temporary session is removed. With it, the detached app and isolated
document remain available for inspection. The default user document is untouched.

## Native camera performance and rendering regressions

Dense image-only overviews retain their geometry in GPU buffers; panning and zooming
update a camera uniform. Close views use viewport culling. Native chrome is composited
as a separate overlay, including its opacity layers. Grid, document effects, and
backdrop-dependent chrome use ordinary composition. Text raster updates preserve the
retained document and update the visible labels rather than rebuilding every layer.

After building the release app:

```sh
node examples/studio/scripts/camera-check
```

This runs 120 zoom inputs, 40 wheel pans, and a 40-movement hand drag through the native UI dispatcher with
and without retained geometry, then compares the two GPU outputs. Each run builds
an in-memory challenge and exits without reading or saving a user design. Results
and logs go to `build/native-camera-check`. The initial creation frame is excluded.
The numbers are CPU frame preparation and submission times, not display FPS or GPU
execution times. The executable also accepts `--profile` for frame-stage timings,
`--benchmark` for the scripted workload, and `--no-retained` for the ordinary path.
Use `camera-check --file /path/to/design.silkdesign` to measure a saved document without
saving changes; the executable equivalent is `--benchmark-file /path/to/design.silkdesign`.
The loader accepts documents up to 2 GiB and up to four million nodes per page.

At a fixed zoom, panning reuses text validation for the overlapping part of the last
viewport and checks newly exposed strips. Raster changes, atlas eviction, density
requirements, and camera scale changes invalidate that reuse. Hand/space/middle-button
panning does not copy layers for undo, and cancelling it preserves document geometry.
The [four-copy measurement](benchmarks/four-copy-pan.json) records two runs on a
1.2-million-layer document: median panning canvas preparation fell from about
22.5–22.8 ms to 2.2 ms. These are CPU stage timings, not display FPS.

The optional inspector requires a complete CPU scene for screenshots, so it uses
ordinary composition. Use `camera-check` for performance of the normal native path;
`challenge-check` covers inspector-driven interactions. The contracts also check
all 26 letters under glyph-atlas pressure and compare shared text after zoom/pan
with fresh raster pixels.

The native canvas uses `ui-tree.canvas_view.TextBindings` for pan/zoom cache validation
and `Refinement` for idle text-quality deadlines. The editor retains document-node
mapping and composition; viewport coverage checks and raster-validity policy are shared.
The desktop host uses the common `ui-tree-window.host` through its app adapter.
