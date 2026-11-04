# Native selection workload

Measured on an Apple M1 Max, macOS arm64, with the repository's Silk
`0.1.0-dev.47+d5e63a44393e`, LLVM 22.1.8, release optimization. Run:

```sh
python3 graphics/editor/native/scripts/test --release
```

The page contains 100,000 independent rectangles arranged as the supplied image,
plus two text layers, fitted into a 1440×960 logical viewport at scale 1. These
figures are one local run, not a browser comparison or a statistical performance
claim. GPU submission, compositor scheduling, and display refresh are excluded.

| Workload | Measured CPU time |
| --- | ---: |
| 120 growing marquee updates, selecting 96,402 layers | 86.592 ms total (0.722 ms/update) |
| 30 selection frames: input dispatch, model update, native UI render/layout, canvas scene | 7.7905 ms/frame average |
| Select-all recolor followed by left alignment | 6.140 ms combined |

The frame workload warms the retained document once, then dispatches pointer input
through the UI tree and application pump to change the marquee and selection on
every iteration. These measurements were refreshed on 2026-11-03. The layer list is virtualized.
Selection bounds are collected during the selection count pass and shared by the
UI handles and scene renderer; geometry edits invalidate that cache. Selection-only
frames reuse document geometry and shaped text; they still compose the scene and
UI each frame. The bulk-edit workload checks that a rectangle in the middle of
the document actually changed color.

Memory is bounded by a history cap of 50 snapshots and approximately 500,000
stored elements across large-document snapshots. Autosave copies document data on
the window thread, then encodes/writes the copy on a worker. Text uses native
shaping and quantized raster density, with clipped vector glyph coverage at large
sizes. Many distinct text layers and continuously changing zoom merit separate
profiling; the rectangle workload does not establish their performance.

The native GPU check also passed at 2880×1920 physical pixels: mean absolute
channel difference 0.00745/255 against the CPU reference, with 1,874 of 22,118,400
channels exceeding the 8/255 comparison threshold. This is rendering validation,
not a GPU speed measurement.

## Image/text camera workload after glyph-cache and native rendering fixes

Measured on the same Apple M1 Max at 1440×960 logical pixels, 2× scale, in a
release build. Run `python3 graphics/editor/native/scripts/camera-check` after
building the app. Raw stage summaries are in [benchmarks/camera.json](benchmarks/camera.json).

The benchmark creates 100k image/text cards in memory, then dispatches 120 zoom
steps and 40 overview pan steps through the native UI event path. It compares the
ordinary renderer with GPU-retained overview geometry in the same executable.
The creation frame is excluded. These are frame submission wall times, including
surface waits; they are not GPU timestamp measurements or display FPS. This is
not a new browser-versus-native measurement.

| Native path | Zoom median | Overview pan median |
| --- | ---: | ---: |
| Ordinary | 16.25 ms | 30.58 ms |
| Retained images | 8.25 ms | 9.03 ms |

The retained/ordinary GPU readback comparison passes at 2880×1920: mean channel
difference 0.01195/255, maximum 12, and 180 of 22,118,400 channels differing by
more than 8. Native chrome is composited separately; backdrop-dependent controls,
grid, and unsupported document primitives/effects use the ordinary renderer.

The disappearing characters came from the scratch glyph atlas never advancing
its eviction frame. Old zoom sizes filled it and allocation failures became empty
glyphs. Each label raster now advances the atlas frame and repaints its active
glyphs. A regression renders all 26 letters through 48 zoom/font changes under
atlas pressure. Another compares shared text after zoom/pan against fresh pixels.

Close-up text changes update visible bindings in place, and power-of-two raster
densities reduce repeated work during zoom. The optional inspector keeps a full
CPU scene for screenshots and uses ordinary composition; its IPC timings do not
measure the retained native path.

### Panning across text raster boundaries

The 400% → 401% slowdown on Explorations was caused by doubling the large text
raster density, which crossed the 4096-pixel crop limit. The cropped-text cache
then treated every camera movement as invalidation. Large text now uses finer
raster-density steps; cropped rasters remain valid until the visible text leaves
their cached bounds. Cropping is independent on each axis and includes overscan.

The native contract checks a single heading at 400%, 401%, 801%, and 6400% on a
2× viewport: small pans must not invoke the text rasterizer, while a pan beyond
the cached crop must refresh it. The original Explorations interaction sequence
also passes after the fix. Inspector latency includes IPC and scheduling and is
not a presentation-FPS measurement.
