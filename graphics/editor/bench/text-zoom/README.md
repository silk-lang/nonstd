# Extreme-zoom text verification

The old implementation (`a24d968`) capped a bitmap of the entire line. At extreme zoom,
that cap magnified individual texels. The new implementation rasterizes the visible window
of the complete shaped line, then composites that window through Silk's GPU atlas.

These are direct 720 × 280 canvas captures from Chrome 155 on macOS, DPR 1, zoom 64.
The text is `Silk serif text ` repeated twelve times, Georgia 24px, weight 400, fill
`#20232a`, at world (0, 0). The camera is at (0, 8). Both implementations use the current
WASM module, with the baseline's original JavaScript wrapper. `reference.png` renders the
same complete line directly into a viewport-sized Canvas2D canvas at the camera transform.
No font outlines or competitor implementation are assumed.

[View the comparison](comparison.html). [Raw measurements](measurements.json).

Mean absolute red-channel difference from the direct browser reference (0–255 scale) fell
from **17.413 to 0.121** over all 201,600 pixels. The reference contains 41,744 ink pixels,
so an empty image cannot pass the regression. This measures this fixture, not general
parity with Figma/Paper or every font/browser. Supersampling and browser hinting can still
change individual edge pixels.

The sharp path used 1,769,184 cached raster pixels across two live tiles (whole-run fallback
plus visible window), compared with 384,836 pixels in the old capped tile. Both had 30 GPU
handles. Moving the camera by 0.2 world units per frame for 30 frames required three window
refreshes, with median text preparation 0ms and p95 12ms in this sample. The blurry baseline
had no refreshes and p95 0.1ms. These short timings include browser readback, premultiplication,
WASM copying, and upload submission; they are not GPU timings or a throughput benchmark.
Skipping premultiplication for clear/opaque pixels reduced the new path's observed p95 from
21.4ms to 12ms in consecutive local runs; timing noise and this small sample limit that comparison.

The visible window has 64-pixel overscan and reuses its atlas slot. Offscreen windows release
allocations. The 4094-per-side / 4,194,304-pixel raster budget still applies to windows: very
large viewports or atlas pressure can reduce density, reported by `limitedTextRuns`.

Reproduce after building `dist/`:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright \
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome \
node graphics/editor/web/text-zoom-visual.mjs
```

The runner checks that the baseline fails and the current implementation passes the
one-grayscale-level mean-error threshold. It removes its temporary baseline module afterward.
`web/text-zoom-contracts.js` adds browser regressions for extreme zoom, fractional and larger
pans, scaled shared copies, rounded clipping, transparency, DPR, history, allocation failure,
slot reuse, offscreen removal, viewport caps, and destruction. Native tests verify that tile
windows affect paint geometry while preserving element identity and full hit bounds.
