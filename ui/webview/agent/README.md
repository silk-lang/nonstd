# ui-webview-agent

An agent that drives a [ui-webview](../README.md) page through tool calls, and a demo app
(`app/`) where a user and the agent share one browser: a chat on the left, the page on the
right. Either of them can click, type and navigate, and both see the same page.

```sh
python3 ui/webview/agent/scripts/run demo     # open the demo
python3 ui/webview/agent/scripts/run check    # scripted check: exits 0 once the agent signed the guest book
```

With `ANTHROPIC_API_KEY` set, the demo talks to Claude (`claude-opus-5-5`, or `SILK_AGENT_MODEL`).
Without it, the scripted agent answers, which only knows how to sign the demo's guest book.
Linux shows pages in Chromium (the script installs the pinned CEF runtime), macOS in WebKit,
Windows in WebView2.

## The library

Everything is plain data, so the agent runs in tests without a window or a network:

- `Agent` keeps the conversation (append-only, content blocks passed back unchanged) and turns
  what happens into `Step`s: `Call { call, body }` asks the host to post a Messages API request,
  `Send { command }` is a web view command for the page, `Say` and `Note` are chat lines, and
  `Finished` / `Failed` end a turn.
- `agent.reply(call, status, body, requests, out)` takes the HTTP answer, `agent.observe(event,
  out)` takes the page's events (snapshots, loads, unsupported commands) and answers the tool
  calls waiting on them, and `agent.stop(out)` gives every pending call an error result.
- `tools.silk` lists the browser tools (`browser_snapshot`, `browser_navigate`, `browser_click`,
  `browser_type`, `browser_press_key`, `browser_scroll`, `browser_back`, `browser_evaluate`) and
  maps each call to a `webview.command.Command`. Refs come from the page's snapshot outline.
- `ClaudeLink` posts requests on a thread and wakes the window when the answer is in. The
  request uses adaptive thinking, `effort: "medium"`, prompt caching, and server-side model
  fallbacks (`fallbacks: "default"`), so an overloaded model answers through another one.
- `script.respond(body)` is the scripted brain: it reads the same request JSON Claude would get
  and answers with the same response JSON, so the check exercises the whole path but the
  network.

Tests: `cd ui/webview/agent && silk test --root src/tests.silk`.
