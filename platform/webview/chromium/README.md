# platform-webview-chromium

Chromium web views for Silk UIs on Linux, macOS and Windows, through CEF (the Chromium Embedded Framework).
`ChromiumWebViews` implements platform-webview's `WebViewHost`: pages render offscreen and the
host hands each view's frames to `ui_renderer` as a surface texture, which the view's hosted node
draws with a `SurfaceSprite`. So Silk UI can draw over a page, clip it and round its corners, and
the page scrolls with the tree like any other node.

This is its own package so that only apps that choose Chromium download and ship CEF (about
1 GB unpacked). On Linux it is the only web view; on macOS and Windows it is the optional
alternative to the system web view (WKWebView, WebView2), for apps that want the same engine
everywhere.

## Using it

```silk,ignore
import chromium.lib { ChromiumWebViews, ChromiumOptions }

let mut options = run ChromiumOptions.make(runtimeDir)   // the directory scripts/install-cef prints
let mut views = run ChromiumWebViews.start(&options)     // once per process
run views.open(1, &run WebViewOptions.make(window.value, "https://silk-lang.org"))
loop {
  // a window event: send it to the page under the pointer, or the one with focus
  if !views.forward(&event) { /* the Silk UI's */ }
  // ... tree frame, then views.place(...) for each hosted placement ...
  run views.takeEvents(&mut events)                      // also does CEF's due work
  run views.present(&device, &queue, &mut renderer)      // before drawing the frame
  // views.cursor() is the cursor to show; views.hasNewFrames() asks for a frame
}
views.shutdown()
```

- **The message loop is ours.** CEF runs with an external message pump: `takeEvents` (or
  `pump`) does its due work, and when CEF schedules work from another thread the bridge wakes
  platform-window's `nextEvent` with `silk_window_wake`. `nextPump()` says how long the loop may
  sleep.
- **Frames.** By default CEF paints into memory (`on_paint`) and `present` uploads the changed
  frame into a BGRA texture: it works everywhere, software rendering and CI included. With
  `sharedTextures` on (and a GPU, and a device with `FEATURE_DMA_BUF`) the GPU process hands over
  dma-bufs (`on_accelerated_paint`) and `present` imports them through W3's
  `SharedTextureMemory` and copies them into the view's texture without a readback. Popups
  (`<select>` lists) are drawn into the same texture where Chromium puts them.
- **Input.** `forward` hit-tests window events against the placements: mouse moves, presses
  (with capture while a button is held), wheel, keys (Windows virtual key codes and X11 key codes
  from `native/keys.h`, generated from platform-window's key list), text and input method
  composition go to the right view through CEF's `send_*_event` calls. A press outside every
  view takes focus from the page.
- **Agent commands** use the Chrome DevTools Protocol inside the bridge: the shared agent script
  runs in an isolated world (`silk-agent`), ClickElement and FillElement send trusted input with
  `Input.dispatch*`, `Screenshot` is `Page.captureScreenshot` (PNG, decoded with images-codec),
  `LoadHtml` with a base URL answers the request through the `Fetch` domain.
- **Helper processes.** CEF runs renderer, GPU and utility processes from `silk-cef-helper`, a
  small C program `install-cef` builds into the runtime directory. `ChromiumOptions.helperPath`
  can name another.
- **Sandbox.** On Linux it is on by default; it needs unprivileged user namespaces or the setuid
  `chrome-sandbox`. Containers and CI turn it off (`sandbox = false`). On macOS and Windows it
  is always off for now: CEF's sandbox there needs the helper linked against CEF's sandbox
  library (and on macOS, an app bundle), which the bridge does not do yet.
- **macOS and Windows.** The bridge is the same C file. CEF loads from the runtime directory
  (`Chromium Embedded Framework.framework` on macOS, `libcef.dll` on Windows) and the helper is
  a plain executable beside it. Frames always come through memory there (shared textures are
  dma-buf, so Linux only). On Windows, Silk does not hand Clang the Windows SDK, so
  `scripts/prepare-windows` builds the bridge into `silkcef.lib` (`scripts/windows native`) and
  names it as the `win32-chromium` archive's override.
- **Without CEF's headers** (`native/cef/include` missing) `native/entry.c` builds a stand-in
  whose `start` says CEF is not installed. So apps that never open a Chromium view build on any
  machine; run `install-cef` and rebuild to get the real bridge.

## Shipping CEF

`python3 scripts/install-cef` downloads the minimal distribution for this machine (Linux x64 and
arm64, macOS arm64 and x64, Windows x64) pinned in
`toolchains.lock.json` (checked by SHA-256), copies its headers to `native/cef/include` (not
committed; the bridge compiles against them, so run it before building) and puts the runtime
directory together in `.cache/cef/<version>/<target>/runtime`: CEF's library and the files beside it,
Chromium's resources (`.pak` files, `icudtl.dat`, `locales/`) and `silk-cef-helper`. An app ships that directory and names it in
`ChromiumOptions.runtimeDir`. libcef.so loads at run time (dlopen), so programs build and start
without it, and `start` fails with `NoLibrary` (and `startError()` says why) when it is missing.

To move to a newer CEF: the CI job "Newest stable CEF" prints lock entries for the newest stable
build (`scripts/install-cef --latest`), and lock entries for the pinned version on every platform
(`--pinned`). Update `toolchains.lock.json` and the
`-DCEF_API_VERSION` in `silk.toml` to the new version's API version together; install-cef refuses
a mismatch.

## Build and test

```sh
python3 scripts/install-cef                                      # headers and runtime
silkc test --root src/tests.silk                                 # from this directory
python3 platform/webview/chromium/scripts/linux smoke            # under Xvfb; --backend wayland|all
python3 platform/webview/chromium/scripts/smoke                  # macOS and Windows
python3 platform/webview/chromium/scripts/generate-keys          # after platform-window's key list grows
```

The smoke test (`tests/smoke`, CI job `linux`) opens a window under Xvfb with the sandbox and
GPU off: a data: page loads and reports its title and console, frames arrive at the placement's
size and the UI renderer draws one through a SurfaceSprite like the CPU frame shows it (on
lavapipe), a window click and typing reach the page, Evaluate, Snapshot, ClickElement,
FillElement and Screenshot work, a malformed ref is refused, frames follow a window resize, and
the view closes. `SILK_CEF_LOG=<file>` makes CEF log verbosely there.

Not checked in CI: shared textures (lavapipe cannot import dma-bufs, and the runner has no GPU
for Chromium) and input methods. Manual checks on a Linux desktop with a GPU: run with
`sharedTextures` and `gpu` on, scroll a long page, open a `<select>`, type with an input method
(fcitx or ibus) in a page field.
