# ui-webview

Web views as a [ui-app](../app) component: a real browser page as one node of an app's view, on
any [platform-webview](../../platform/webview) backend. The app keeps a `Page` per view, puts it
on screen with `webView`, asks things of it through `WebViewRequests` in `update`, and runs it with
`WebViewsHost`, the window host ui-app-window's `runWindowHosting` takes. Everything around the
page (address bar, buttons, tabs, a status line) stays the app's own UI.

Packages:

- `ui/webview` (`ui-webview`): `page` (`Page`, `PageMessage`), `requests` (`WebViewRequests`),
  `component` (`webView`), `backend` (`WindowBackend`, for the headless and native backends) and
  `host` (`WebViewsHost`, `WebViewApp`).
- `ui/webview/chromium` (`ui-webview-chromium`): `ChromiumBackend`, the Chromium backend
  (platform-webview-chromium) with the window hooks. Only apps that pick Chromium depend on it,
  so only they build and ship CEF.
- `ui/webview/tests`: the component on the headless backend, through the real tree.

## An app with a page

```silk,ignore
pub struct Browser { page: Page, requests: WebViewRequests }
pub union Message { Back, Page { message: PageMessage } }

impl App<Message, NoCommand> for Browser {
  fn view(self: &Self, ui: &mut Ui<Message>) -> () {
    ui.button("Back", || Message.Back)
    ui.text(self.page.heading())
    webView(&mut ui, &self.page, |message| Message.Page { message: move message }, |ui| ui.grow(1.0))
  }

  fn update(self: &mut Self, message: Message, cx: &mut Context<NoCommand>) -> () {
    match move message {
      Message.Back => { cx.alloc(self.page.back(&mut self.requests)) }
      Message.Page { message } => {
        // State events update the page; answers (Snapshot, ScriptResult, Console...) come back.
        let answer = cx.alloc(self.page.update(move message, &mut self.requests))
      }
    }
  }
}

impl WebViewApp<Message> for Browser {
  fn webViewRequests(self: &mut Self) -> &mut WebViewRequests { return &mut self.requests }
  fn webViewMessage(self: &Self, view: u32, message: PageMessage) -> Message {
    return Message.Page { message: move message }
  }
}

let mut model = Browser { page: Page.make(1), requests: WebViewRequests.make() }
run model.page.open(&mut model.requests, "https://silk-lang.org")
let mut host = WebViewsHost<NativeWebViews, Browser, Message>.make(NativeWebViews.make())
run runWindowHosting(&mut runtime, &collection, resources, options, inspector, &mut host)
```

- **`Page`** is the view's state as its events leave it: `url`, `title`, `progress`, `loading`,
  `canGoBack`, `canGoForward`, `focused`, `created`, the last load `error` and `crashed`.
  `Page.update` applies state events and hands every other event back (answers to `Snapshot`,
  `Evaluate`, `ClickElement`, `FillElement`, `Screenshot`, console messages, new window and
  navigation requests, `Unsupported`). `navigate`, `back`, `forward`, `reloadOrStop` and `send`
  queue commands.
- **`webView`** is a `ui.hosted` node for the page's view, focusable, with role main and the
  page's title as its label. Focus follows the page both ways: when the page takes keyboard focus
  (a click into it) the node takes the tree's focus, and when the tree focuses the node (Tab) the
  page gets `Command.Focus`.
- **`WebViewsHost<B, A, M>`** takes the model's requests after every turn of the loop and gives
  them to backend `B` (opening a view in the app's window), turns every event of every view into
  a message with `WebViewApp.webViewMessage`, and after every frame places each open view on its
  hosted node (a view whose node is gone is hidden). An open the backend refuses comes back as
  `Crashed`, and a command it refuses as `Unsupported` with the command's request number, so
  nothing waits forever.
- **Backends.** `NativeWebViews` (WKWebView on macOS, WebView2 on Windows) and
  `HeadlessWebViews` work as they are. For Chromium, wrap it:
  `WebViewsHost<ChromiumBackend, A, M>.make(ChromiumBackend.make(run ChromiumWebViews.start(&options)))`;
  the host then forwards window input over a page to it, uploads its frames before each draw,
  shows the page's cursor and wakes the loop when CEF has work.

ui-app-window's `WindowHost` has the hooks for that: `input` (a window event before the tree),
`present` (before each draw), `cursor`, `wantsFrame` and `nextTurn`. Native child views ignore
them.

## Build and test

```sh
(cd ui/webview/tests && silkc test --root src/tests.silk)
```

`platform/webview/examples/browser` is a complete small browser built on it.
