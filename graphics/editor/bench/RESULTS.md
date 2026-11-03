# Browser performance measurements

Latest actual-text comparison and optimizations: [text throughput report](text-throughput/README.md).
The [initial text benchmark](text-browser/README.md) is retained as the pre-optimization baseline.

Recorded 2026-11-03 UTC (2026-11-02 in the user’s local work session), on this development machine.

The latest shadow optimization closes the previous gap. At 100,000 visible elements with shadows
on all 1,000 artboards, Silk now sustains about 60 rAF callbacks/sec. Compositor-hinted DOM is also
close to the 60 Hz ceiling during unchanged-scene zoom; editing exposes a much larger difference.
See the latest shadow results below. The earlier measurements are retained as historical evidence.

## Shadow ordering optimization (latest)

The original shadowed overview spent about 97 ms building the scene per frame. Three changes
remove most of that overhead while preserving painter order:

1. **Order consecutive rectangles as a run.** Each run gets one combined bound in the overlap
   tree. Shadows, paths, and sprites keep their own ordering entries. Runs stop before the next
   mixed primitive and at each 64-slot culling-block boundary, keeping lookahead bounded even
   when almost all the document is offscreen. The first rectangle's shadow is emitted before
   opening its quad run. Union bounds use the same f32 physical-coordinate arithmetic as drawing.
2. **Sort and copy equal-key runs in bulk.** Consecutive primitives with the same order and texture
   are already internally sorted. Sort their run descriptors by order, texture and original index,
   then copy contiguous ranges. This gives the same final primitive sequence as per-item sorting.
3. **Order by covered pixels.** A mixed-content regression at 3% zoom exposed a pre-existing
   geometric-bounds assumption: nonoverlapping fractional shapes can blend into the same pixel.
   Scene ordering now rounds bounds outward just as GPU raster coverage does. A targeted native
   test fails before this fix; exact GPU comparisons with overlapping shadows, translucent
   rectangles, ellipses and text pass after it. The optimization does not trade away these edges.

All measurements below still submit 100,000 elements, including 1,000 artboard shadows. There is
no small-element removal, blur reduction, shadow disabling, or artboard bitmap cache in Silk.
The same hardware, viewport, geometry and zoom trajectory described below are used.

Each workload has three runs, each with 20 warmups and 90 measured frames. Values are the median of run-level average rAF rates; brackets give the range across runs.

| Shadowed workload | Silk fps [range] | DOM + compositor hint fps [range] | Interpretation |
| --- | ---: | ---: | --- |
| Zoom | 60.0 [60.0–60.0] | 58.7 [57.4–58.7] | Both near the 60 Hz ceiling |
| Zoom + resize one artboard | 60.0 [60.0–60.0] | 8.1 [8.0–8.1] | Silk has substantially higher cadence |
| Zoom + 1,000 width edits/frame | 60.0 [58.7–60.0] | 7.5 [7.5–7.6] | Silk has substantially higher cadence |

Visual comparison: [shadow-report.html](shadow-report.html). Frame cadence is not a presentation fence or GPU timestamp.

The earlier 90-frame shadow run used 102.9 ms median synchronous CPU work; the latest static
runs use about 13.6 ms, roughly **7.6× less CPU time**. Scene build is about 7.2 ms, and encoding/
submission about 6.3 ms. The final frame has 158 batches, up from 92: conservative pixel ordering
and bounded runs deliberately preserve more dependencies. Fewer draw calls alone was not the goal.

The raw baseline immediately before this work is [shadow-before.json](shadow-before.json)
(30 samples after five warmups). The earlier long baseline is [overview-shadows-confirm.json](overview-shadows-confirm.json).
Latest samples are [shadow-final.json](shadow-final.json), [reversed-order static repeats](shadow-static-reverse.json),
[batch edits](shadow-edit-final.json), [single edit](shadow-single-edit.json), and [single-edit repeats](shadow-single-repeat.json).
The first static comparison runs Silk first; the other two run DOM first. The first single-edit
comparison runs DOM first; the repeats run Silk first. Batch-edit runs use Silk first.
At 10,000 visible elements the new shadow run is about 60 fps for both renderers.
A [cropped shadow regression run](shadow-cropped-check.json) also stays near 60 fps with 1.0 ms
median CPU work and 1,024 main-pass visits out of 100,000 document elements.

