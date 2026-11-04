# ui-tree-window

## Shared native host

`host.runWindow` owns the native window, GPU surface, input adapter, accessibility
publication, inspector integration, frame requests, and presentation. It requires no
`ui-app` runtime. Implement `host.WindowClient<State, Errors, Requirements>` and pass
ordinary client state, a font collection, initial resource mutations, window options,
and an inspector. The app window package now adapts its existing runtime and custom
`WindowContent` hooks to this host.

Use `start` to create nodes with mutation batches and `pump` to consume tree events.
The default `layout` method calls `tree.frame`; clients that virtualize content must
reconcile range requests and settle another frame before it returns. `poll` collects
background work, `wakeAfter` bounds waits, and `nextDeadline` supplies timer deadlines
in seconds relative to host startup. `frame`, `scene`, and `draw` support custom GPU
composition. The host publishes accessibility geometry after client layout settles.

The [direct-tree counter](demo/src/main.silk) is a complete example with no app or
component framework dependency. From the repository root, with Python 3.11+:

    python3 ui/tree/window/demo/run
    python3 ui/tree/window/demo/run --check

The check dispatches a click and Tab through the real input path, verifies the
updated text, and compares GPU output with the CPU reference. `--debug` builds a
development binary; `--build-only` compiles without opening a window.
The default renderer and the check use a white window background. CPU snapshots
also expose `renderSceneOver` for reference rendering with an explicit clear color.

## Background images

`images.Images` queues file or HTTP(S) requests, decodes on native workers, installs
completed pixels in `UiTree`, and exposes loading/error states. Call `poll` from the
host loop while `pending()` is true. Replacement and cancellation reject stale
results. `release` cancels work and releases the installed resource. The request state
and generation checks come from portable `ui-tree.image_load` code; OS threads and
I/O stay in this native package.

`background.Background` and `Cancellation` are also available without `ui-app`.
Work and results must own transferable storage. Keep cancelled jobs until completion:
dropping an unfinished job joins the worker. Compatibility imports remain available
under `ui-app-window.background` and `ui-app-window.images`.

## Extraction validation

Validated on macOS arm64 with the pinned compiler: 31 tree tests, 11 app tests,
16 component tests, 5 inspector tests, and the native image-worker test pass.
Tree, inspector, app, and component goldens pass against current `main`. Tree tests cover crop
reuse, idle refinement, atlas eviction, and anchored popup placement.

The direct-tree counter passes its scripted input and CPU/GPU comparison. The
10,000-section scroll demo passes both its normal and growing-content GPU checks.
Core tree and app code check for wasm32. CPU scroll measurements are recorded in
[shared-primitives.json](../../app/scroll-demo/measurements/shared-primitives.json);
they exclude GPU work and presentation.
