# Performance history


## Built-in virtualization — November 4

`virtualized.json` and `fully-mounted-comparison.json` use the same release binary,
1280 × 900 CSS pixels, scale 2, and 120 wheel/frame steps. Timing includes input,
app event handling, row mounting, measurement corrections, layout, and paint.

| Document | Mode | Median CPU step | p95 CPU step | Initial mounted nodes |
| --- | --- | ---: | ---: | ---: |
| 1,000 sections | Fully mounted | 44.47 ms | 51.95 ms | 33,863 |
| 100 sections | Virtualized | 0.97 ms | 5.15 ms | 91 |
| 1,000 sections | Virtualized | 0.93 ms | 5.04 ms | 91 |
| 10,000 sections | Virtualized | 0.92 ms | 4.88 ms | 91 |

The 1,000-section median improves by about 48×. The initial virtualized tree has
650 layout fragments. Its mounted size changes as different section variants enter
overscan; it does not remain exactly 91 nodes. No timing thresholds are test gates.

`virtualized-long.json` extends the 10,000-section run to 1,000 steps (48,000 pixels
down, then back): median 0.96 ms, p95 5.61 ms, maximum 22.46 ms. This tests visiting
more sections, not laying out all 10,000. Occasional outliers remain. Mount timings
exclude initial font/resource registration and native window/GPU setup.

The main improvement is `ui-app` virtualization: a measured-height prefix index,
overscan with hysteresis, scroll anchoring, focus retention, and bounded layout,
hit testing, and accessibility trees. `ui-tree` also skips entire subtrees behind
an empty clip and preserves that exclusion when replaying cached paint. Fully
mounted geometry and paint hashing still scale with total document size.

The app tests exercise a distant jump, focus retention, width invalidation,
content revision, an empty list, list removal, and a lazy ancestor. The tree test
checks clipped traversal, cached paint order, and text returning into view.
All 11 app tests and 27 tree tests pass, as do four existing UI goldens,
WebAssembly checking, the macOS window smoke test, native 100→1,000 growth,
and the 10,000-section native GPU/CPU image comparison.

### Browser and native window pacing

`browser-virtualization.json` records Chromium/Electron in the T3 preview using
`content-visibility:auto`, the same fonts/photos/section variants, and a 1280 × 900
viewport at scale 2. The 10-second pass scrolls at 5,000 CSS pixels per second.
All 198,329 DOM elements remain mounted. Browser rAF interval median is 14.4 ms,
p95 40.1 ms. Scroll setter/read timings are recorded separately and are **not**
comparable to native layout/paint CPU times.

`native-virtualized-window.json` records the actual native window with accessibility,
uploads, drawing, and presentation enabled. The native frame log separates drawable
acquisition waits from CPU work. Presentation-submission intervals and browser rAF
intervals are pacing proxies with different observation points; neither measures
GPU completion or display scanout. The final capture contains 116 samples after
three startup frames: median CPU stages total 1.43 ms and p95 1.89 ms. Submission
intervals have median 8.33 ms and p95 16.44 ms. The native host pauses when covered,
so these are active-frame samples, not a sustained 12-second throughput result.
Earlier longer captures were mostly near 60 Hz and spent substantial time waiting
for a drawable. Display-link rate/lifetime experiments did not consistently remove
that wait and were not retained. Sustained 120 Hz presentation is not established.

Virtualization exposes mounted content to inspection and accessibility. It does
not yet supply browser-style whole-document find or offscreen accessibility
navigation. Preserve application state in the model when rows unmount.

The sections below retain the earlier fully mounted measurements for comparison.


## Scroll and native stall fixes

`scroll-fixes.json` records the next 120-frame run on the same machine and document.
The comparison below uses `after.json` (the original demo after its mounting fix).

| Sections | Previous CPU frame median / p95 | Fixed CPU frame median / p95 |
| ---: | ---: | ---: |
| 100 | 89.9 / 114.5 ms | 3.9 / 4.4 ms |
| 1,000 | 903.7 / 1,024.5 ms | 38.6 / 41.9 ms |

These remain headless CPU measurements, excluding native accessibility, GPU work,
and presentation. The 1,000-section case still exceeds a 16.7 ms frame budget.

The shared-library changes are:

- `css-layout` retains pre-scroll visual offsets and exposes `repositionScroll` for
  callers whose measurement inputs are unchanged. `ui-tree` uses it for scroll-only
  updates. Both workloads now perform zero full box layouts while scrolling.
  Fragmented output and invalidated/changed geometry fall back to normal layout.
- `ui-tree` retains conservative raster text ink bounds, keyed by run fingerprint,
  raster face and scale. Invisible runs skip glyph-cache work while decorations
  still paint normally. Both sizes process at most 1,332 glyphs in this pass.
  Vertical/vector text and input text keep their existing paths.
- Geometry and paint-order queries use indexes instead of scanning the document
  for every node. Native accessibility publishing therefore avoids quadratic work.
- macOS accessibility child lists are indexed per snapshot, so an accessibility
  client traversing the document also avoids repeated full-node scans.

