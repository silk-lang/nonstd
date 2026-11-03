# Adaptive text verification

The screenshots compare the fixed-resolution JavaScript wrapper from commit `ff42c6d` with
adaptive text. Both use the current WASM module and the same browser/GPU path. The old wrapper
uses the unchanged `editor_image` ABI; the new wrapper also uses `editor_image_replace`.

Each image is a direct 720 × 280 canvas screenshot from installed Chrome 155 on macOS, DPR 1.
The content is `Silk Aa`, font size 24, sans-serif, weight 400, fill `#20232a`, white background,
world position (0, 0), zoom 8. Geometry is identical. Browser font hinting at different raster
sizes can change the precise glyph-edge coverage; this is not a document layout change.

[Open the comparison](comparison.html). Raw diagnostics from capture are in
[measurements.json](measurements.json). The old 158 × 80 text raster is enlarged on screen.
The new 1264 × 640 raster has eight times the resolution on each axis. It uses one live atlas
tile after replacement. These captures demonstrate appearance, not a text-throughput benchmark.

`web/text-contracts.js` runs through the normal browser harness and checks zoom, independent
width/height scaling, DPR, unchanged frames, density-boundary hysteresis, shared text, repeated
zoom cycles, visibility, removal/undo, type conversion, extreme-scale caps, and simulated atlas
allocation refusal/retry. `src/tests.silk` checks that replacing a shared image tile preserves
all consumers and their geometric identities. The first text regression was run against the
old implementation and failed because zooming produced no new raster.

The raster target is two samples per displayed pixel, bucketed independently on each axis.
Each raster is limited to 4094 pixels per side and 4,194,304 pixels total. Extreme zoom or
allocation pressure can still limit sharpness; the editor reports this through
`diagnostics.limitedTextRuns`. The README documents cache and resource behavior.
