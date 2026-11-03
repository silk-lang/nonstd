# ui-inspect-server

The inspector protocol for [ui-tree](../../tree): a running Silk UI answers JSON requests on a
local socket, so a person, a script or an agent can snapshot it, look at any node the way
devtools does, take screenshots and drive it with input. It sits on top of the inspector core
in [ui-inspect](..). The CLI that talks to it is [ui-inspect-cli](../cli), and
[ui-inspect-mcp](../mcp) serves it to agents as MCP tools. The `client` module (connect, send a
request, read the reply) and the MCP bridge (`mcp`) live here too, so both share them.

## Turning it on

It is off unless both hold:

- the app is a debug build (`optimization = "none"`; `InspectorOptions.releaseBuilds` lifts this
  for tests), and
- `SILK_UI_INSPECT` is set:
  - `1`: the Unix socket `silk-ui-inspect.sock` in the working directory (TCP port 7357 on
    Windows, where std has no Unix sockets)
  - `tcp:<port>`: TCP on 127.0.0.1 only (`tcp:0` lets the system choose; the port is printed)
  - anything else: the path of a Unix socket

When it starts it prints `ui-inspect: listening on ...` to stderr. A socket file left by a crash
is removed when nothing answers on it.

## In the app's frame loop

The server is pulled, like platform/window: it never blocks and never calls into the app.

```silk
let mut inspector = run Inspector.start(InspectorOptions.make())
let wait = match inspector.pollInterval() {          // wake up to serve requests while idle
  Option<f64>.Some { value } => Wait.Seconds { seconds: value }
  Option<f64>.None => Wait.Forever
}
while true {
  let next = run platform.nextEvent(wait)
  if run inspector.poll(&mut tree) {                 // a request dispatched input or highlighted
    run tree.takeEvents(&mut records)                // answer the records as for window input
    ...
    platform.requestFrame(window)
  }
  ...
  run tree.frame(input)
  // upload tree.pendingUploads() to the GPU, then:
  run inspector.afterFrame(&tree)                    // before the uploads are cleared
  run renderer.draw(..., inspector.scene(&tree), ...) // the frame, with the highlight on top
}
run inspector.close()
```

After a request dispatches input, the next request waits until the app has drawn a frame
(`afterFrame`), so every request sees the app's answer to the one before. `ui/tree/demo` is the
worked example.

## Protocol

One request per connection: the client writes one JSON object and a newline, the server writes
one JSON object and a newline and closes the connection. (std's `accept` only lends a
connection to a callback, so a connection cannot stay open across frames yet; a later std
change can keep it open without changing the messages.)

Requests have a `cmd` and an optional `id` (a number or a string) that the reply echoes.
Replies have `"ok": true` and the command's members, or `"ok": false` and an `error`.

Commands that pick a node take a target, either at the top level or in a `query` object:
`node` (the client id), `role` (the ARIA name `describe` prints: `button`, `listitem`, ...),
`name` (the accessible name), `label`, `text`, `testId`, `within` (a subtree), `exact` (whole
value, with case) and `hidden` (include hidden nodes). Text matches are trimmed,
case-insensitive substrings, as Playwright's locators. The first match in tree order wins.
Node objects in replies are `{"id", "kind", "role", "name", "testId", "x", "y", "width",
"height", "focused", "hovered"}` (CSS pixels; members are left out when empty or false).

| cmd | members | reply |
| --- | --- | --- |
| `hello` | | `protocol` (1), `commands`, `width`, `height`, `scale`, `frame`, `root`, `nodes`, `highlight` |
| `snapshot` | target (optional, a subtree), `styles` | `text`: `describe` output, `frame` |
| `query` | target, `limit` | `count`, `nodes` (node objects, tree order) |
| `inspect` | target, `patches`, `computed` | `node`, `text`: the devtools-style node view |
| `pick` | `x`, `y` | `node` (what the element picker selects), `path` (ids hit testing reaches) |
| `highlight` | `nodes` (ids) or a target (all matches); none clears it | `nodes` highlighted |
| `screenshot` | target (optional: that node alone, cropped), `highlight` (default true) | `png` (Base64), `width`, `height` (device pixels), `scale`, `node` |
| `click` | target or `x`, `y`; `count`, `modifiers` | `node`, `x`, `y` |
| `hover` | target or `x`, `y`; `modifiers` | `node`, `x`, `y` |
| `scroll` | target or `x`, `y`; `dx`, `dy` (positive scrolls down); `modifiers` | `node`, `x`, `y` |
| `press` | `key` (UI Events key), `code` (defaults to the key), `modifiers`, `times` | `key` |
| `type` | `text` (as `TextInput` records to the focused input; newlines and tabs as Enter and Tab); a target in `query` is clicked first | `typed` (characters) |
| `wait` | target, `gone`, `timeout` (ms) | `node`, or `"pending": true` when it does not hold yet |
| `stats` | | the last frame's `FrameStats`: nodes, fragments, layout counters, replayed and repainted subtrees, glyphs, primitives |

`modifiers` is a list of `shift`, `control` (or `ctrl`), `alt`, `meta`. Pointer input goes to
the point `pointOf` finds (the centre of the node's visible box, or a grid point that hit
testing reaches); a node that is hidden, scrolled out of view or covered is an error.

Screenshots are the CPU reference rendering of the tree's last frame (the same pixels the GPU
draws, within tolerance), over a transparent background.

```text
$ SILK_UI_INSPECT=1 ui-tree-demo &
$ ui-inspect-cli click --role button --name New
{"id":1,"ok":true,"node":10,"x":39.68,"y":27.5}
$ ui-inspect-cli wait --text "A new message"
$ ui-inspect-cli screenshot inbox.png
```

## Tests

```sh
silk test --manifest-path ui/inspect/server/tests/silk.toml --root src/tests.silk
python3 ui/tree/demo/scripts/demo inspect     # the CLI drives the demo in a window
```

- Every command through `Protocol.handle` over the inbox fixture: snapshot equals `describe`,
  inspect equals `inspectNode`, queries by role and name, pick, highlight and screenshots (with
  and without the overlay, one node cropped), click (the app sees the click record), Tab,
  scroll, type, wait (holds, pending, gone, timed out) and the error replies.
- Over a real Unix socket (not on Windows): hello, a click followed by a query that waits for the app's frame,
  a pending wait, bad JSON, and `close` removing the socket file.
- The MCP bridge over the same fixture (see [ui-inspect-mcp](../mcp/README.md#tests)).
- `demo inspect` (CI job `demo` in ui-inspect.yml): snapshot, click New by role and name, wait
  for the new row, highlight Archive, inspect it, screenshot to a PNG.

## Limits

- One request per connection (see above); `wait` is answered `pending` and the client asks
  again (ui-inspect-cli does, every 50 ms).
- `type` sends `TextInput` records (Enter and Tab for newlines and tabs); IME preedit is not driven.
- No event log or session recording over the wire yet; sessions are still in memory
  (ui-inspect's `Session`).
- Screenshots come from the CPU renderer, not a GPU readback.
- The highlight has no name tag over the node.