The native 1,000-section window initially stalled for minutes while publishing
accessibility. No process crash report was found. After these changes, the native
`--check-grow` regression goes from 100 to 1,000 sections, scrolls, verifies the
model update and compares GPU output with the CPU reference, completing in 2.5 s.

Validation: 298 layout tests, 26 UI-tree tests, 10 app tests, all four existing app
goldens, and the UI-tree WebAssembly check pass. Added differential tests compare
retained positioning with fresh layout for nested scrolling, sticky, relative,
absolute and fixed boxes, both automatic and explicit scrollbars, and clamping.
Tree tests compare warm/cold pixels after fractional scrolling and validate the
fragment and paint-order indexes.

The tree still visits and hashes the full fragment hierarchy, and native
accessibility still publishes every mounted node. Those linear costs remain
visible at 1,000 sections; this change does not claim constant-time scrolling.

## Initial findings

Measured on an Apple M1 Max, macOS arm64, with the pinned dev.47 Silk compiler and
a release build. Viewport: 1280 × 900, scale 2. The feature branch starts from
`acaf8d5b3`; the before runs use the new demo with the original `ui-app` runtime.
The after runs use the same document with the mutation-batch transfer fix in
`ui/app/src/runtime.silk`. All runs were local, not on an isolated benchmark machine.

## Fixed: quadratic app construction

`Runtime.render` transferred mutations by repeatedly removing element zero from a
list. Each removal shifted the remaining array. The runtime now transfers ownership
of the list directly, preserving mutation order and the tree's existing error handling.
This is a shared `ui-app` improvement; the demo has no special mounting path.

| Sections | UI nodes | Layout fragments | Mount before | Mount after |
| ---: | ---: | ---: | ---: | ---: |
| 100 | 3,411 | 30,434 | 879 ms | 112 ms |
| 1,000 | 33,861 | 303,884 | 60,999 ms | 1,111 ms |

Mount includes runtime construction plus the first layout and paint, excluding font
collection and resource registration before the timer. After the fix, runtime
construction takes 4.4 ms / 41.9 ms for these sizes; the first frame takes
108 ms / 1,069 ms. Each mount figure is a single sample, not a median.

## Remaining: document-wide scroll work

These are **CPU timings, not FPS**. Each normal run contains 120 down/up wheel-frame
pairs and excludes native accessibility, GPU work, and presentation.

| Sections | Before frame median / p95 | After frame median / p95 |
| ---: | ---: | ---: |
| 100 | 86.7 / 89.2 ms | 89.9 / 114.5 ms |
| 1,000 | 866.1 / 911.3 ms | 903.7 / 1,024.5 ms |

The mounting fix does not optimize scrolling. Differences between these separate
local runs are not evidence of a scrolling improvement; both still scale with total
document size. The final benchmark also includes an additional timestamp read.

The separate eight-frame diagnostic runs (`before-phases.json`) attribute about
87 ms / 940 ms to layout and 7.6 ms / 75.6 ms to the remaining frame work. Those
runs resolve layout explicitly before `frame` and must not be compared directly
with normal runs. They show 3,545 / 35,195 full box layouts on a scroll.

The painter visits roughly 30,000 / 304,000 fragments and processes roughly
69,500 / 699,000 glyphs even though only a small fraction is visible. The scene
builder rejects clipped primitives downstream; these counts describe work already
done by the tree painter, not visible glyphs or GPU draw calls.

The next shared-library targets are:

- Reuse settled geometry on scroll-only updates, while correctly updating sticky
  and fixed positioning, clipping, scroll clamping, and automatic scrollbars.
- Cull invisible paint work earlier, preserving glyph overhang, visible overflow,
  shadows, subtree caches, and accessibility ordering.
- Measure the native accessibility and event-loop costs separately from these
  headless results before making end-to-end smoothness claims.

## Reproduction and checks

The additional 10,000-section run (`after-10000.json`) completes with 338,361 nodes
and 3,038,384 fragments. Mount takes 11.49 seconds (0.55 seconds building the app,
10.94 seconds for the first frame). Its four scroll frames have a 10.48-second
median. This is a short capacity probe, not a statistically stable p95 benchmark;
the workload is far beyond interactive performance today.

See the [demo commands](../README.md). `before.json` and `after.json` contain the
120-sample summaries. `before-phases.json` contains the separate diagnostic run.
Raw per-frame logs are generated by `scripts/measure`; no timings are test gates.

Validation for this change:

- All 10 `ui-app` runtime tests pass.
- All four existing app describe/PNG goldens pass without updates.
- `ui-app` checks for `wasm32-unknown-unknown`.
- The native demo's click, scroll, and GPU/CPU comparison passes at 100 sections.
- Both normal benchmark runs verify the requested section count, downward wheel
  movement, and return to the top in the final implementation.

The initial before harness only asserted the first downward movement; the final
harness adds the mounted-count and return-to-top assertions. Document content and
the scrolling sequence are otherwise unchanged.
