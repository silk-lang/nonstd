# Silk Studio

A local design workspace built around Silk's WebGPU/WASM editor. Foldkit owns the application model and view, Effect owns commands and browser resources, and Tailwind styles the interface. The existing renderer and its standalone benchmark demo remain available alongside Studio.

## Run

From the repository root, build the renderer first:

```sh
SILK_CLANG=/opt/homebrew/opt/llvm/bin/clang python3 graphics/editor/scripts/browser build
cd graphics/editor/app
bun install
bun run dev
```

Open **http://localhost:5173** in a WebGPU-capable browser. The LLVM path above is for Homebrew on Apple Silicon; set `SILK_CLANG` to your LLVM installation elsewhere. The renderer's [README](../README.md) describes its build prerequisites. Studio imports `../dist/editor.js` and bundles `../dist/editor.wasm`; generated renderer files are not committed.

`bun run build` produces a static app in `dist/`. Serve it from the root of an HTTPS origin, or localhost. There is no application backend, account, or cloud dependency.

Development dependencies run without their HMR hooks. This avoids Foldkit serializing the entire canvas and undo history over Vite's socket; Studio restores saved documents from IndexedDB after a source reload. Application source still reloads normally. Foldkit's automatic development model freezing is also inactive on this path; strict readonly types and snapshot tests guard immutability. Add `?debug` to opt into Foldkit's state recorder when investigating model changes; recording large selection diffs adds substantial overhead.

## Use the workspace

Start with the included composition, or choose **File → New document**. Draw rectangles, ellipses, frames, and single-line text. Select layers on the canvas or in the searchable layer tree; Shift-click adds or removes selections. Drag to move, use the eight handles to resize, or enter geometry in the inspector. Shift constrains proportions. Smart guides snap edges and centers; Alt bypasses snapping and duplicates when starting a drag.

Frames move their contents and resize their boundary. Groups scale their contents. The inspector provides fills, opacity, typography, and rectangle/frame strokes, corners, and shadows. Hide and lock controls live beside each layer. Arrange, align, group, duplicate, copy/paste, and undo/redo are available through the inspector, shortcuts, and command search.

Double-click text to edit it on the canvas. Changing its text or font uses natural browser font measurements; resizing its bounds deliberately scales the glyphs. Text uses the renderer's existing adaptive atlas/vector path as you zoom.

Documents save automatically to IndexedDB on this browser origin. The header confirms completed saves. **Open local documents** lists the most recently saved documents. Download `.silk` files for portable backups; clearing browser site data also clears local documents. Importing creates an independent document, validates its schema and hierarchy, and preserves the current document when a file is invalid. Files up to 64 MB and 200,000 layers per page are accepted, subject to available device resources.

SVG and PNG export the selection, including selected containers' descendants, or the whole current page when nothing is selected. PNG uses up to 2× resolution, bounded to 8192 pixels on its longest side. Exports include shadow extents and the text's current scale. SVG text remains text and relies on the recipient having the selected font.

| Shortcut                          | Action                                           |
| --------------------------------- | ------------------------------------------------ |
| V / F / R / O / T / H             | Move / frame / rectangle / ellipse / text / hand |
| Space + drag                      | Pan                                              |
| Ctrl or ⌘ + wheel; trackpad pinch | Zoom around the pointer                          |
| Shift + 1 / Shift + 2 / 0         | Fit page / fit selection / 100%                  |
| Ctrl or ⌘ + K                     | Commands                                         |
| Ctrl or ⌘ + Z / Shift + Z         | Undo / redo                                      |
| Ctrl or ⌘ + C / X / V / D         | Copy / cut / paste / duplicate                   |
| Ctrl or ⌘ + G / Shift + G         | Group / ungroup                                  |
| Arrows / Shift + arrows           | Nudge 1 / 10 units                               |
| Ctrl or ⌘ + S                     | Download a `.silk` file                          |
| Escape                            | Cancel a gesture or close a dialog               |

