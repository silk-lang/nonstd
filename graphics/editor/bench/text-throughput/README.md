# Text throughput after batching

**Silk now beats ordinary HTML on the 100,000-label overview and reaches roughly the same
display ceiling as compositor-cached HTML.** The original 11.6 FPS result is now about
120 FPS, without removing labels or changing the text raster-quality policy.

[Chart](comparison.html) · [Raw samples](measurements.json) · [Original comparison](../text-browser/README.md)

| Workload | Silk FPS | HTML FPS | HTML + compositor hint FPS |
| --- | ---: | ---: | ---: |
| 100,000 visible labels, zoom | 122.6 (120.9–122.8) | 89.7 (84.9–90.6) | 113.5 (100.0–118.1) |
| 10,000 labels, 100 cached text edits/frame | 119.8 (118.6–121.0) | 66.7 (65.3–68.2) | 68.0 (67.9–68.2) |
| 10,000 labels, 20 new strings/frame | 117.2 (114.4–119.9) | 68.5 (66.4–70.6) | 69.6 (69.6–69.6) |

Values are medians of run-level average rAF rates; parentheses show their ranges. The overview
has three runs per renderer, with varied execution order. Each edit case has two runs per
renderer, with reversed order. Near 120 FPS, callback jitter can produce averages slightly
above the nominal display rate. This is not evidence of more than 120 presented frames per
second. Cached HTML previously reached 120 FPS too; its lower repeat results do not establish
a general win for Silk over that optimized browser path.

Three additional Silk checks stayed near 120 FPS: a long Georgia line zooming through 40–64×,
2,000 unique labels, and 10,000 repeated labels. The closeup still performed 60 measured raster
updates; the fresh-edit runs each performed 1,200. These paths have not been bypassed to get
the new numbers. Canvas2D was not rerun: its earlier 100k result was about 5 FPS.

## What changed

The isolated 100,000-label profile reproduced the slow case before changes:

| Implementation | Mean scene build | Mean text preparation | Median synchronous CPU | rAF rate |
| --- | ---: | ---: | ---: | ---: |
| Original | 74.1 ms | 10.6 ms | 86.9 ms | 11.4 FPS |
| Bounded image runs | 5.1 ms | 10.5 ms | 17.8 ms | 55.8 FPS |
| Image runs + preparation cache | 5.0 ms | <0.1 ms | 7.1 ms | 120.0 FPS |

The first two diagnostic profiles used 10 warmup / 30 measured frames; the final profile used
20 / 60. They explain the bottleneck, while the table above uses the fresh matched comparisons.
Those final comparisons measured 7.1–7.4 ms median CPU and 5.0–5.2 ms mean scene construction.

- **Bounded image runs.** Consecutive text sprites on the same atlas texture share one ordering
  bound per run of at most 64 slots. This avoids inserting every tiny label separately into the
  overlap tree. Runs stop at other primitive kinds and texture changes, preserving translucent
  painter order. Bounds use the same cropped-sprite arithmetic and pixel rounding as drawing.
- **Preparation cache.** Fully contained, unchanged whole-run text records its scene bounds
  and valid physical-scale interval. Within that interval every raster retains 2–8 samples per
  displayed pixel, so camera movement does not require another full JS scan. Edits, removal,
  visibility changes, type changes, and history invalidate the proof. Leaving its bounds or
  scale interval returns to normal preparation; cropped high-zoom windows and limited rasters
  use the existing path.

All 100,000 labels remain submitted on every measured overview frame. The optimization does
not use a flattened scene bitmap, level-of-detail removal, or additional visibility culling.

## Method and limits

Measured on 2026-11-03, with the changes accompanying this report on top of `f17c50c`.
Shared T3 browser: Chromium 152 / Electron 44, Apple Metal-3, 10 logical cores, actual DPR 2.
The same unchanged `web/text-browser-benchmark.js` fixture is used: 1200 × 700 CSS pixels,
20 warmup frames and 60 measured frames, identical text, fonts, positions, and camera across
renderers. There are 24 completed runs in the new raw file. Renderer creation and warmup are
excluded from timing; renderers execute sequentially.

The 100k overview has 256 distinct strings at 2.7–3.1% zoom: individual letters are microscopic.
Silk's lifetime style cache still has a 4,096-entry limit. These results do not establish
performance for 100,000 unique strings, readable densely overlapping text, other browsers,
or other hardware. HTML uses one parent transform; its hinted variant adds
`will-change: transform`. Browser caching and raster-density policies differ, so this timing
comparison does not prove pixel-identical quality while zooming.

rAF measures callback cadence, not a compositor presentation fence. GPU execution is not timed.
Synchronous DOM CPU figures omit later layout and paint; use frame cadence for the comparison.
See the original report for full fixture and Canvas2D-baseline details.

## Validation and reproduction

`python3 graphics/editor/scripts/check --browser` passed four native tests, native/browser
package checks, the release WASM build, and 87 browser contracts (41 general, 25 text, 21
high-zoom). Real pointer/keyboard interactions and the 100,000-element overview also passed.
New checks cover atlas-page ordering, pixel equality with individually ordered translucent
text at three zoom/DPR combinations, and preparation invalidation after style/visibility/
geometry changes and undo.

Use the [existing runner](../text-browser/README.md#reproduce) to repeat the complete text
matrix. To repeat just this optimization's main case in a served demo, import
`/web/text-browser-benchmark.js` and call `benchmarkBrowserText` sequentially with
`{ mode, count: 100000, frames: 60, warmup: 20 }` for `silk`, `dom`, and `dom-composited`.
Repeat in reversed order and keep the tab visible. Record its idle cadence: a different browser
session may have a different refresh ceiling.
