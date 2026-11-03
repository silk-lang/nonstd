# Silk versus browser text

Historical baseline before image-run batching and preparation caching. See the
[latest results](../text-throughput/README.md): the 100,000-label Silk overview now reaches
roughly 120 FPS on this machine.

**The winner depends on the workload.** HTML wins the huge static overview. Silk wins the
10,000-label edit workloads. High-zoom text, 1,000 labels, and 2,000 unique labels are
essentially tied at this machine's display ceiling.

[Chart](comparison.html) · [Raw samples](measurements.json)

| Workload | Silk | HTML | HTML + compositor hint | Canvas2D |
| --- | ---: | ---: | ---: | ---: |
| One long line, continuous 40–64× zoom | ≈120 FPS | ≈120 | ≈120 | ≈120 |
| 1,000 visible labels, zoom | ≈120 | ≈120 | ≈120 | ≈120 |
| 2,000 unique visible labels, zoom | ≈120 | ≈120 | ≈120 | ≈120 |
| 10,000 visible labels, zoom | ≈120 | ≈120 | ≈120 | 72 |
| 100,000 visible labels, zoom | **11.6** | **96.4** | **≈120** | **5.1** |
| 10,000 labels, 100 cached text changes/frame | **118.6** | 68.9 | 67.1 | 72.2 |
| 10,000 labels, 20 new strings/frame | **105.5** | 66.9 | 68.8 | 72.1 |

Values average two runs. Near-ceiling differences are noise, not meaningful wins. Silk's
fresh-string runs ranged from 100 to 111 FPS. At 100,000 labels, its text preparation averaged
10.5ms, scene construction 73.8ms, and GPU encoding/submission 1.8ms in the first run. That
identifies scene construction as the main CPU bottleneck; GPU execution was not timed.

## Method

Measured commit: `d75acff`, without renderer changes during this benchmark. Shared T3 browser:
Chromium 152 / Electron 44, Apple Metal-3, 10 logical cores, actual device pixel ratio 2.
The viewport is 1200 × 700 CSS pixels (2400 × 1400 physical pixels). Idle rAF cadence was
roughly 8.3ms. Each of seven workloads has four renderers, two runs, 20 warmup frames and
60 measured frames: **56 completed runs**. Renderer order was reversed on confirmation.

- All paths draw actual glyphs, using the same content, font, positions, colors, camera,
  viewport, and physical-pixel density. The overview uses Arial 16px; closeup uses Georgia 24px.
- Overviews contain a grid of labels and keep **every label visible** throughout the camera
  trajectory. The harness checks scene bounds and Silk's visible count on every measured frame.
  Culling cannot explain the differences. At 100,000 labels, zoom is only 2.7–3.1%, so individual
  letters are microscopic; this is a dense overview stress case, not readable body text.
- Repeated-label scenes use **256 distinct strings**, matching Silk's shared-run cache.
  A separate 2,000-string case tests unique content. This is not a claim that Silk can support
  100,000 distinct text styles: its current lifetime cache limit is 4,096 styles per editor.
- Cached edits toggle 100 distributed labels between two same-width numeric strings per
  frame. Those variants are warmed before measurement. Fresh edits introduce 20 previously
  unseen numeric strings per frame: Silk performs 1,200 measured uploads per run, rather than
  benefiting from a warmed whole-line cache. Both use a stationary overview camera.
- HTML uses positioned spans and one parent transform. The compositor variant additionally
  sets `will-change: transform`. This is a useful browser optimization, not excluded from the
  comparison. Browser layer caching and raster-density policies differ from Silk; these timing
  tests do **not** prove pixel-identical quality during zoom. Silk reports its raster limit for
  the large DPR-2 closeup window, consistent with its documented 4M-pixel budget.
- Canvas2D redraws the complete scene with `fillText` each frame, using the same glyph origins.
  It has no custom retained line-bitmap cache; that is a different architecture from this direct
  browser-drawing baseline. The browser may internally cache glyphs.
- FPS comes from rAF intervals. These measure callback cadence, not a presentation fence.
  CPU timings cover synchronous JS/WASM/API work; DOM layout and painting happen afterward,
  so comparing CPU submission times alone would misleadingly favor HTML. Raw samples include
  both CPU and frame intervals. Setup timing measures construction, not comparable first-paint
  latency, and is excluded from the FPS results.

An initial Canvas2D 100k automation call timed out and left an unfinished test. Its partial
run was discarded and the owned tab reloaded. Both retries completed as asynchronous jobs
with a 10-second per-frame watchdog and 20-second loop budget. They measured 5.23 and 4.96 FPS.
No production renderer optimization is included in this benchmark commit.

## Reproduce

Build with `python3 graphics/editor/scripts/browser build`, then:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome \
node graphics/editor/web/text-browser-perf.mjs
```

The runner writes results incrementally under `build/editor-results/text-browser`; use
`EDITOR_RESULTS` to choose a destination. `--smoke` checks all four renderers on a short
closeup workload. Failed/over-budget cases are recorded instead of being silently omitted.
The reusable workload is `web/text-browser-benchmark.js`, which was also run directly in the
shared browser for the committed measurements. A standalone Chrome session may have a
different refresh ceiling, so compare against its recorded idle cadence.
