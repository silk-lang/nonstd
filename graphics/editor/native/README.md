# Silk Studio — native

A desktop version of the Studio design editor, written in Silk. `ui/app` owns the
application model and messages, `ui/components` builds the controls, `ui/tree`
handles layout and text input, and `platform/window` supplies the native window,
menus, clipboard, input method, and file dialogs. Canvas layers use the shared
`graphics/editor.Document` and `graphics/ui_renderer` on WebGPU/Dawn. No browser,
webview, JavaScript runtime, or server is required.

## Run

From the repository root, with Python 3.11 or newer:

```sh
python3 graphics/editor/native/scripts/studio --release
python3 graphics/editor/native/scripts/studio --release --file ~/Design.silkdesign
```

The runner uses the repository's pinned Silk compiler, LLVM, and Dawn installers.
On macOS the window bridge requires macOS 14 or newer. Native platform dependencies
on Linux/Windows are the same as `platform/window` and `graphics/demo`; this port
has been exercised on macOS arm64, not yet on Linux or Windows.

To build a self-contained macOS application, including fallback fonts:

```sh
python3 graphics/editor/native/scripts/studio --release --bundle
open 'build/Silk Studio.app'
```

The local development bundle is unsigned. Its binary links only to macOS system
libraries/frameworks; it does not depend on a running compiler or this checkout.

## Editing

- Select, marquee-select, drag, resize, Shift-constrain, Alt-drag duplicate, and
  use H or hold Space to pan. Cmd/Ctrl + wheel and trackpad pinch zoom at the pointer.
- Draw rectangles, ellipses, frames, and text with R, O, F, and T. Double-click text
  to edit it with native text input. V returns to selection.
- Inspect geometry, fills, opacity, strokes, corner radii, typography, outer and
  inner shadows, layer blur, backdrop blur, brightness, contrast, saturation, and
  blend mode. Group/ungroup, align, change order, hide, and lock layers.
- Use undo/redo, copy/paste within the document, pages, and a virtualized layer list
  with search. Shift+1 fits the page, Shift+2 fits selection, and 0 sets 100% zoom.
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
python3 graphics/editor/native/scripts/test --release
python3 graphics/editor/native/scripts/studio check --release
```

The contract executable tests pointer-driven creation, native inspector input,
undo/redo, subtree transforms, Alt-drag/cancel, validated file round trips, selected
PNG/SVG exports, high-zoom vector text, cache reset, and 100k-element edits. It also
prints CPU timings for selection, UI layout, and scene construction. These are not
GPU timings or display FPS. The macOS test runner works around a dev.47 compiler
libSystem stub that omits math symbols used by the headless CPU renderer.

The window check scripts real UI input, reads the GPU surface, compares it with
the CPU rendering of the same scene, and writes `/tmp/silk-studio-native-check.png`.
See [PERFORMANCE.md](PERFORMANCE.md) for the measured workload and limits.

The optional local UI inspector is off in release builds unless explicitly enabled:

```sh
SILK_UI_INSPECT=/tmp/silk-studio.sock python3 graphics/editor/native/scripts/studio --release --inspect
```

It inspects UI controls; canvas layers remain in the drawing document rather than
becoming UI tree nodes. OS accessibility exposure is currently limited by the
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