The single-edit workload changes the first artboard background's width by ±2 world units while
zooming. The 1,000-edit workload changes the first ten artboards' primitives. This is a width/layout
invalidation workload, not a compositor-only transform drag. DOM uses one scene parent with
`will-change: transform`; it does not isolate each artboard into its own compositing layer. A more
elaborate DOM layer strategy may improve editing. No general claim about every DOM editor follows.
These shadows have a 20-world-unit blur radius and become small on screen; large screen-space blur,
backdrop filters, and a shadow on every primitive are not covered by this workload.

Validation includes 17 native UI-scene tests, 2 native editor suites, 38 browser contracts, real
pointer/keyboard interaction checks, and 14 GPU/CPU renderer fixture comparisons. The exact-pixel
shadow contracts cover gradients/borders via earlier tests, translucent overlaps, text and ellipses,
negative shadow offsets, culling-block boundaries, zoom 1 / 0.65 / 0.03 and DPR 1 / 2.

## All-visible overview

Each artboard contains one background rectangle and 33 cards, each made from a colored rectangle
and two translucent text-like bars: 100 primitive rectangles per artboard. The bars are not text,
and the artboards are not hierarchy or clipping groups. The camera fits the entire document and
continuously changes zoom with a small pan. Culling stays enabled, but Silk's per-frame visible
count is asserted to equal the document count. The confirmation runs also assert that DOM keeps
every element mounted. Nothing is omitted for being small, and Silk does not cache the artboards
as bitmaps. At 100,000 elements the confirmation trajectory ranges from 2.73% to 3.47% zoom.

The strongest measured DOM baseline sets `will-change: transform` on the scene parent. This lets
the browser choose compositor caching; it dramatically changes the result compared with an
unhinted parent. The benchmark does not inspect Chromium's layer cache or measure raster quality
during scaling, so this should not be read as proof of a particular caching mechanism or equal
subpixel rendering between CSS and the Silk shaders.

### Before shadow optimization: 100,000 visible elements / 1,000 artboards

90 measured frames after 20 warmup frames per renderer. Higher cadence is better.

| Workload | Silk rAF fps | DOM + compositor hint rAF fps | Silk CPU median | DOM CPU median | Faster cadence in this run |
| --- | ---: | ---: | ---: | ---: | --- |
| Zoom | 60.0 | 43.9 | 14.3 ms | <0.1 ms | Silk |
| Zoom + 1,000 width edits/frame | 60.0 | 7.3 | 15.6 ms | 0.5 ms | Silk |
| Zoom + shadows on all artboards | 9.7 | 59.3 | 102.9 ms | <0.1 ms | DOM |

Raw samples: [zoom](overview-confirm.json), [zoom + edits](overview-edit-confirm.json),
[zoom + shadows](overview-shadows-confirm.json). Historical visual comparison: [overview-report.html](overview-report.html).
The edit workload updates the first 1,000 primitives, covering ten adjacent artboards, by ±2 world
units. It does not scatter changes across all artboards. The shadow workload adds a 20-world-unit
blur-radius shadow to each artboard background; this is not a benchmark of large screen-space
blur or backdrop filters. At this zoom, many details are subpixel.

### Initial sweep and optimization

These shorter runs use 30 measured frames after five warmups and exactly the same camera
trajectory before and after the optimization. They should not be combined with the longer
confirmation samples as if they were one run.

| Visible elements | Unoptimized Silk fps | Optimized Silk fps | Full DOM fps | Culled DOM fps | DOM + compositor hint fps |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1,000 | 60.0 | 60.0 | 60.0 | 56.3 | 60.0 |
| 10,000 | 60.0 | 60.0 | 5.1 | 4.9 | 60.0 |
| 100,000 | 8.7 | 60.0 | 0.5 | 0.5 | 46.2 |

At 100,000 visible rectangles, median synchronous Silk work fell from **114.0 ms to 14.6 ms**
(about 7.8×). Two changes produced this combined result:

