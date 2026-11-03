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
| 120 growing marquee updates, selecting 94,002 layers | 71.039 ms total (0.592 ms/update) |
| 30 selection frames: input dispatch, model update, native UI render/layout, canvas scene | 6.9321 ms/frame average |
| Select-all recolor followed by left alignment | 6.182 ms combined |

The frame workload warms the retained document once, then dispatches pointer input
through the UI tree and application pump to change the marquee and selection on
every iteration. These measurements were refreshed on 2026-11-03. The layer list is virtualized. Selection-only
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
channel difference 0.00747/255 against the CPU reference, with 2,001 of 22,118,400
channels exceeding the 8/255 comparison threshold. This is rendering validation,
not a GPU speed measurement.
