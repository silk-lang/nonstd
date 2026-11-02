# nonstd

Silk libraries that live outside the standard library: fonts, text, CSS, images, graphics and
GPUs. They are grouped by area, and every package is a member of one workspace that pins Silk
`0.1.0-dev.44+8052ef3352b5` (`toolchains.lock.json`). Nothing here is stable yet.

## Libraries

| Path | Package | What it is |
| --- | --- | --- |
| [`font/types`](font/types) | `font-types` | The scalar types OpenType tables are built from |
| [`font/parse`](font/parse) | `font-parse` | Font file parsing and a font model (outlines, metrics, charmaps); a port of read-fonts and skrifa |
| [`font/shape`](font/shape) | `font-shape` | Text shaping; a port of harfrust |
| [`font/outline`](font/outline) | `font-outline` | Glyph outlines as path commands or `vector` paths |
| [`font/raster`](font/raster) | `font-raster` | The UI glyph cache: unhinted glyphs in atlas tiles, shaped lines, text gamma |
| [`text/xml`](text/xml) | `text-xml` | A namespace-aware, non-validating XML 1.0 parser |
| [`css/style`](css/style) | `css-style` | CSS parsing, selectors and the cascade |
| [`css/layout`](css/layout) | `css-layout` | Block, inline, flex and grid layout |
| [`images/svg`](images/svg) | `images-svg` | An SVG renderer written from the specifications |
| [`images/codec`](images/codec) | `images-codec` | PNG and JPEG decoding, PNG encoding, premultiplied RGBA images |
| [`graphics/vector`](graphics/vector) | `graphics-vector` | A pure-Silk 2D rasterizer |
| [`graphics/gpu_scene`](graphics/gpu_scene) | `graphics-gpu-scene` | Draws vector scenes on WebGPU, matching the CPU output |
| [`graphics/atlas`](graphics/atlas) | `graphics-atlas` | A texture atlas allocator for glyphs, icons and images, with eviction by last use |
| [`graphics/ui_scene`](graphics/ui_scene) | `graphics-ui-scene` | UI frame primitives (quads, shadows, sprites, paths) ordered and batched for a GPU, with a CPU reference renderer |
| [`graphics/sprites`](graphics/sprites) | `graphics-sprites` | SVG icons and decoded images as atlas tiles for the UI renderer |
| [`gpu/webgpu`](gpu/webgpu) | `gpu-webgpu` | WebGPU through Dawn natively and `navigator.gpu` in browsers |
| [`gpu/metal`](gpu/metal) | `gpu-metal` | Metal bindings; a port of metal-rs |
| [`platform/window`](platform/window) | `platform-window` | Native windows, input, IME, menus, dialogs and display-paced frames (macOS first) |
| [`packages/cli`](packages/cli) | `cli` | Declarative command-line parsing, planned during compilation |

Each library's README lists its helper packages (command-line tools, benchmarks, test runners).
Package names follow their paths, with hyphens. `text/xml` and `packages/cli` are
headed for the standard library. The Unicode library that lived in `text/ucd` is now part of
the standard library as `silk.text`.

Programs that use `cli` are in [`examples`](examples).

## Working in the workspace

Plain Silk builds the whole workspace, native parts included:

```sh
silk build --workspace
silk build --workspace --release
```

The manifests declare everything native. `gpu/webgpu/sys` pins Dawn's prebuilt release by
SHA-256 and compiles the callback shim; `gpu/metal` and `platform/window` compile their
Objective-C bridges. Their frameworks and libraries reach every program that depends on them.
The first build downloads Dawn once into `~/.silk/archives`; `silk check` downloads and compiles
nothing. Output goes into `build/` at the root.

Metal, its two examples and the AppKit smoke test and demo need macOS to do anything. On other
hosts they build as programs that report so, which keeps `silk build --workspace` complete
everywhere.

On Windows x86-64, use Python 3.12+ and LLVM 22. For WebGPU, run from an x64
Visual Studio **2026** developer PowerShell with the C++ tools and Windows SDK
installed, and install the current x64 Microsoft Visual C++ Redistributable.
The pinned Dawn archive requires the newer C++ libraries; Visual Studio 2022
alone is insufficient. Dawn's Windows archive needs one preparation step, since Silk's entry
point does not start the C runtime that Dawn's static library expects: `scripts/prepare-windows`
wraps it in a DLL and records it, and the pinned GLFW, as archive overrides in
`$SILK_HOME/native-overrides.toml`. Run it once per checkout:

```powershell
$env:PYTHONUTF8 = '1'
# Optional: use an existing LLVM 22 installation instead of downloading it.
$env:SILK_CLANG = 'C:\Program Files\LLVM\bin\clang.exe'
python scripts/prepare-windows
silk build --workspace
git submodule update --init --recursive
python scripts/check
python scripts/check-native-tools
```

The test scripts place the DLLs a GPU program loads (`nonstd_dawn.dll`, DXC) beside it.
`python scripts/check` runs all package unit-test roots and writes per-package logs to
`build/test-results/`.

Fonts, text, CSS, SVG, vector rendering, CLI parsing and WebGPU support Windows. SVG discovers
Windows fonts through `SystemRoot`; native CLI paths accept drive paths and backslashes.
Filesystem behavior follows Silk's NTFS support. The Windows CI workflow builds every member and
runs unit tests, WebGPU ABI/runtime/pixel checks, CPU/GPU scene comparisons and XML conformance.

On macOS, building requires Apple Silicon macOS 26+, the Xcode/macOS SDK, Python 3.12+ and curl
for the toolchain installers. Apple's linker from the active Xcode toolchain links the macOS
executables; a separate LLD installation is not required.

`gpu/webgpu/examples-window`, the dev-only GLFW host, is not a workspace member because it needs
GLFW 3.4 installed: build it with `gpu/webgpu/scripts/window`. C/Rust benchmark comparison
programs are built only by their area-specific benchmark script.

Commands run from the root unless a README says otherwise:

```sh
silk build --package images-svg-cli
silk test --manifest-path packages/cli/silk.toml --root src/tests.silk
silk run --manifest-path examples/greet/silk.toml -- --name Julia --times 2
```

Each area has its own gate script and CI workflow, for example
`images/svg/scripts/check`, `gpu/webgpu/scripts/check` and `css/layout/scripts/check`.

To add a package, run `silk init <area>/<name> --lib` from the root. It is added to `members` in
`silk.toml`.
