# platform-window

Native windows, input and frame pacing for Silk UIs: phase 5 of the GPUI-style drawing
layer. It opens windows, delivers keyboard, pointer, IME, menu and dialog events, paces
frames by the display, and hands out the native objects a `gpu-webgpu` surface is created
from. It draws nothing itself.

| Backend | Module | State |
| --- | --- | --- |
| macOS (AppKit, `CAMetalLayer`, `CADisplayLink`, `NSTextInputClient`) | `macos` | First backend |
| Headless, for tests | `headless` | Complete |
| Windows (Win32, IMM or TSF) | | Next, same interface |
| Linux (Wayland with text-input-v3, then X11) | | Next, same interface |
| Browser canvas | | Next, same interface |

`native.NativePlatform` names the backend for the compilation target. Until a target has
its own backend it is `HeadlessPlatform`.

## The model

```silk,ignore
import window.native { NativePlatform }
import window.platform { Platform }
import window.event { Event }
import window.types { Wait, WindowOptions }

let mut platform = run NativePlatform.start()
let window = run platform.openWindow(&WindowOptions.make("Hello", 800.0, 600.0))
while true {
  match move run platform.nextEvent(Wait.Forever) {
    Option<Event>.Some { value } => {
      match &value {
        Event.Resized { window, size, scaleFactor } => { resizeSurface(size, scaleFactor) }
        Event.RequestFrame { window, targetTime } => { draw(targetTime) }
        Event.MouseMoved { window, position, modifiers } => { platform.requestFrame(window) }
        Event.QuitRequested => { break }
        _ => {}
      }
    }
    _ => {}
  }
}
```

- **One interface, static dispatch.** `platform.Platform` is a Silk interface, and Silk has
  no runtime dispatch, so code that should run on every backend is generic over
  `P: Platform`. Windows are named by `WindowId`, so one value owns all native state.
- **The app owns the loop.** `nextEvent(wait)` returns the next event or `None` when the wait
  ends. There are no callbacks into Silk.
- **Frames are events, and only come when asked.** `requestFrame(window)` asks for one
  `RequestFrame`, delivered at the display's next refresh; requests in between coalesce.
  Opening, showing, resizing and a scale change deliver a frame on their own. An idle window
  costs nothing, and an animation requests again from each frame. `targetTime` is when the
  frame reaches the display.
- **Logical points.** Positions and sizes are points with the origin at the top left of the
  content area. The surface is `contentSize * scaleFactor` device pixels.
- **Text input** arrives as `TextInput` for committed text (typed characters or an input
  method's commit) and `ImePreedit` for composition. `KeyDown.imeHandled` marks keys the input
  method consumed. `setIme` turns the input method on for a text field and tells it where the
  caret is, so the candidate window follows it.
- **Menus and dialogs** never block. A `menu.MenuBar` is built once and installed with
  `setMenuBar`; choosing an item delivers `MenuAction`. File dialogs return a `DialogId` at
  once and deliver `DialogClosed` with the chosen paths.

## How the macOS backend works

`native/macos/bridge.m` is the Objective-C side, behind the C ABI in `bridge.h`; `src/macos.silk`
decodes its events. Each window is an `NSWindow` whose content view is layer-backed by a
`CAMetalLayer` (`RawSurface.MetalLayer`).

AppKit runs loops of its own: during a live resize, while a menu is open, while a window is
dragged. A pull-model API (like GLFW's) gets no control back until they end, so the window
freezes during a resize. Here AppKit instead runs on a second stack of the main thread. When
an event is queued, wherever AppKit is, the bridge switches back to Silk's stack, and
`nextEvent` returns it. Silk handles it, draws if it was a frame, and calls `nextEvent` again,
which resumes AppKit where it stopped. So a resize delivers `Resized` and `RequestFrame` from
inside `setFrameSize:` and the new frame is drawn before AppKit shows the new size. The switch
saves and restores the callee-saved registers (arm64 and x86-64) and costs nanoseconds; no
second thread is involved, so every AppKit call stays on the main thread.

Two rules follow. Closing a window hides it at once and releases it after AppKit's current
dispatch returns. `startWindowDrag` runs AppKit's drag loop on the caller's stack, so events
queue until the drag ends.

`SILK_WINDOW_FIBER=0` turns the second stack off and pumps AppKit on the caller's stack, for
diagnosing problems. Live resizing then shows stale frames.

Frames are paced by the view's `CADisplayLink` (macOS 14+), which runs on the main run loop
in every mode, including during a live resize, and is paused while no frame is requested.
`CVDisplayLink`, which the design doc names, is deprecated and calls back on another thread.

## Build and test

Unit tests run anywhere, on the headless backend:

```sh
python3 scripts/check --package platform-window
```

On macOS 14+ with the Xcode or Command Line Tools SDK:

```sh
python3 platform/window/scripts/macos smoke   # real window: frames, resize, IME, keys, clipboard
python3 platform/window/scripts/macos demo    # WebGPU demo for the checks below
```

`silk.toml` compiles the AppKit bridge (`native/macos/bridge.m`) and links the `Cocoa`,
`QuartzCore` and `UniformTypeIdentifiers` frameworks on macOS. Both reach every program that
depends on the package, so a program using the macOS backend needs no `[native]` section.

The demo is the manual part of the exit test: drag a window edge and watch frames keep
coming; move the window between a Retina and a non-Retina display; leave it idle and see that
no frames are logged; type with the Japanese input method and watch the preedit and commit
lines, with the candidate window at the mouse; use File > Open… and File > Save….

The key tables in `src/keys.silk` and `native/macos/keys.h` are generated by
`scripts/generate-keys`; CI checks they are current.

## Not yet

- A cross-thread waker for `nextEvent`.
- File drag and drop, context menus, accessibility, and custom title bar hit testing beyond
  `startWindowDrag`.
- Surrounding-text queries for the input method (reconversion); the input method sees the
  composition only.
