# ui-showcase: Silk Loom

A showcase of the drawing layer and the UI stack in one app. Five ribbons of silk threads weave
across a starfield behind a glass card; the threads part around the pointer, a click leaves a
ripple, and "Reweave" blends every thread into the next palette (aurora, ember, lagoon).

It is an ordinary [ui-app](../../ui/app) app (`src/loom.silk`): a model, messages, a `view` that the
runtime diffs into [ui-tree](../../ui/tree) mutations, and an animation frame subscription. Everything
on screen goes through the same pipeline:

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

In a window (Metal on macOS, D3D12 on Windows, Vulkan on Linux), from the repository root:

```sh
python3 scripts/install-silk && python3 scripts/install-llvm   # once
examples/showcase/core/scripts/app --release
```

Move the pointer through the threads, click anywhere for a ripple, press "Reweave" (or `R`) for
the next palette and `Space` to pause. The first build compiles the window bridge and fetches
Dawn, as `examples/graphics-demo/core/scripts/app` does; see the native/platform/window README for prerequisites.

## Record it

```sh
examples/showcase/core/scripts/record            # build/showcase/silk-loom.mp4, .gif and PNG stills
examples/showcase/core/scripts/record --scale 2  # 2560x1440
```

The recorder (`record/src/main.silk`) runs the app through the runtime and the tree's real
input path: a scripted pointer glides through the weave, hovers a chip and presses "Reweave"
twice, and every frame is drawn by the CPU reference renderer and piped to ffmpeg. It draws its
own arrow, since there is no system cursor.

## Assets

`src/generated_assets.silk` embeds `assets/` (regenerate with `scripts/embed-assets`; CI runs
`--check`), because `Source.read` in a dependency package does not work at Silk dev.45. Noto
Sans regular and bold come from ui/assets. Fonts: Noto (SIL OFL,
`assets/fonts/Noto-LICENSE-OFL.txt`); 12 emoji from Twemoji Mozilla (graphics CC-BY 4.0 by
Twitter, see `assets/fonts/Twemoji-LICENSE.txt`). The loom icon is drawn for this showcase.
