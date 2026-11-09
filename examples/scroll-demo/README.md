# Fieldnotes Scroll Lab

A native scrolling stress demo built on `ui-app`, `ui-tree`, `css-layout`, `ui-text`,
and the shared GPU renderer. The default uses `Ui.virtualItems`, the library's
variable-height virtual list. A **Virtualized / Fully mounted** button compares it
with the original fully mounted document. Both modes use ordinary UI nodes.

The document mixes wrapped paragraphs, headings, sticky section labels, two-column
image grids, captions, tables, callouts, and code blocks. Section heights vary.
Bundled fonts and twelve bundled PNG/JPEG images keep runs deterministic and offline;
the images repeat, so this measures document rendering rather than loading thousands
of unique image resources.

## Run

Complete the [local setup](../../README.md#run-an-application-locally) first
(`silk use`, LLVM 22 and, on macOS, `SDKROOT`), then run from the **nonstd repository root**:

```sh
node examples/scroll-demo/scripts/run
node examples/scroll-demo/scripts/run --sections=10000 --profile
node examples/scroll-demo/scripts/run --sections=1000 --fully-mounted
node examples/scroll-demo/scripts/run --bundle  # macOS
```

`run` builds release by default; `--debug` selects debug, `--build-only` prints
the artifact path without launching, and remaining options go to the app.
`--bundle` stages the executable atomically into the macOS bundle and does not launch it.

The default is 100 sections. Buttons select 100, 1,000, or 10,000 sections and toggle
images. Use the wheel/trackpad or **Auto scroll**; **Reverse** changes the direction.
The automatic pass injects ordinary wheel input at 5,000 CSS pixels per second,
capping each time step at 50 ms. It stops advancing at the document boundary; reverse
or pause it there. Resize the window to exercise text reflow and grid layout.

The command line accepts `--sections=1` through `--sections=10000`.
Virtualized mode keeps only nearby sections mounted, with measured heights and
scroll anchoring managed by `ui-tree`. Fully mounted mode remains a deliberate
stress test and can block the UI at large sizes. `--auto-scroll` starts motion on launch.

The bundle is `build/Fieldnotes Scroll Lab.app`. `--profile` prints the standard
window host's frame timings, including upload, draw, and presentation submission.
`acquire` separates waiting for a surface drawable from CPU upload work. `interval`
measures time between presentation submissions. These are CPU timings and a pacing
proxy, not GPU completion timestamps or proof that every frame reached the display.

## Inspect with devtools

Start a debug build with the inspector enabled:

```sh
SILK_UI_INSPECT=/tmp/scroll-lab.sock node examples/scroll-demo/scripts/run --debug
```

From another terminal in the same repository checkout, open the devtools window:

```sh
node "$(node scripts/dependency-root.mjs lib-ui)/modules/inspect/devtools/scripts/devtools" run --connect /tmp/scroll-lab.sock
```

The demo prints `ui-inspect: listening on ...` when ready. Inspection is disabled
in release builds and when `SILK_UI_INSPECT` is unset. The element tree shows the
currently mounted virtual rows. To check socket discovery and a real button click:

```sh
node examples/scroll-demo/scripts/inspect-check
```

This macOS/Linux smoke test builds the debug app, starts it on an isolated socket,
checks the element tree, clicks Reverse, and verifies Forward appears. It requires
a desktop display and GPU; `--binary PATH` reuses an existing debug build.

## Measure

Build once, then run the same document headlessly through the real wheel dispatcher,
runtime event pump, layout engine, text system, and painter:

```sh
node examples/scroll-demo/scripts/run --build-only
node examples/scroll-demo/scripts/measure --sizes 100 1000 10000
node examples/scroll-demo/scripts/measure --sizes 100 1000 --fully-mounted
node examples/scroll-demo/scripts/measure --sizes 100 1000 --steps 8 --phases \
  --directory build/scroll-lab-phases
node examples/scroll-demo/scripts/measure --sizes 10000 --steps 4 --timeout 600 \
  --directory build/scroll-lab-10000
```

The normal benchmark measures the first mount, then 120 wheel/frame pairs: 60 down
by 96 CSS pixels and 60 up, at 1280 × 900 CSS pixels and device scale 2. It verifies
that the mounted section count stays bounded (or matches the requested count in
fully mounted mode), that the wheel moves, and that the reverse pass returns to the top.
Timing includes the app diff, measurement corrections, and repeated layout needed
to settle newly mounted rows through `runtime.frame`. There are no discarded warm-up samples.
These passes revisit the first part of the document; they measure the effect of total
document size on local scrolling, not traversal of every section.

Each run saves raw logs and `results.json`, with median, p95, and maximum durations,
node/fragment counts, paint counts, and layout-skipped counts. CPU results exclude
native accessibility, the event loop, GPU work, and presentation. A 16.7 ms CPU result
alone does not establish 60 FPS.

The measurement command reuses the single release artifact under `build/llvm`;
it never rebuilds. Defaults are sizes 100 and 1,000, 120 steps, a 600-second
timeout per case, and output directory `build/scroll-lab`. Sizes must be 1–10,000
and steps 2–1,000. Summaries include the Git revision, dirty flag, and binary SHA-256;
each completed case updates `results.json`.

Paint and layout counters describe the last settling pass; elapsed time includes
all passes. A frame can update scroll geometry without a full layout.

`--phases` explicitly resolves layout before calling `frame` to isolate layout from
the remaining frame work. This changes the frame entry state; compare these runs
only with other phase runs. In this mode `layoutSkippedFrames` counts the subsequent
frame calls, not the separately measured layout work. Mount logs also separate app
construction from the first frame.

## Check rendering

```sh
node examples/scroll-demo/scripts/run --sections=100 --check
node examples/scroll-demo/scripts/run --check-grow
```

The native check clicks **Reverse**, verifies **Forward** appears, scrolls the document,
and compares the GPU readback with the shared CPU reference using the window host's
existing tolerance. It exits after the check. Run on a desktop with a supported GPU.

`--check-grow` instead clicks **1,000 sections** from the default 100-section view,
verifies that the model reached 1,000 sections, then checks the scrolled rendering.
This exercises document growth through the app, including native accessibility.

See [measurements](measurements/README.md) for the initial findings and captured runs.

## Check scrolling during slow updates

```sh
node examples/scroll-demo/scripts/exit-test
node examples/scroll-demo/scripts/exit-test --backend x11 --mode virtualized
```

This builds release unless `--binary PATH` is supplied. It runs mounted and
virtualized modes with fast updates and with `--slow-update 200` milliseconds,
scrolling for three seconds and then clicking Reverse. The mounted case uses
`--sections 10000` by default; the virtualized case uses 100 sections.
`--mode mounted|virtualized|all` selects cases. On Linux,
`--backend x11|wayland|all` selects Xvfb/headless Weston, falling back to the
session display when unavailable. Lavapipe is selected when installed and
`VK_ICD_FILENAMES` is unset; `SILK_WINDOW_SCALE` defaults to 1.
Other platforms open real windows.

The slow run must present frames, keep painting, and answer the click; the
baseline must also paint and answer. Gap limits are the greater of `--max-p95 25`
and baseline p95 × 1.25 + 2 ms, and the greater of `--max-gap 50` and baseline
maximum × 1.25 + 2 ms. Each run must paint at least one third of the expected
slow updates during scrolling (minimum two). Any failed case makes the command fail.

## Library API

Use `Ui.virtualItems(listKey, count, options, key, body)` inside a column with a
bounded height. The method manages that column's scrolling and children. Use a
stable, unique list key and stable item keys. `VirtualOptions` provides an estimated
height, overscan distance, gap, and a revision for size-affecting content changes.
The demo's `document.silk` is an executable example.

The retained tree measures mounted row heights, updates a prefix-sum index, and preserves
the visible item's offset when estimates change. Width changes discard old
measurements. Height queries and updates take logarithmic time; the height index
uses linear memory in the item count. Rendering, hit testing, and native
accessibility operate on the mounted tree. A focused row stays mounted when it
leaves the viewport. A lazy ancestor cannot freeze the virtual range.

Keep durable state in the app model: unmounted widgets are destroyed. Document-wide
search and accessibility navigation to unmounted content still require model-level
operations; this is not a complete browser document/search API. Changing the
revision preserves the visible index, not the identity of a reordered item.
Do not place unrelated children, a gap, or vertical padding on the list's scroll
column; put decoration and spacing in the item body instead.

`ui-app` only builds keyed nodes for the requested range and forwards configuration
and item bindings. Direct tree clients can use the same functionality without the
framework; see `modules/tree/README.md` (Virtual scrolling) in the pinned `lib-ui`
checkout printed by `node scripts/dependency-root.mjs lib-ui`.

Native window hosts settle virtual lists automatically. Custom hosts should call
`runtime.frame` instead of `tree.frame`, and continue to pump input events. It limits
layout settlement to eight passes and leaves `tree.needsFrame()` set if more work
remains. Use the fully mounted mode when the entire tree must remain available.

## The Scroll Lab in the browser

The same document, drawn by Silk, also runs in a browser tab: `wasm` (`silk-scroll-demo-wasm`)
builds it for wasm32, with the document itself in the `document` library
(`silk-scroll-document`) that the native app uses too. It needs WebGPU and JSPI (Chrome or
Edge 137 or later):

```sh
node examples/browser serve examples/scroll-demo/wasm   # http://127.0.0.1:8050/
```

It opens 100 virtualized sections. The browser has no platform thread and no compositor
scroll, so wheel scrolling goes through the tree on the one thread; the benchmark and the exit
test stay native. Add `?check` to the address for the same check as `--check`.

## Browser baseline

Run `node examples/scroll-demo/scripts/serve` and open
`http://127.0.0.1:8079/` (`--port PORT` selects another port). The server resolves
fonts and photos from the pinned `lib-ui` Git cache using
`scripts/dependency-root.mjs`, not a sibling checkout or a local `ui` source tree.
It uses the same bundled fonts, photos, paragraphs, section variants, and dimensions.
Select content visibility or
fully mounted mode. The browser fixture exposes `setup(count, mode)` and
`measure(steps)` for repeatable measurements; results remain in `window.result`.
`measurePaced(10000, 5000)` runs for ten seconds at the native automatic speed.

Use a 1280 × 900 viewport at device scale 2. Browser `intervals` are animation-frame
callback intervals. Native `interval` is the presentation-submission interval.
Both indicate scheduling pressure but neither proves display scanout. Browser
`sync` measures only setting/reading scroll offsets and **must not** be compared to
native layout/paint CPU time. The fixture keeps all DOM nodes, even in content
visibility mode, whereas native virtualization bounds mounted nodes.