1. When all non-hidden live primitives are rectangles without shadows, pin their scene order to
   insertion order. All share a primitive kind, so the renderer retains correct translucent painter
   order without querying the mixed-primitive overlap tree for each rectangle. Any live, visible
   path, text sprite or shadow disables this fast path conservatively, even if it is offscreen.
2. Pack each instance vector with one 16-byte append rather than sixteen individual byte appends.
   Writes remain explicitly little-endian. This also improves the shared UI renderer.

The baseline code for both paths is in commit `7d5d8f8`. The short sweep records scene-build median
falling from 93.5 ms to 9.6 ms and encoding/submission from 20.5 ms to 5.0 ms. Changes were measured
together; these numbers do not isolate the contribution of either change. All 100,000 rectangles
are still visited and submitted in one batch. GPU pixel tests compare fast and mixed ordering
with translucent overlaps, gradients and borders, including hidden/remove/undo/redo transitions.

**Bottleneck at commit `c5fb6b2` (addressed above):** shadows disabled the rectangle-only ordering shortcut. The longer
shadow run spends 97.3 ms building the scene and 5.6 ms encoding/submitting 92 batches. This result motivated the bounded rectangle runs and bulk sorting described above. It remains
historical evidence rather than a description of the current implementation.

Raw initial runs: [baseline](overview-baseline.json), [optimized Silk](overview-optimized.json),
[compositor-hinted DOM](overview-composited.json), [edits](overview-edit.json),
[shadows](overview-shadows.json). At 10,000 visible elements both optimized Silk and compositor-
hinted DOM are near 60 fps in these zoom, edit, and shadow runs.

## Earlier cropped-viewport measurements

The following tables were recorded before the all-visible optimization. They keep approximately
110 elements visible, so they primarily measure culling and do not answer the overview question.
Full DOM pans near 60 fps; during 1,000 width edits it drops to about 6.9. Silk and viewport-culled
DOM stay near 60 in both workloads.

## Environment and method

- Installed Chrome 155.0.8059.85, headless, macOS, hardware WebGPU reporting vendor `apple` and architecture `metal-3`. The exact browser version is also stored with every JSON report.
- 960 × 640 CSS-pixel viewport, device pixel ratio 1, visible foreground page; 20 warmup frames and 90 measured frames per renderer for the cropped and confirmation runs; five warmups and 30 measured frames for the initial overview sweep. Renderers run sequentially, not side by side.
- The cropped workload uses a deterministic grid of 76 × 54 rounded rectangles, 92 × 72 spacing, identical fills and 1-pixel borders. Approximately 110 shapes are visible. Counts are total document elements, **not 100,000 simultaneously visible shapes**.
- Pan moves the camera 3.25 world units per frame, with sinusoidal vertical motion. DOM transforms the parent; its compositor is allowed to cache the contents.
- Edit adds 1,000 sinusoidal width changes per frame to the same pan. Silk uses the public validated update API and a transaction, clearing its benchmark undo history after each group. DOM updates the matching style properties; the culled variant also keeps its model current for offscreen shapes.
- Culled DOM scans the full source list each frame, keeps only visible nodes mounted, reuses detached nodes, and preserves painter order. It is a useful baseline, not the strongest possible virtualized DOM implementation. It does not have Silk’s block index or undo/event machinery.
- `updateMedianMs` and `updateP95Ms` measure synchronous JS/WASM work and GPU command submission. **They do not include asynchronous browser layout/paint or GPU execution.** This explains the full DOM’s tiny update time despite poor edit cadence.
- Frame intervals measure successive requestAnimationFrame timestamps. They include missed callbacks, but are **not a compositor presentation fence**. `flush()` waits for submitted GPU work after a run; it is outside the timing loop. GPU timestamp queries and end-to-end input latency are not measured.
- Timers are quantized around 0.1 ms; displayed `<0.1` does not mean zero work. Earlier tables are individual runs; the latest shadow table reports medians and ranges across repeated runs, without confidence intervals. Warmup, JIT, background load and browser scheduling affect the tails.
- Setup measures creating the renderer and document. For Silk it includes module/device/pipeline initialization; for DOM it primarily measures synchronous node creation and does not wait for first paint. It is not an equivalent first-interactive latency metric.

