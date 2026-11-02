# graphics-demo

The integration demo of the UI drawing layer. One window draws everything phases 0 to 6 built,
with no elements or layout: positions are computed by hand in `src/demo.silk`.

- An Oklab gradient background and rounded cards with soft drop shadows and borders.
- Text through [`font/raster`](../../font/raster): two Noto Sans faces, lines shaped once by the
  line cache, glyph tiles from the glyph cache, straight and wavy underlines.
- Icons from SVG through [`graphics/sprites`](../sprites), with hover highlights in the top bar.
- An animated SVG (`assets/icons/orbit.svg`: SMIL `animate`, `animateMotion`,
  `animateTransform` and a CSS `@keyframes` halo) rasterized each frame at the frame's time.
- A chart drawn as `vector` paths through the path cache, with an animated marker.
- The image grid workstream L left for this demo: twelve PNG and JPEG photos decoded once into
  atlas tiles, in a scrolling grid clipped by a content mask, with a hover ring, a favorite
  heart badge and a grayscale toggle.
- A status line with live cache statistics (glyph and icon hits and misses, image uploads, atlas
  textures, primitives).

The same `Demo` paints into a `ui_scene.Scene` for three hosts: the CPU reference renderer, the
native window app (Dawn on Metal, D3D12 or Vulkan through [`platform/window`](../../platform/window))
and the browser (`navigator.gpu` on a canvas).

## Packages

| Path | Package | What |
| --- | --- | --- |
| `.` | `graphics-demo` | The demo: assets, text, painting, the CPU path and image comparison |
| `host` | `graphics-demo-host` | What the GPU hosts share: the renderer, atlas uploads, readback, window events |
| `app` | `graphics-demo-app` | The native window app |
| `browser` | `graphics-demo-browser` | The wasm32 app for the page in `web/` |
| `screenshot` | `graphics-demo-screenshot` | Renders one frame on the CPU to a PNG |
| `tests` | `graphics-demo-tests` | Goldens, GPU against CPU, and an animated run |

## Run

Native, in a window (the bridge for this OS is built first; see the platform/window README for
its prerequisites):

```sh
graphics/demo/scripts/app --release
```

In a browser with WebGPU, at http://127.0.0.1:8040/:

```sh
graphics/demo/scripts/browser serve
```

Move the pointer over the buttons and photos, click a photo to toggle its heart, scroll the grid
with the wheel, press `G` for grayscale and `Space` to pause the animation.

A CPU screenshot, from the repository root (the output path must be relative, as file access is
scoped to the working directory):

```sh
silk build --manifest-path silk.toml --package graphics-demo-screenshot --release
build/llvm/<target>/release/graphics-demo-screenshot build/demo.png 1024 720 2 0.5   # WIDTH HEIGHT SCALE TIME
```

## Tests

```sh
graphics/demo/scripts/check                         # generated modules, packages, goldens, GPU vs CPU
graphics/demo/scripts/app check --backend all       # the app in a window, read back and compared
graphics/demo/scripts/browser test                  # the page in Chromium: check and interaction runs
```

- **Goldens.** Three frames (`desktop` at 1x, `retina` at 2x with hover and a favorite,
  `scrolled` at 1.5x with grayscale) rendered on the CPU must match `tests/goldens` within 2 per
  channel. To regenerate them, run the tests binary with `graphics/demo/tests/goldens --update`.
- **GPU against CPU.** The same frames drawn by `ui_renderer` into RGBA8 and BGRA8 targets are
  compared with the CPU frame using `compare.Tolerance.frame()`: at most 0.2% of channels may
  differ by more than 8, the mean difference must stay under 0.25, and no channel may differ by
  more than 96. The largest deltas (52 to 80) come from the wavy underline, which the GPU shader
  approximates to first order. The GPU hosts draw text without gamma correction in these runs
  (`TextSettings.none()`), so glyphs match the CPU coverage.
- **Animation.** 150 frames at 800x600 compare every 30th frame with the CPU and check that the
  caches settle: at most 12 image uploads in total and no more than 20 new glyph rasterizations
  after the tenth frame.
- **Windows and browser.** `--check` mode draws three frames at a fixed time, reads the surface
  back and compares it with the CPU reference. On Linux the script starts Xvfb and a headless
  Weston itself and uses lavapipe unless `VK_ICD_FILENAMES` is set.

CI runs all of it on Linux (lavapipe), in Chromium, and in real windows on macOS and Windows
(`.github/workflows/graphics-demo.yml`).

## Assets

Fonts are subsets of Noto Sans (SIL Open Font License, `assets/fonts/Noto-LICENSE-OFL.txt`).
Icons are drawn for this demo. Photos are procedural landscapes from `scripts/generate-photos`.

`src/generated_assets.silk` embeds every file under `assets/` as a byte string. Regenerate it
with `scripts/embed-assets` after changing an asset (CI runs `--check`). It exists because
`silk.build.source.Source.read` in a dependency package, at Silk 0.1.0-dev.44, resolves the path
under that package's `src/` and lexes the file as Silk, so assets cannot be read at build time
by a library.
