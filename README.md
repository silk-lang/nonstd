# nonstd

Silk libraries that live outside the standard library: fonts, text, CSS, images and GPUs. They
are grouped by area, and every package is a member of one workspace that pins Silk
`0.1.0-dev.42+870af07163cd` (`toolchains.lock.json`). Nothing here is stable yet.

## Libraries

| Path | Package | What it is |
| --- | --- | --- |
| [`font/types`](font/types) | `font-types` | The scalar types OpenType tables are built from |
| [`font/parse`](font/parse) | `font-parse` | Font file parsing and a font model (outlines, metrics, charmaps); a port of read-fonts and skrifa |
| [`font/shape`](font/shape) | `font-shape` | Text shaping; a port of harfrust |
| [`text/ucd`](text/ucd) | `text-ucd` | Unicode 18 properties, bidi, line breaking and segmentation |
| [`text/xml`](text/xml) | `text-xml` | A namespace-aware, non-validating XML 1.0 parser |
| [`css/style`](css/style) | `css-style` | CSS parsing, selectors and the cascade |
| [`css/layout`](css/layout) | `css-layout` | Block, inline, flex and grid layout |
| [`images/svg`](images/svg) | `images-svg` | An SVG renderer written from the specifications |
| [`images/svg/vector`](images/svg/vector) | `images-svg-vector` | A pure-Silk 2D rasterizer |
| [`images/svg/gpu_scene`](images/svg/gpu_scene) | `images-svg-gpu-scene` | Draws vector scenes on WebGPU, matching the CPU output |
| [`gpu/webgpu`](gpu/webgpu) | `gpu-webgpu` | WebGPU through Dawn natively and `navigator.gpu` in browsers |
| [`gpu/metal`](gpu/metal) | `gpu-metal` | Metal bindings; a port of metal-rs |
| [`packages/cli`](packages/cli) | `cli` | Declarative command-line parsing, planned during compilation |

Each library's README lists its helper packages (command-line tools, benchmarks, test runners).
Package names follow their paths, with hyphens. `text/ucd`, `text/xml` and `packages/cli` are
headed for the standard library.

Programs that use `cli` are in [`examples`](examples).

### SVG in a macOS window

[`examples/svg-window`](examples/svg-window) uses the SVG renderer and WebGPU to
display the bundled landscape in a native GLFW/Metal window:

```sh
brew install glfw pkg-config
examples/svg-window/run
examples/svg-window/run examples/svg-window/text.svg
examples/svg-window/run /absolute/path/to/drawing.svg
examples/svg-window/run --release --build-only
```

Requires Apple Silicon, macOS 26 or newer, Xcode's macOS SDK, and Python 3.12+
on `PATH`. The launcher uses the workspace's pinned Silk, LLVM and Dawn installers
and caches its executable under `.cache/build/svg-window/`.

SVG parsing and rasterization run on the CPU once at twice the intrinsic size
(up to the renderer's 16-million-pixel limit). WebGPU uploads the premultiplied
RGBA image once and presents it on Metal. Resizing fits the image without stretching;
it does not rerasterize. Transparent pixels composite over a dark background.
The window sleeps between events and waits while minimized. Escape or the close
button exits. External SVG resources are limited to `data:` URLs; relative files
and network resources are not loaded.

## Working in the workspace

To build every package supported by the host, including GPU executables and their native prerequisites:

```sh
scripts/build
scripts/build --release
```

On Windows x86-64, use Python 3.12+ and LLVM 22. For WebGPU, run from an x64
Visual Studio **2026** developer PowerShell with the C++ tools and Windows SDK
installed, and install the current x64 Microsoft Visual C++ Redistributable.
The pinned Dawn archive requires the newer C++ libraries; Visual Studio 2022
alone is insufficient. No administrator rights or symlink privileges are needed
for the repository's build scripts.

```powershell
$env:PYTHONUTF8 = '1'
# Optional: use an existing LLVM 22 installation instead of downloading it.
$env:SILK_CLANG = 'C:\Program Files\LLVM\bin\clang.exe'
python scripts/build
git submodule update --init --recursive
python scripts/check
python scripts/check-native-tools
```

The build installs checksum-pinned Silk, Dawn, GLFW and DXC into `.cache/`, and
places required GPU DLLs beside the executables. Native Windows artifacts end in
`.exe`. Use `python scripts/build --no-gpu` for the libraries and CPU tools without
the Visual Studio/SDK prerequisites. `python scripts/check` runs all 19 package
unit-test roots and writes per-package logs to `build/test-results/`.

Fonts, text, CSS, SVG, vector rendering, CLI parsing and WebGPU support Windows.
Metal and its two examples remain macOS-only and are explicitly skipped on other
hosts. SVG discovers Windows fonts through `SystemRoot`; native CLI paths accept
drive paths and backslashes. Filesystem behavior follows Silk's NTFS support.
The Windows CI workflow builds all 42 supported members and runs unit tests,
WebGPU ABI/runtime/pixel checks, CPU/GPU scene comparisons and XML conformance.

On macOS, the full build requires Apple Silicon macOS 26+, Xcode/macOS SDK, Python 3.12+, curl,
make, and GLFW 3.4+ with pkg-config (or `GLFW_PREFIX`). It installs checksum-pinned
Silk and Dawn binaries into `.cache/` and discovers LLVM 22, or installs the pinned LLVM
distribution if necessary. Homebrew users can provide prerequisites with
`brew install llvm glfw pkg-config`. Apple's linker from the active Xcode toolchain links
the macOS executables; a separate LLD installation is not required.

The command builds all workspace members without running examples or tests. It prepares the
Metal bridge and example archives, and uses the WebGPU helpers to link Dawn, callbacks, GLFW,
and benchmark support. C/Rust benchmark comparison programs are built only by their area-specific
benchmark script. Metal and the SVG window example are included only on macOS;
the other packages build on supported Windows and Linux hosts as well.

Ordinary artifacts go into `build/` at the root. WebGPU-linked executables use the existing
staged builds under `.cache/build/<package>/build/llvm/<target>/<debug|release>/`; their paths
are printed during the build. No host-specific paths are written into tracked manifests.

Plain `silk build --workspace` does not run native preparation and cannot supply WebGPU's
link configuration. Use `scripts/build` for the complete workspace, or plain Silk commands
for individual pure-Silk packages. Commands run from the root unless a README says otherwise:

```sh
silk build --package images-svg-cli
silk test --manifest-path packages/cli/silk.toml --root src/tests.silk
silk run --manifest-path examples/greet/silk.toml -- --name Julia --times 2
```

Each area has its own gate script and CI workflow, for example
`images/svg/scripts/check`, `gpu/webgpu/scripts/check` and `css/layout/scripts/check`.

To add a package, run `silk init <area>/<name> --lib` from the root. It is added to `members` in
`silk.toml`.