## Cropped-viewport results (before overview optimization)

### Pan

| Elements | Renderer | CPU update median | CPU update p95 | rAF average fps | rAF interval p95 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1,000 | silk | 0.4 ms | 2.6 ms | 60.0 | 16.8 ms |
| 1,000 | dom | <0.1 ms | 0.1 ms | 60.0 | 16.7 ms |
| 1,000 | dom-culled | <0.1 ms | 0.2 ms | 60.0 | 16.8 ms |
| 10,000 | silk | 0.4 ms | 1.0 ms | 60.0 | 16.7 ms |
| 10,000 | dom | <0.1 ms | 0.1 ms | 60.0 | 16.7 ms |
| 10,000 | dom-culled | 0.1 ms | 0.2 ms | 60.0 | 16.8 ms |
| 100,000 | silk | 0.4 ms | 1.6 ms | 60.0 | 16.7 ms |
| 100,000 | dom | <0.1 ms | 0.1 ms | 60.0 | 16.7 ms |
| 100,000 | dom-culled | 0.9 ms | 1.2 ms | 60.0 | 16.7 ms |

Raw observations and all per-frame samples: [final-pan.json](final-pan.json).

### Pan plus 1,000 width edits per frame

| Elements | Renderer | CPU update median | CPU update p95 | rAF average fps | rAF interval p95 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 1,000 | silk | 1.5 ms | 4.8 ms | 60.0 | 16.7 ms |
| 1,000 | dom | 0.3 ms | 0.4 ms | 60.0 | 16.8 ms |
| 1,000 | dom-culled | 0.1 ms | 0.2 ms | 60.0 | 16.8 ms |
| 10,000 | silk | 1.6 ms | 5.7 ms | 60.0 | 16.8 ms |
| 10,000 | dom | 0.4 ms | 0.6 ms | 60.0 | 16.7 ms |
| 10,000 | dom-culled | 0.2 ms | 0.3 ms | 60.0 | 16.7 ms |
| 100,000 | silk | 1.8 ms | 6.0 ms | 60.0 | 16.8 ms |
| 100,000 | dom | 0.5 ms | 0.6 ms | 6.9 | 166.6 ms |
| 100,000 | dom-culled | 0.9 ms | 1.1 ms | 60.0 | 16.7 ms |

Raw observations and all per-frame samples: [final-edit.json](final-edit.json).

### Pan with 12-pixel blur-radius rectangle shadows

| Elements | Renderer | CPU update median | CPU update p95 | rAF average fps | rAF interval p95 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 100,000 | silk | 1.0 ms | 1.2 ms | 60.0 | 16.7 ms |
| 100,000 | dom | <0.1 ms | 0.1 ms | 58.7 | 16.8 ms |
| 100,000 | dom-culled | 0.9 ms | 1.1 ms | 60.0 | 16.8 ms |

Raw observations and all per-frame samples: [final-shadows.json](final-shadows.json).

## Earlier culling optimization record

1. **Linear-scan baseline.** WASM tested every node’s paint bounds each frame. At 100,000 elements, median scene build was 2.1 ms and total synchronous update was 2.8 ms. The original document implementation is preserved in [baseline-document.silk](baseline-document.silk); raw runs are in [baseline-pan.json](baseline-pan.json). Its `frames` field for Silk includes the 20 warmup frames because the initial harness merged cumulative render stats into that field; its sample arrays still contain exactly 90 measured frames.

2. **Conservative blocks.** Group 64 consecutive slots under a union of their paint bounds. Skip whole blocks before testing individual shapes. At the last frame of the 100,000-node run this tests 1,024 elements rather than 100,000, retains 110, and draws the plain rectangles in one GPU batch. Scene-build median fell to 0.2 ms in the first indexed run. See [indexed-pan.json](indexed-pan.json). Geometry mutation, removal, restoration and shadow reach are covered by native and GPU-pixel checks.

