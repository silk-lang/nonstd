# nonstd

The retained Silk application and data workspace: SQLite, CRDTs, example applications and
Silk Studio. Reusable libraries now live in six independently published repositories:

| Repository | Contents |
| --- | --- |
| [lib-native](https://github.com/silk-lang/lib-native) | GPU bindings, native windows and browser platform payloads |
| [lib-graphics](https://github.com/silk-lang/lib-graphics) | Geometry, codecs, vector rendering, scenes, GPU renderers and editor documents |
| [lib-fonts](https://github.com/silk-lang/lib-fonts) | OpenType parsing, shaping, outlines, collections and rasterization |
| [lib-css](https://github.com/silk-lang/lib-css) | Style and layout |
| [lib-svg](https://github.com/silk-lang/lib-svg) | SVG parsing, display lists, CPU/GPU rendering and tools |
| [lib-ui](https://github.com/silk-lang/lib-ui) | Retained trees, application framework, components, inspection and shared assets |

XML uses the standard library's `silk.xml`; Unicode and command-line parsing use `silk.text`
and `silk.cli`. This repository does not retain shadow copies of extracted libraries.
Nothing here is stable yet.

## Run an application locally

Run these commands from the **nonstd repository root**, not from an application's
directory. Notes, Studio, Scroll Lab, Showcase and Graphics Demo live here;
the smaller UI library demos live in [lib-ui](https://github.com/silk-lang/lib-ui#run-a-demo-locally).
You do not need sibling library checkouts or a workspace-wide build to launch an app.

Install the [Silk launcher](https://silklang.org/) first if `silk` is not on `PATH`.
`silk use` below installs the compiler pinned by this checkout's `silk.toml`;
`silk update self` only updates the launcher.

### macOS

Requires Apple Silicon macOS 26+, Node.js 22+, Xcode with the macOS SDK, and LLVM 22.
Apple's `/usr/bin/clang` is not LLVM 22. With Homebrew LLVM 22 installed at its usual path:

```sh
silk use
export SILK_CLANG=/opt/homebrew/opt/llvm/bin/clang
export SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"
"$SILK_CLANG" --version # must report clang 22
node examples/notes/scripts/notes
```

If LLVM 22 is installed elsewhere, change `SILK_CLANG` to its absolute executable path.
Keep these exports in the same terminal in which you run the app.

### Linux

Use Node.js 22+, LLVM 22, a graphical desktop, and the X11, xkbcommon, Wayland and
wayland-protocols development packages. On Debian/Ubuntu these are `libx11-dev`,
`libxkbcommon-dev`, `libwayland-dev` and `wayland-protocols`.

```sh
silk use
export SILK_CLANG="$(command -v clang-22)"
"$SILK_CLANG" --version
node examples/notes/scripts/notes
```

For Windows, complete [Windows preparation](#windows), then run
`node examples/notes/scripts/notes` in the same developer PowerShell.

### Choose an app

Each launcher builds just the selected application and opens its window. The first build
downloads the manifest-pinned dependencies and prepares native libraries through Silk hooks;
it can take longer than subsequent builds. Closing the window returns to the shell.

| Application | Command from this repository root |
| --- | --- |
| [Notes](examples/notes) | `node examples/notes/scripts/notes` |
| [Studio](examples/studio) | `node examples/studio/scripts/studio` |
| [Scroll Lab](examples/scroll-demo) | `node examples/scroll-demo/scripts/run` |
| [Showcase](examples/showcase) | `node examples/showcase/scripts/app` |
| [Graphics Demo](examples/graphics-demo) | `node examples/graphics-demo/scripts/app` |

For Notes in a browser, run `node examples/browser serve examples/notes/browser`, then
open <http://127.0.0.1:8050/> in Chrome/Edge with WebGPU and JSPI support (137+).
Keep the server running; Ctrl+C stops it. Serving an app does not require Playwright.

Do **not** run `scripts/setup-ci.mjs` for ordinary local startup: it provisions hosted
CI and cannot configure your parent shell. Commands containing `check` or `test` below
are automated verification, not interactive launch commands. Most app directories contain
library packages; use the launchers above rather than `silk run` on those directories.

## Dependencies and layers

Local dependencies stay within `db`, `crdt` and `examples`. [`layers.toml`](layers.toml)
assigns the data layer below applications, and records excluded CRDT packages. The sync,
SQLite store, server and CRDT applications remain outside the root workspace: Windows
sockets require [silk-lang/silk#2769](https://github.com/silk-lang/silk/issues/2769), and
Windows store/server setup is not enabled. Their Linux/macOS CI checks remain separate.

Extracted packages use canonical inline Git entries with an exact 40-character commit:
`{ git = "https://github.com/silk-lang/lib-NAME.git", rev = "…", path = "…", package = "…" }`.
Neither sibling paths nor Git dependencies on nonstd are supported. Silk resolves source and
runtime assets under `$SILK_HOME/git/<revision>` (default `~/.silk/git/<revision>`);
`node scripts/dependency-root.mjs lib-ui` prints the pinned payload directory after fetching.

Each library repository keeps its packages under `modules/`; dependency `path` entries are
relative to that repository, such as `modules/tree` in lib-ui. Package names are unchanged.
Browser URL prefixes such as `/ui/` and `/native/` remain distinct and map to each repository's
`modules/` directory rather than sharing one HTTP namespace.

Upgrade pins from the bottom up: native, graphics, CSS/fonts, SVG, then UI, and finally all
retained callers here. Every direct and transitive reference to a repository must agree on its
revision. Silk rejects duplicate named packages from separate physical checkouts.
`node scripts/check-layers` checks workspace membership, exclusions, local layer boundaries,
canonical Git entries, package names and the complete reachable dependency graph. Fetch first:

```sh
silk check --manifest-path examples/graphics-demo/app/silk.toml
silk check --workspace
node scripts/check-layers
```

**Cold-cache limitation:** warm dependencies with the single-manifest check above before
workspace checks or parallel builds that share `SILK_HOME`. `silk check --workspace` itself
runs package checks in parallel. The current Silk Git checkout implementation can race while
populating one cache directory, reporting missing commits or Git files even when the pin is
valid. Do not work around this with changed pins or retries.

Silk **0.1.0-dev.63+657e3c900f65** fixes Windows Git command paths and the launcher's
`SILK_HOME` representation ([silk#3025](https://github.com/silk-lang/silk/issues/3025)).
Repository runners use `silk` on every platform (`SILK` overrides the executable); no direct
`silkc.exe` bypass or relaxed Git NTFS protection is required. Windows CI resolves the pinned
Git graph from a fresh runner through the launcher before building the workspace.

`node scripts/check-format.mjs` checks authored Silk sources and manifests. Generated browser
exports retain the pinned lib-native generator's bytes and are checked separately by application
browser tooling.

## Packages

`node scripts/readme-index` regenerates the index below; CI checks it with `--check`.
All retained packages are indexed, including the deliberate exclusions in `layers.toml`.

<!-- package-index:begin (generated by scripts/readme-index) -->

### data

| Path | Package | Purpose |
| --- | --- | --- |
| [`crdt/bench`](crdt/bench) | `crdt-bench` |  |
| [`crdt/btree`](crdt/btree) | `crdt-btree` | A persistent copy-on-write B+ tree with summaries and seeks; versions share nodes |
| [`crdt/core`](crdt/core) | `crdt-core` | CRDT documents: causal delta graph, rich text, add-wins maps, byte encoding and the Store service |
| [`crdt/server`](crdt/server) | `crdt-server` | The CRDT sync server executable: TCP on localhost, documents in SQLite (excluded from the root workspace; see layers.toml) |
| [`crdt/store-sqlite`](crdt/store-sqlite) | `crdt-store-sqlite` | A crdt-core Store kept in SQLite through db/sqlite (excluded from the root workspace; see layers.toml) |
| [`crdt/sync`](crdt/sync) | `crdt-sync` | CRDT sync in one exchange: transports, clients, memory and stored servers, TCP (excluded from the root workspace; see layers.toml) |
| [`db/sqlite`](db/sqlite) | `db-sqlite` | SQLite bindings with prepared statements and transactions, built from the pinned amalgamation |

### examples

| Path | Package | Purpose |
| --- | --- | --- |
| [`examples/crdt-demo`](examples/crdt-demo) | `crdt-demo` | Two people editing one rich-text document through an in-process sync server (excluded from the root workspace; see layers.toml) |
| [`examples/crdt-demo/app`](examples/crdt-demo/app) | `crdt-demo-app` |  (excluded from the root workspace; see layers.toml) |
| [`examples/crdt-demo/tests`](examples/crdt-demo/tests) | `crdt-demo-tests` |  (excluded from the root workspace; see layers.toml) |
| [`examples/crdt-showcase`](examples/crdt-showcase) | `crdt-showcase` | Six scripted people writing one rich-text document at once, drawn live (excluded from the root workspace; see layers.toml) |
| [`examples/crdt-showcase/record`](examples/crdt-showcase/record) | `crdt-showcase-record` |  (excluded from the root workspace; see layers.toml) |
| [`examples/graphics-demo`](examples/graphics-demo) | `graphics-demo` | The UI drawing layer's integration demo, natively and in the browser |
| [`examples/graphics-demo/app`](examples/graphics-demo/app) | `graphics-demo-app` |  |
| [`examples/graphics-demo/browser`](examples/graphics-demo/browser) | `graphics-demo-browser` |  |
| [`examples/graphics-demo/host`](examples/graphics-demo/host) | `graphics-demo-host` | The shared native host that draws a UI scene in a platform window |
| [`examples/graphics-demo/screenshot`](examples/graphics-demo/screenshot) | `graphics-demo-screenshot` |  |
| [`examples/graphics-demo/tests`](examples/graphics-demo/tests) | `graphics-demo-tests` |  |
| [`examples/notes`](examples/notes) | `ui-notes` | The example notes app of the UI stack |
| [`examples/notes/app`](examples/notes/app) | `ui-notes-app` |  |
| [`examples/notes/browser`](examples/notes/browser) | `ui-notes-browser` |  |
| [`examples/notes/tests`](examples/notes/tests) | `ui-notes-tests` |  |
| [`examples/scroll-demo`](examples/scroll-demo) | `silk-scroll-demo` | Fieldnotes Scroll Lab, a native scrolling stress demo built on ui-app |
| [`examples/scroll-demo/document`](examples/scroll-demo/document) | `silk-scroll-document` |  |
| [`examples/scroll-demo/wasm`](examples/scroll-demo/wasm) | `silk-scroll-demo-wasm` |  |
| [`examples/showcase`](examples/showcase) | `ui-showcase` | Silk Loom, a showcase of the drawing layer and the UI stack |
| [`examples/showcase/app`](examples/showcase/app) | `ui-showcase-app` |  |
| [`examples/showcase/record`](examples/showcase/record) | `ui-showcase-record` |  |
| [`examples/studio`](examples/studio) | `silk-studio-native` | Silk Studio, a design editor on the UI stack |
| [`examples/studio/app`](examples/studio/app) | `silk-studio-native-app` |  |
| [`examples/studio/browser`](examples/studio/browser) | `silk-studio-browser` |  |
| [`examples/studio/tests`](examples/studio/tests) | `silk-studio-native-tests` |  |

<!-- package-index:end -->

## Working in the workspace

Use Node.js 22+, the Silk release pinned in `toolchains.lock.json`, and LLVM 22. The root lock
owns compiler bootstrap metadata; native GPU, window and browser tool pins belong to the pinned
lib-native checkout. On macOS use Apple Silicon macOS 26+ with the Xcode/macOS SDK and set
`SDKROOT` to `xcrun --sdk macosx --show-sdk-path`. Set `SILK_CLANG` to your LLVM 22 clang.

```sh
# Optional checksum-verified compiler bootstrap (requires curl and tar):
export PATH="$(node scripts/install-silk.mjs):$PATH"
export SILK_CLANG=/path/to/llvm22/bin/clang
silk check --manifest-path examples/graphics-demo/app/silk.toml # first Git fetch
silk check --workspace
silk build --workspace
silk build --workspace --release
node scripts/check             # included package unit-test roots, with per-package logs
node scripts/check-layers
node scripts/readme-index --check
node --test scripts/tests/*.test.mjs
```

`node scripts/setup-ci.mjs [--linux-gpu] [--browser]` is hosted-runner provisioning: it bootstraps
Silk, fetches dependencies serially, then invokes the pinned lib-native's `scripts/setup-ci.mjs`.
It exports tool locations through GitHub Actions environment files, not into a caller's local
shell. Linux native apps need X11, xkbcommon and Wayland development packages; window CI also
uses Xvfb and Weston. Browser CI validates installed Chromium and installs pinned Playwright
JavaScript only, without downloading a browser.

### Windows

Use an x64 Visual Studio **2026** developer PowerShell with the C++ tools and Windows SDK,
LLVM 22, Node.js 22+, and the current x64 Microsoft Visual C++ Redistributable. Visual Studio
2022 alone is insufficient for the pinned Dawn archive.

```powershell
$bin = node scripts/install-silk.mjs
$env:PATH = "$bin;$env:PATH"
$env:SILK_CLANG = 'C:\Program Files\LLVM\bin\clang.exe'
pwsh -File scripts/prepare-windows.ps1
silk build --workspace
node scripts/check
node examples/graphics-demo/scripts/app check --release
```

Preparation invokes the pinned lib-native PowerShell recipe for Dawn/GLFW/the Win32 bridge,
then builds SQLite and its shim from the manifest's SHA-256-pinned amalgamation with its original
feature defines and CRT import libraries. Each recipe preserves unrelated entries in
`$SILK_HOME/native-overrides.toml`; SQLite updates only its own `path`. Pass `-RuntimeDirectory`
to the root preparation script when a manually launched executable needs the native DLLs copied
beside it. Application launchers stage those DLLs beside their built executables automatically.
Preparation also records DLL search directories in `.cache/windows-runtime.json` for
`node scripts/check` and exports them to subsequent GitHub Actions steps.
No Python is needed by normal root CI or application launchers.

## Application and data checks

The retained workflows cover SQLite, CRDTs, graphics-demo, Notes, Scroll Lab, Showcase and Studio.
Library-only checks now run in their owning repositories. Commands run from this root:

```sh
silk test --manifest-path db/sqlite/silk.toml --root src/tests.silk
silk test --manifest-path crdt/core/silk.toml --root src/tests.silk
node crdt/bench/run 2000
node examples/graphics-demo/scripts/check
node examples/graphics-demo/scripts/app check --backend all --release
node examples/graphics-demo/scripts/browser test
node examples/notes/scripts/notes check --backend all --release
node examples/notes/scripts/devtools-check
node examples/scroll-demo/scripts/inspect-check
node examples/showcase/scripts/embed-assets --check
node examples/showcase/scripts/record --frames-only --fps 10 --seconds 7.7 --scale 1 --debug
node examples/studio/scripts/test --release
node examples/studio/scripts/studio check --backend all --release
node examples/browser test examples/studio/browser -- --size 1280,800 --click 603,723 --stored studio
```

Use each application's README for its assets, licensing, interactive launch, recording and
platform prerequisites. `--backend all` is a Linux X11/Wayland check; omit it on other native hosts.
Root test logs and summaries are written to `build/test-results/`.
