# ui-showcase: Silk Loom

A showcase of the drawing layer and the UI stack in one app. Five ribbons of silk threads weave
across a starfield behind a glass card; the threads part around the pointer, a click leaves a
ripple, and "Reweave" blends every thread into the next palette (aurora, ember, lagoon).

It is an ordinary `ui-app` app (`src/loom.silk`): a model, messages, a `view` that the
runtime diffs into `ui-tree` mutations, and an animation frame subscription. These packages
come from the pinned `lib-ui` dependency. Everything on screen goes through the same pipeline:

- The weave is one canvas node: 85 strokes a frame (15 threads and two glow passes per ribbon)
  rasterized by `vector` through the ui_scene path cache, plus 90 twinkling stars as rounded
  quads (`src/weave.silk`).
- The card is boxes laid out by css-layout: linear gradients, a 90 px soft shadow, borders,
  hover and press looks, an intro fade (an isolated opacity layer), a wrapping chip row and an
  equalizer whose 30 bars relayout every frame.
- Text through ui-text and the glyph cache: Noto Sans from Light to Black, Noto Mono, and color
  emoji from a COLRv0 Twemoji subset picked by font fallback.
- An animated SVG icon (SMIL `animateTransform` and `animate`) rasterized by `sprites` into
  atlas tiles, one per animation frame.

| Path | Package | What |
| --- | --- | --- |
| `.` | `ui-showcase` | The app, its palette, the weave and the embedded fonts and icon |
| `app` | `ui-showcase-app` | The app in a native window (`ui-app-window`, ui_renderer on Dawn) |
| `record` | `ui-showcase-record` | Headless recording: scripted pointer, CPU frames as raw RGBA |

## Run it

With Node.js and Silk installed, in a window (Metal on macOS, D3D12 on Windows, Vulkan on Linux),
from the repository root:

```sh
examples/showcase/scripts/app --release
examples/showcase/scripts/app --build-only  # print the executable path without launching
examples/showcase/scripts/app check --backend all --release
```

Move the pointer through the threads, click anywhere for a ripple, press "Reweave" (or `R`) for
the next palette and `Space` to pause. The first build compiles the window bridge and fetches
Dawn from the pinned native dependencies. Linux builds need libx11-dev, libxkbcommon-dev and
libwayland-dev. `check` scripts a Reweave click and compares the window surface with the CPU
reference. On Linux it starts Xvfb and headless Weston (`--backend x11|wayland|all`, default
`all`), defaults to lavapipe when `VK_ICD_FILENAMES` is unset, and defaults `SILK_WINDOW_SCALE`
to `1`. Install Xvfb and Weston for these checks. Other platforms open a real window.

## Record it

```sh
examples/showcase/scripts/record            # build/showcase/silk-loom.mp4, .gif and PNG stills
examples/showcase/scripts/record --scale 2  # 2560x1440
```

The recorder (`record/src/main.silk`) runs the app through the runtime and the tree's real
input path: a scripted pointer glides through the weave, hovers a chip and presses "Reweave"
twice, and every frame is drawn by the CPU reference renderer and piped to ffmpeg. It draws its
own arrow, since there is no system cursor.

Both recording launchers use Node.js and direct Silk builds, with release mode by default
(`--debug` disables it). ffmpeg is required for encoding, but Python and Pillow are not.
Frames stream to the encoder with backpressure rather than accumulating the recording in memory.
PNG stills are encoded directly from the original RGBA frames, not the lossy video.

Shared options: `--width 1280 --height 720 --scale 1.5 --fps 30 --gif-width 600`,
`--out DIRECTORY`, `--seconds DURATION`, `--stills COMMA_SEPARATED_TIMES`, `--frames-only`
and `--debug`. Relative output directories resolve from the repository root; all launchers
also accept `--help`. Frame counts and still timestamps round to the nearest frame, ties to even.
Stills outside the recorded interval are skipped; `--stills ''` disables stills.

| Launcher | Default output directory | Duration | Still timestamps | Output basename |
| --- | --- | --- | --- | --- |
| `examples/showcase/scripts/record` | `build/showcase` | 13 seconds | `2.2,5.8,7.6,10.4` | `silk-loom` |
| `examples/crdt-showcase/scripts/record` | `build/crdt-showcase` | 19 seconds | `3,8,12.5,18.5` | `crdt-showcase` |

Each writes `<basename>.mp4` (H.264, slow preset, CRF 16, yuv420p, faststart),
`<basename>.gif` (15 fps, 160 colors, Bayer dithering) and `<basename>-<timestamp>s.png`.
`--frames-only` counts rendered frames without invoking ffmpeg or writing media:

```sh
examples/showcase/scripts/record --frames-only --fps 10 --seconds 7.7 --scale 1 --debug
examples/crdt-showcase/scripts/record --frames-only --fps 2 --seconds 3 --scale 1 --debug
```

## Assets

`src/generated_assets.silk` embeds `assets/`. The optional Node.js command
`examples/showcase/scripts/embed-assets` regenerates it; `--check` checks freshness without
writing (including in CI). Normal builds use the checked-in bytes. Embedding avoids
`Source.read` in dependency packages, which did not work at Silk dev.45. Noto Sans regular
and bold come from the pinned `lib-ui` package `ui-assets`. Fonts: Noto (SIL OFL,
`assets/fonts/Noto-LICENSE-OFL.txt`); 12 emoji from Twemoji Mozilla (graphics CC-BY 4.0 by
Twitter, see `assets/fonts/Twemoji-LICENSE.txt`). The loom icon is drawn for this showcase.
