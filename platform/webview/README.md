# platform-webview

Web views for Silk UIs: a real browser page inside an app built on `ui/tree` and
`platform/window`, that the person and an agent can both use and see. This package is the
contract every engine implements, the agent control they share, and a headless backend for tests.
The engine backends land in steps on the `feature/webview` branch (see [Plan](#plan)).

| Backend | Engine | How the page shows | State |
| --- | --- | --- | --- |
| `HeadlessWebViews` | none | records, for tests | Complete |
| `MacWebViews` (macOS) | WKWebView | native child view over the window | W2 (see below) |
| WebView2 (Windows) | Edge WebView2 | native child window | Planned (W5) |
| Chromium (Linux; optional on macOS and Windows) | CEF, offscreen | shared GPU texture drawn by ui_renderer | Planned (W3, W4, W6) |

## The model

```silk,ignore
import webview.lib { WebViewHost, WebViewOptions, Command, Placement, EventKind }
import ui_tree.lib { hostedPlacements }

// The UI has a hosted node showing host view 1 (ui.hosted(1, ...) in ui/app).
run views.open(1, &run WebViewOptions.make(window.value, "https://silk-lang.org"))
loop {
  // ... window events, tree frame ...
  run hostedPlacements(&tree, &mut placements)
  for each placement p: views.place(p.view, Placement { bounds: p.bounds, clip: p.clip, visible: p.visible, scale: p.scale })
  run views.takeEvents(&mut events)   // titles, URLs, loads, focus, answers
}
run views.send(1, Command.Snapshot { request: 7 })   // an agent asks what the page shows
```

- **One contract, static dispatch.** `host.WebViewHost` is a Silk interface, like
  platform-window's `Platform`: an app is generic over `H: WebViewHost`.
- **Plain data.** Views are client-chosen `u32` ids. `command.Command` goes in,
  `event.WebViewEvent` records come out of `takeEvents`. No callbacks into Silk. Commands that
  answer carry a `request` number, and their answer event carries it back.
- **The tree says where.** A `ui/tree` node of kind `Hosted` is laid out and decorated like a
  box, its content box left empty. `hostedPlacements` gives each one's bounds, the clip from
  its scrolling ancestors, whether it shows, its paint order and the scale, in the same CSS pixels
  as `Placement`. The host moves its view there after each frame (`place` is cheap when nothing
  moved).
- **Focus goes both ways.** When the page takes keyboard focus (a click into it) the backend
  queues `FocusChanged { focused: true }`, and the app focuses the hosted node; when the tree
  focuses the hosted node (Tab), the app sends `Command.Focus`.
- **Every backend runs every command.** What one cannot do (opening devtools, say) queues
  `Unsupported` naming the command rather than doing nothing. `capabilities()` says what goes
  beyond the shared set: drawing Silk UI over the page (offscreen backends only), network
  interception, the Chrome DevTools Protocol.

## Agent control

Agents drive pages through the same commands on every backend: `Snapshot`, `ClickElement`,
`FillElement`, `ClickAt`, `Scroll`, `TypeText`, `PressKey`, `Screenshot`, `Evaluate`, plus
navigation. It is our own small operation set, not CDP: CDP is only how the WebView2 and
Chromium backends implement parts of it.

`agent/agent.js` is the page side, shared by every backend and embedded as
`generated_agent.silk` (`scripts/embed-agent`; CI fails when it is stale). Backends inject it at
document start. `snapshot()` writes an outline of what the page shows, with refs on what an
agent can act on:

```
- document "Agent fixture" [url=about:blank]
  - main
    - heading "Welcome back" [level=1]
    - form
      - textbox "Email" [ref=e3]: "old@example.com"
      - checkbox "Remember me" [checked] [ref=e5]
      - button "Sign in" [ref=e7]
    - iframe
      - button "Inside frame" [ref=e10]
```

`locate(ref)` scrolls the element into view and returns its center in the top viewport (through
same-origin frames and open shadow roots), and `focusForFill(ref)` focuses it and selects its
value. The backend then clicks or types there with real input (synthesized native events, or
CDP's input domain), so pages see trusted events, the same as from a person. `agent.silk` builds
the calls (only for well-formed refs, so a ref can never inject script) and reads their JSON
results.

The one known gap: WebKit cannot intercept requests or read every response body.

## The WebKit backend (macOS)

`macos.MacWebViews` (also `native.NativeWebViews` on macOS) runs each view as a `WKWebView` in
platform-window's `MacPlatform` window: open the window first and pass its `WindowId.value` as
`WebViewOptions.window`. The bridge is `native/macos/bridge.m`; `silk.toml` compiles it and links
WebKit, and a program using it also depends on platform-window (which it needs for the window).

- **Placement.** The web view sits in a clip view, both children of the window's content view,
  so the page draws over the Silk UI. `place` moves the clip view to the visible part of the
  node (bounds intersected with the clip) and the web view to the node's bounds inside it, so a
  node scrolled half out of its scroll box shows only its visible half. Hidden or fully clipped
  views are hidden and give up keyboard focus.
- **Waking the loop.** Every event the bridge queues wakes platform-window's `nextEvent`
  (`silk_macos_wake`, from the main queue), which may return `None`; drain `takeEvents` after
  every turn.
- **Focus.** The page reports `FocusChanged` when the web view becomes or stops being AppKit's
  first responder; a click on the Silk UI takes focus back to the window's view.
- **Agent commands.** The agent script runs in a content world of its own (`silk-agent`), which
  pages cannot see or change. Clicks, typing and keys are synthesized `NSEvent`s sent to the web
  view, as WebKit's test runner does, so pages get trusted input. `ActionResult` follows once the
  input has reached the page.
- **Evaluate** runs the script with indirect `eval` in the page's world (its completion value,
  awaited when a promise, as JSON). A page whose Content Security Policy forbids `eval` answers
  `ok` false.
- **Console** messages come from a script that wraps `console.*` and reports errors and unhandled
  rejections.
- **Profiles.** An empty `profile` is a non-persistent data store; a name maps to a persistent
  `WKWebsiteDataStore` identifier derived from it (macOS 14).
- **Not available**: `OpenDevTools` is `Unsupported` (WebKit has no API to open Web Inspector;
  with `inspectable` on, Safari's Develop menu attaches), and WebKit cannot intercept requests.

`python3 platform/webview/scripts/macos smoke` drives it in a real window (CI job `macos`).
Manual checks on a Mac: scroll a page with the trackpad, type with the Japanese input method in a
page field, click between the page and the Silk UI and watch focus move, open the view in
Safari's Develop menu.

## Build and test

```sh
silkc test --root src/tests.silk             # from platform/webview: headless backend and agent helpers
python3 platform/webview/scripts/embed-agent  # after editing agent/agent.js
node platform/webview/agent/test.mjs          # agent.js in Chromium (an existing Playwright; PLAYWRIGHT_MODULE)
node platform/webview/agent/test.mjs --update # rewrite agent/fixture.snapshot
```

## Plan

Design and the reasoning behind it: the "Embedding a browser in Silk UI apps" doc. Steps, each a
PR into `feature/webview`:

| Step | What | Depends on |
| --- | --- | --- |
| W1 | This contract: hosted nodes in ui/tree, `ui.hosted` in ui/app, commands, events, host interface, headless backend, agent script | |
| W2 | macOS backend: WKWebView child views, placement and clipping per frame, focus handoff, agent commands through the script and synthesized NSEvents, a way for the webview to wake platform-window's `nextEvent` | W1 |
| W3 | Offscreen plumbing: Dawn `SharedTextureMemory` bindings in gpu/webgpu (dmabuf first, then IOSurface and D3D shared handles) and an external texture sprite in ui_scene and ui_renderer; a hosted node can draw a texture | |
| W4 | Chromium backend on Linux: CEF C API bridge, offscreen frames into W3's sprite, input and IME forwarding, CDP for agent commands, packaging the helper processes | W1, W3 |
| W5 | Windows backend: WebView2 child windows, same contract | W1 |
| W6 | Chromium as the optional backend on macOS and Windows, a `ui/app` web view component and an agent-and-chat demo | W2, W4, W5 |

The Chromium backend lives in its own package, so only apps that choose it download and ship CEF.