3. **Coalesce bounds maintenance.** Rebuilding a block after every property update repeated the same work up to 64 times in one transaction. Mark blocks dirty and rebuild each affected block once before the next frame or hit query. Also cache up to 1,024 parsed color words, which avoids reparsing unchanged fills at the JS/WASM boundary. The 100,000-node, 1,000-edit workload fell from 4.0 ms median synchronous update to 1.8 ms. Compare [indexed-edit.json](indexed-edit.json) with [final-edit.json](final-edit.json). This is a combined optimization measurement, not an isolated attribution to either change.

The cropped pan run records about 0.1 ms median scene build and 0.3 ms GPU encoding/submission at 100,000 elements. Low values are close to timer resolution; use the samples and repeat on your hardware. Overlapping shadows require more painter-order batches: the shadow run ends with 48 draws rather than one.

## Boundaries of the result

- The benchmark does not support the claim that a 100,000-element DOM document always becomes unusable. Plain parent-transform panning is inexpensive on this browser.
- Viewport virtualization is effective in both renderers. The DOM baseline’s synchronous CPU cost is lower for some workloads; Silk’s API also performs validation, history bookkeeping and events.
- The grid is spatially coherent in insertion order. Interleaved distant shapes make the block unions less selective; arbitrary overlap and all-visible overviews still require a full scan. The new overview measurements cover only synthetic artboards, not arbitrary production documents.
- Ellipse path rasterization, text atlas population, complex blur stacks, text editing, image-heavy scenes, mobile browsers, Firefox, Safari, low-end GPUs, and production design documents are outside these measurements.
- This test uses a hardware GPU, not SwiftShader. CI correctness uses software rendering; its timings should not be compared with this report.

## Reproduce

From the repository root, with installed Silk/Clang and the Playwright/browser paths configured as in the package README:

```sh
python3 graphics/editor/scripts/browser build
EDITOR_RESULTS=build/editor-results/pan node graphics/editor/web/test.mjs --bench
EDITOR_RESULTS=build/editor-results/edit EDITOR_WORKLOAD=edit node graphics/editor/web/test.mjs --bench
EDITOR_RESULTS=build/editor-results/shadows EDITOR_COUNTS=100000 EDITOR_SHADOWS=1 node graphics/editor/web/test.mjs --bench
# All-visible confirmation workloads; defaults: 90 samples, 20 warmups.
EDITOR_RESULTS=build/editor-results/overview EDITOR_COUNTS=100000 EDITOR_WORKLOAD=overview EDITOR_MODES=silk,dom-composited node graphics/editor/web/test.mjs --bench
EDITOR_RESULTS=build/editor-results/overview-edit EDITOR_COUNTS=100000 EDITOR_WORKLOAD=overview-edit EDITOR_MODES=silk,dom-composited node graphics/editor/web/test.mjs --bench
EDITOR_RESULTS=build/editor-results/overview-shadows EDITOR_COUNTS=100000 EDITOR_WORKLOAD=overview EDITOR_SHADOWS=1 EDITOR_MODES=silk,dom-composited node graphics/editor/web/test.mjs --bench
# Resize one shadowed artboard while zooming.
EDITOR_RESULTS=build/editor-results/shadow-single EDITOR_COUNTS=100000 EDITOR_WORKLOAD=overview-edit EDITOR_SHADOWS=1 EDITOR_EDITS=1 EDITOR_MODES=dom-composited,silk node graphics/editor/web/test.mjs --bench
# Short sweep including unhinted DOM and viewport culling.
EDITOR_WORKLOAD=overview EDITOR_FRAMES=30 EDITOR_WARMUP=5 EDITOR_MODES=silk,dom,dom-culled,dom-composited node graphics/editor/web/test.mjs --bench
```

`EDITOR_WORKLOAD` accepts `pan`, `edit`, `overview`, `overview-pan` (fixed overview zoom), and `overview-edit`.
`EDITOR_EDITS` sets how many leading primitives change width in edit workloads (default `1000`; use `1` for one artboard background).
`EDITOR_MODES` selects comma-separated renderers. `EDITOR_FRAMES` and `EDITOR_WARMUP` override sample counts.
`EDITOR_COUNTS` is a comma-separated list (default `1000,10000,100000`). The demo exposes the same comparison harness and downloads a JSON report. No benchmark uses hard timing assertions.