The in-app shortcut reference includes the remaining controls. Clipboard operations currently stay inside Studio.

## Checks and benchmarks

```sh
bun run check        # Oxfmt, strict type-aware Oxlint, Effect diagnostics, TypeScript 7
bun run test         # Model, undo, hierarchy, import, export, and resize contracts
bun run test:browser # Real Chrome workflows, persistence, and export recovery
bun run bench        # Text overview zoom and 100k-rectangle marquee frame intervals
bun run bench --grep '100k rectangles' # Selection benchmark only
bun run bench:selection:cpu # Reducer and shared selection calculations, without rendering
bun run build
```

Browser tests use installed Google Chrome with WebGPU enabled. Playwright writes failure traces and screenshots under ignored `test-results/`. The benchmark attaches JSON measurements and prints them. Its fixed viewport is 1440×960 at DPR 2; each size uses 40 repeated labels, 120 idle warm-up frames, then 120 zoom updates. All layers remain visible through the measured overview gesture. It measures browser animation-frame intervals, not GPU completion or input-to-display latency.

The [recorded run](benchmarks/overview.json) reached approximately 16.7 ms median and 16.8 ms p95 frame intervals at both sizes. Cold loading and the warm-up are reported separately as `settledMs`; they took about 3.4 s and 7.0 s in that run. This is a reproducible workload, not a general claim about every design or a new comparison with Figma. Distinct glyphs, large text, effects, hardware, and browsers change the workload substantially.

Layer rows are virtualized. Hierarchy indexes, paint order, and layer-tree rows reuse immutable document references across viewport changes. Camera-only changes preserve the native scene. The interface does not create one DOM element per drawing element.

For selection stress testing, choose **Commands → Add 100k rectangles**. This creates a 400×250 grayscale mosaic from the supplied reference image, with 100,000 individually editable rectangles and one caption above them. Pixel dimensions preserve the source aspect ratio. The command replaces the existing stress-test page and fits the mosaic and caption into view. Regenerate the bundled samples with `python3 benchmarks/generate-selection-pixels.py` (requires ImageMagick); the source is `benchmarks/fixtures/selection-source.png`. The marquee benchmark keeps all 100,000 rectangles visible, sweeps twice between small and large selections, and verifies live updates reaching over 85,000 selected items. It also holds the gesture idle to catch accidental development reloads. The first ten frame intervals are reported separately from steady state. The dedicated benchmark fails if p95 exceeds 25 ms or 1.5× idle p95, whichever is greater. This is a machine-dependent performance guard, separate from the ordinary browser suite.

The [selection results](benchmarks/selection.json), recorded before the fixture became an image mosaic, separate CPU calculations from browser frame intervals and development-tool overhead. Selection queries reuse eligibility by immutable document reference, share membership and root calculations across views, and reuse the nodes found by the marquee scan. Changing geometry, hierarchy, visibility, or lock state creates a new reference and invalidates the corresponding derived data. Shift-selection still unions with the gesture's original selection; cancellation and undo retain their original snapshots.

## Current boundaries

This remains a demo application, with deliberate scope: single-line text in Arial, Georgia, and Courier New; rectangular frames without clipping; no rotation, paths, image import, rich text, auto layout, components, collaboration, or cloud sync. Ellipse/text stroke and shadow controls are omitted because the current renderer does not support them. Group opacity multiplies each descendant's opacity, rather than compositing the group into an offscreen surface. Undo retains up to 50 document snapshots for the current session. Concurrent editing of the same document in multiple tabs is not coordinated.

The stack pins Foldkit 0.170.0, Effect 4.1.2, TypeScript 7.0.2, Oxc, and Tailwind 4.3.4. `prepare` patches the native TypeScript and Oxlint integrations with `@effect/tsgo`. Strict lint categories and warnings-as-errors are enabled. Readonly-parameter exceptions are limited to imperative browser/test handles, framework view/queue types, and tagged errors; document and model types remain readonly.
