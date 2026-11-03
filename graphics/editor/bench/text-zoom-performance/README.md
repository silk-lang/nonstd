# Continuous text zoom performance

The previous high-zoom fix (`690a1e6`) rasterized at exactly the required density, then
required that same density for reuse. Every small zoom-in step invalidated the window.
Each refresh also called `getImageData`, premultiplied pixels in JavaScript, copied them into
WASM memory, and uploaded them back to the GPU. A capped Retina-sized window could repeat
this work on every frame.

The editor now reuses an uncapped window until its density falls below 1.5 samples per
physical pixel (the refresh target remains 2). Canvas pixels go directly to the GPU atlas
using `copyExternalImageToTexture`, with premultiplied alpha and sRGB explicitly selected.
No pixel readback or WASM pixel buffer is involved. The native allocator still installs the
new tile only after a successful copy submission and releases failed allocations.

The atlas's color textures include `RENDER_ATTACHMENT` usage, as required by the
[WebGPU external-image-copy specification](https://www.w3.org/TR/webgpu/#dom-gpuqueue-copyexternalimagetotexture).
Native byte uploads remain available. Error callbacks are deferred until the native state
loan has ended, so application listeners cannot reenter WASM from inside the upload import.

[Chart](comparison.html) · [Raw samples and environment](measurements.json)

Measurements were collected in the shared T3 browser on Apple Metal. Each case uses one
Georgia 24px line (`Silk serif text ` repeated twelve times), a 1200 × 700 CSS-pixel viewport,
and 90 centered zoom steps from 32 to 64 or back. DPR 1 and 2 are explicit editor settings.
The old JS wrapper and current JS wrapper run against the same new WASM module; the old
wrapper supplies an unused stub for the new canvas-copy import. Idle rAF cadence was roughly
8.3ms. The frame interval includes the render work preceding that frame.

| Case | Previous CPU p95 | Current CPU p95 | Previous frame p95 | Current frame p95 | Uploads before → after |
| --- | ---: | ---: | ---: | ---: | ---: |
| DPR 1, zoom in | 28.4ms | 0.7ms | 33.2ms | 9.2ms | 90 → 2 |
| DPR 1, zoom out | 23.1ms | 1.0ms | 25.7ms | 9.2ms | 30 → 4 |
| DPR 2, zoom in | 25.3ms | 1.2ms | 26.0ms | 9.2ms | 90 → 90 |
| DPR 2, zoom out | 26.8ms | 1.2ms | 33.3ms | 9.3ms | 90 → 90 |

None of the current runs had a frame interval above 1.5× their measured idle cadence.
These are short, single-machine measurements of this fixture, not a guarantee for every
document/device. At DPR 2, the window hits the existing pixel budget and still refreshes
each step; direct GPU copying makes those refreshes inexpensive. The 4M-pixel raster budget
and atlas capacity limits are unchanged. `stats.textMs` measures CPU submission, not GPU
completion, while rAF intervals give a separate frame-pacing measurement.

Reproduce after building the browser package, using the same Playwright environment as the
other editor tests:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome \
node graphics/editor/web/text-zoom-perf.mjs --assert
```

This writes fresh results under `build/editor-results/text-zoom-performance` (override with
`EDITOR_RESULTS`). `--assert` checks a 16.7ms CPU budget and frame p95 below 1.5× measured idle cadence.
The standalone Chrome session may have a different refresh ceiling (30Hz on a local run),
so an absolute frame-interval threshold would misclassify even idle frames. These are local
performance checks, not hardware-independent CI thresholds. The temporary legacy wrapper is removed afterward. The ordinary browser suite
instead checks deterministic regressions: no text pixel readbacks, bounded upload count
during a gradual zoom, direct-browser visual parity, and actual GPU-copy failure cleanup.
The earlier tests covered fixed zoom levels and panning; a continuous zoom gesture is now
part of both the correctness suite and the performance workload.
