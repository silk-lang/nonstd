# Browser performance measurements

Recorded 2026-11-03 UTC (2026-11-02 in the user’s local work session), on this development machine.

The final 100,000-layer scene remains near 60 requestAnimationFrame callbacks per second during both panning and 1,000 width edits per frame. Full DOM also pans near 60; during width edits it drops to about 6.9. Viewport-culled DOM stays near 60 in both workloads. These are workload-specific measurements, not a universal WebGPU/DOM ranking.

## Environment and method

- Installed Chrome 155.0.8059.85, headless, macOS, hardware WebGPU reporting vendor `apple` and architecture `metal-3`. The exact browser version is also stored with every JSON report.
- 960 × 640 CSS-pixel viewport, device pixel ratio 1, visible foreground page; 20 warmup frames and 90 measured frames per renderer. Renderers run sequentially, not side by side.
- Deterministic grid of 76 × 54 rounded rectangles, 92 × 72 spacing, identical fills and 1-pixel borders. Approximately 110 shapes are visible. Counts are total document elements, **not 100,000 simultaneously visible shapes**.
- Pan moves the camera 3.25 world units per frame, with sinusoidal vertical motion. DOM transforms the parent; its compositor is allowed to cache the contents.
- Edit adds 1,000 sinusoidal width changes per frame to the same pan. Silk uses the public validated update API and a transaction, clearing its benchmark undo history after each group. DOM updates the matching style properties; the culled variant also keeps its model current for offscreen shapes.
- Culled DOM scans the full source list each frame, keeps only visible nodes mounted, reuses detached nodes, and preserves painter order. It is a useful baseline, not the strongest possible virtualized DOM implementation. It does not have Silk’s block index or undo/event machinery.
- `updateMedianMs` and `updateP95Ms` measure synchronous JS/WASM work and GPU command submission. **They do not include asynchronous browser layout/paint or GPU execution.** This explains the full DOM’s tiny update time despite poor edit cadence.
- Frame intervals measure successive requestAnimationFrame timestamps. They include missed callbacks, but are **not a compositor presentation fence**. `flush()` waits for submitted GPU work after a run; it is outside the timing loop. GPU timestamp queries and end-to-end input latency are not measured.
- Timers are quantized around 0.1 ms; displayed `<0.1` does not mean zero work. Each table is one recorded run, without confidence intervals. Warmup, JIT, background load and browser scheduling affect the tails.
- Setup measures creating the renderer and document. For Silk it includes module/device/pipeline initialization; for DOM it primarily measures synchronous node creation and does not wait for first paint. It is not an equivalent first-interactive latency metric.

## Final results

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

## Optimization record

1. **Linear-scan baseline.** WASM tested every node’s paint bounds each frame. At 100,000 elements, median scene build was 2.1 ms and total synchronous update was 2.8 ms. The original document implementation is preserved in [baseline-document.silk](baseline-document.silk); raw runs are in [baseline-pan.json](baseline-pan.json). Its `frames` field for Silk includes the 20 warmup frames because the initial harness merged cumulative render stats into that field; its sample arrays still contain exactly 90 measured frames.

2. **Conservative blocks.** Group 64 consecutive slots under a union of their paint bounds. Skip whole blocks before testing individual shapes. At the last frame of the 100,000-node run this tests 1,024 elements rather than 100,000, retains 110, and draws the plain rectangles in one GPU batch. Scene-build median fell to 0.2 ms in the first indexed run. See [indexed-pan.json](indexed-pan.json). Geometry mutation, removal, restoration and shadow reach are covered by native and GPU-pixel checks.

3. **Coalesce bounds maintenance.** Rebuilding a block after every property update repeated the same work up to 64 times in one transaction. Mark blocks dirty and rebuild each affected block once before the next frame or hit query. Also cache up to 1,024 parsed color words, which avoids reparsing unchanged fills at the JS/WASM boundary. The 100,000-node, 1,000-edit workload fell from 4.0 ms median synchronous update to 1.8 ms. Compare [indexed-edit.json](indexed-edit.json) with [final-edit.json](final-edit.json). This is a combined optimization measurement, not an isolated attribution to either change.

The final pan run records about 0.1 ms median scene build and 0.3 ms GPU encoding/submission at 100,000 elements. Low values are close to timer resolution; use the samples and repeat on your hardware. Overlapping shadows require more painter-order batches: the shadow run ends with 48 draws rather than one.

## Boundaries of the result

- The benchmark does not support the claim that a 100,000-element DOM document always becomes unusable. Plain parent-transform panning is inexpensive on this browser.
- Viewport virtualization is effective in both renderers. The DOM baseline’s synchronous CPU cost is lower for some workloads; Silk’s API also performs validation, history bookkeeping and events.
- The grid is spatially coherent in insertion order. Interleaved distant shapes make the block unions less selective; arbitrary overlap and an all-visible overview can remain O(n) and are not represented by these numbers.
- Ellipse path rasterization, text atlas population, complex blur stacks, text editing, image-heavy scenes, mobile browsers, Firefox, Safari, low-end GPUs, and production design documents are outside these measurements.
- This test uses a hardware GPU, not SwiftShader. CI correctness uses software rendering; its timings should not be compared with this report.

## Reproduce

From the repository root, with installed Silk/Clang and the Playwright/browser paths configured as in the package README:

```sh
python3 graphics/editor/scripts/browser build
EDITOR_RESULTS=build/editor-results/pan node graphics/editor/web/test.mjs --bench
EDITOR_RESULTS=build/editor-results/edit EDITOR_WORKLOAD=edit node graphics/editor/web/test.mjs --bench
EDITOR_RESULTS=build/editor-results/shadows EDITOR_COUNTS=100000 EDITOR_SHADOWS=1 node graphics/editor/web/test.mjs --bench
```

`EDITOR_COUNTS` is a comma-separated list (default `1000,10000,100000`). The demo exposes the same comparison harness and downloads a JSON report. No benchmark uses hard timing assertions.
