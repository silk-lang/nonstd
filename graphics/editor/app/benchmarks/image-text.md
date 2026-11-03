# Image/text stress workload

Run a release WASM build, then `bun run build` and `bunx vite preview --port 5173` in the app.
Open the image/text challenge through Commands. Use a 1440×960 browser viewport at DPR 2.
The measured browser was the local T3 Chromium preview on macOS; no video was recorded.

Paste this function in the browser console. It dispatches input through Studio's normal
wheel handler and measures animation-frame cadence. It does not measure GPU completion,
input-to-display latency, or compare another product. The first ten intervals are omitted.

```js
async function cameraGesture(pan = false, zoomDelta = 30) {
  const host = document.querySelector('#canvas-host')
  const bounds = host.getBoundingClientRect()
  return new Promise((resolve) => {
    const intervals = []
    let previous = performance.now(),
      index = 0
    function tick(now) {
      intervals.push(now - previous)
      previous = now
      const direction = index < 60 ? -1 : 1
      host.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.x + bounds.width / 2,
          clientY: bounds.y + bounds.height / 2,
          deltaX: pan ? -direction * 18 : 0,
          deltaY: pan ? 0 : direction * zoomDelta,
          ctrlKey: !pan,
        }),
      )
      if (++index < 120) requestAnimationFrame(tick)
      else {
        const samples = intervals.slice(10).sort((a, b) => a - b)
        resolve({
          median: samples[Math.floor(samples.length * 0.5)],
          p95: samples[Math.floor(samples.length * 0.95)],
          max: Math.max(...samples),
          over25: samples.filter((value) => value > 25).length,
        })
      }
    }
    requestAnimationFrame(tick)
  })
}
```

Set zoom to 400%, run one warm-up `await cameraGesture()`, then measure another zoom
and `await cameraGesture(true)` for pan. Click Fit all and repeat both measurements.
The checked-in JSON records one local run of each, including two overview intervals above
25 ms. Do not discard that return-to-overview run: text atlas growth previously exposed
severe batching costs there. Machine load and cache state affect these measurements.

The warm close-up zoom had an 8.8 ms p95 frame interval; the overview zoom after close-up
had a 16.7 ms p95. The latter still included an 83.4 ms worst interval. Neither establishes
performance for 100k unique images, unique strings, or filtered layers. See the JSON for
all samples' summary statistics and the precise source/style reuse in this workload.

Correctness checks compare retained and ordinary GPU output in memory for source crops,
alpha, fractional cameras, mutations, undo, filters and mixed primitives. All nine image
comparisons had zero pixel difference in the local run. Native tests protect ordering
across texture pages and cache invalidation. App tests cover distinct integer crop windows,
legacy document decoding, SVG asset reuse, nested group bounds, and a 100k-group edit
budget. Production inspector width editing and undo were also exercised through the UI.

## Wide zoom and direct text editing regression

The original measurements above used a narrow ±2 wheel delta. That missed the stalls
when crossing many raster-density levels. Use the function's default ±30 delta starting
from Fit all for the wider regression, then repeat without reloading. Wait for the page
to finish loading before sampling. The two-second gesture crosses from the overview to
readable cards and back; both cold and warmed results matter. The target is p95 below
25 ms. [Follow-up measurements](image-text-zoom-fix.json) retain the worst intervals too.

The fix reserves bounded useful rasters for small labels, keeps them while memory permits,
prunes text preparation by spatial blocks, switches to CPU culling sooner, and reuses
image bind groups within a render pass. It preserves text resolution and painter order.

Direct editing was verified by selecting Box 100000's text, choosing **Zoom to selection**,
double-clicking its canvas bounds, replacing the text, pressing Enter, waiting for local
save, and undoing. Releasing a stationary click previously serialized the entire document
twice; a 300k-layer CPU reproduction took 339 ms and allocated large temporary strings.
The identity-based path took under 1 ms. A three-pixel drag threshold also prevents click
jitter from invoking snapping and document transformations before text editing begins.
The model tests guard click, jitter, return-to-origin drag, and history behavior.
