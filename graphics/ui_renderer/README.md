# graphics-ui-renderer

Draws a finished [`graphics/ui_scene`](../ui_scene) `Scene` with WebGPU, natively through Dawn
and in the browser through `navigator.gpu` ([gpu-webgpu](../../gpu/webgpu)). This is phase 3 of
the UI drawing layer: the GPU counterpart of `ui_scene.cpu.CpuRenderer`.

## Use

```silk
import ui_renderer.atlas_textures { GpuAtlas }
import ui_renderer.renderer { UiRenderer }
import ui_scene.color { Color }
import webgpu_sys.generated_webgpu as flags

// Once per window, for the surface's format (RGBA8Unorm or BGRA8Unorm):
let mut renderer = run UiRenderer.make(&device, flags.WGPUTextureFormat_BGRA8Unorm)
let mut textures = GpuAtlas.make()

// Each frame, after painting and `scene.finish()`:
run textures.sync(&device, &atlas)          // new atlas textures
textures.write(&queue, tile, pixels)          // each new tile's pixels
run renderer.draw(&device, &queue, &scene, &textures, &surfaceView, width, height, Color.white())
```

`draw` records and submits one command buffer. `encode` records into a caller's encoder instead,
for callers that also present or read back.

## How it draws

Every batch of the scene is one instanced draw of six vertices per instance, as in GPUI:

| Kind | Shader | How |
| --- | --- | --- |
| Quad | `shaders/quad.wgsl` | Rounded-rectangle SDF per corner radius, analytic antialiasing. The border is the band between the outline and the inner outline with elliptical corners (`r - left`, `r - top`), drawn over the background in the same fragment. Dashes (`2w` on, `w` off, from the top-left corner, clockwise) follow the arc length of the band's center line. |
| Shadow | `shaders/shadow.wgsl` | Closed-form Gaussian along x (erf), integrated along y with 8 samples (Evan Wallace's method). `sigma = blurRadius / 2`, as CSS. Inset shadows are the complement, clipped to the box. |
| Underline | `shaders/underline.wgsl` | Straight: exact area of the top `thickness` rows. Wavy: distance to the sine wave to first order. |
| Glyph | `shaders/mono.wgsl` | A8 atlas tile, bilinear at pixel centers clamped to the tile, with DirectWrite's contrast and gamma correction for text (see below). |
| Image | `shaders/poly.wgsl` | Premultiplied RGBA tile, bilinear, with corner radii, opacity and grayscale. |
| Surface | `shaders/poly.wgsl` | The image pipeline over a texture registered with `UiRenderer.setSurface(id, view)`, one bind group per surface id. |
| Path | `shaders/path.wgsl` | `vector` coverage strips in gpu_scene's run layout (4-row bands, a word of coverage per column), placed at the sprite's integer origin; bands start at the sprite's own `y`. |
| Layer | `shaders/layer.wgsl` | Isolated layers drawn into pooled RGBA8 textures and composited with gpu_scene's `blend.wgsl` (all `vector.layer` blend modes) and the group opacity, with optional layer/backdrop blur and color filters. |

Gradients have two stops and any `silk.color` interpolation. sRGB gradients are mixed in the
shader; every other interpolation (linear sRGB, Oklab, Oklch and the other polar spaces with their
hue arcs, wide gamut spaces) gets a 256-entry ramp of premultiplied RGBA8 words, sampled on the
CPU with the same `color.mix` the CPU reference uses, in a storage buffer the quad and path
shaders read. Either way the parameter steps in 1/255, as the CPU reference's ramp does.
Content masks clip by pixel area. `shaders/common.wgsl` holds what the pipelines share; edit the
`.wgsl` files and run `gpu/webgpu/scripts/embed-shaders`, never the generated module.

All instances of a frame go into one storage buffer per kind (every layer's sorted list, in layer
order), uploaded with `queue.writeBuffer`. The buffers persist across frames and are replaced
only when a frame outgrows them. A scene without isolated layers draws straight onto the target;
with them, the frame is drawn into an RGBA8 texture and copied to the target at the end.

Paths do not go through `gpu_scene.SceneRenderer` itself: UI paths need content masks and gradient
ramps, which its paint records lack. They reuse its band layout, its buffer helpers and its
blend modes.

### Layer effects and atlas uploads

`Scene.pushEffectLayer` carries the shared [`LayerEffects`](../ui_scene/src/effects.silk)
settings into the renderer. Gaussian blur and color matrices reuse `gpu_scene.FilterRenderer`;
filter scratch textures and uniforms are pooled between frames. A scene without isolated layers
keeps the direct rendering path. Backdrop blur currently copies and filters the full viewport.
Filter surfaces are viewport sized, so source pixels beyond their edges cannot contribute to
blur. Cost scales with filtered area and layer count; these changes do not make large stacks of
blurred layers free.

`GpuAtlas.texture(index)` exposes a borrowed texture for external uploads. Call `sync` first,
write only the allocated tile, and provide premultiplied pixels for color tiles. Color atlas
textures now include render-attachment usage, which browser canvas-to-texture copies require;
monochrome textures keep their previous usage. Instance packing writes whole little-endian
vectors in bulk rather than appending each byte separately.

### Surfaces

`SurfaceSprite`s draw textures the renderer does not own, such as a web view's page imported with
`webgpu.shared_texture`. Register a view with `renderer.setSurface(id, &view)` (it keeps a
reference until `removeSurface(id)` or another `setSurface` for the id) and paint sprites naming
the id. The view must be float-sampleable, RGBA8 or BGRA8, premultiplied; keep a shared texture's
access open until the frames that draw it are submitted. Sprites of an unregistered id draw
nothing.

### Text correction

Unhinted coverage blended plainly looks thin. `TextSettings` applies Windows Terminal's DirectWrite
correction (MIT), as GPUI does: an enhanced-contrast curve weighted by how dark the text is, then
DirectWrite's gamma ratios. The default is gamma 1.8, contrast 1.0 (GPUI's Linux and web
defaults); `TextSettings.none()` turns it off. `TextSettings.correct` computes the same curve on
the CPU.

## Accuracy

The GPU output is compared with `CpuRenderer`, within a tolerance rather than byte for byte. Most
of the difference is on the CPU side: `vector` flattens arcs to within 0.25 px, so pixels where a
rounded corner runs nearly parallel to a pixel row can differ by up to a quarter of their coverage
(the largest deltas, around 35 levels). The erf blur and the dash arc length are approximations
too. Flat areas match exactly.

| Fixture | Max channel delta | Channels over 8 | Mean delta |
| --- | --- | --- | --- |
| cards | 36 | 0.17% | 0.18 |
| borders | 32 | 0.39% | 0.12 |
| shadows | 13 | 0.05% | 0.35 |
| layers | 25 | 0.20% | 0.06 |
| nested | 24 | 0.10% | 0.04 |
| gradients | 28 | 0.37% | 0.13 |
| surfaces | 21 | 0.06% | 0.02 |
| text ramp | 0 | 0 | 0 |

These are lavapipe's numbers. Chromium's WebGPU (SwiftShader) gives the same within a level.
The test allows 48, 0.6% and 0.5 (exact for the text ramp).

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `graphics/ui_renderer` | `graphics-ui-renderer` | The renderer (`renderer`, `atlas_textures`, `instances`, `text`) |
| `graphics/ui_renderer/fixtures` | `graphics-ui-renderer-fixtures` | Fixture scenes and their CPU references |
| `graphics/ui_renderer/tests` | `graphics-ui-renderer-tests` | Native GPU against CPU comparison |
| `graphics/ui_renderer/browser` | `graphics-ui-renderer-browser` | The same comparison as a wasm module for Chromium |
| `graphics/ui_renderer/bench` | `graphics-ui-renderer-bench` | Dense-scene frame time |
| `graphics/ui_renderer/shared-texture-test` | `graphics-ui-renderer-shared-texture-test` | A texture from another API imported and drawn through surface sprites (Linux, macOS; not a workspace member) |

## Tests

From the repository root, with a Vulkan, Metal or D3D driver (CI uses lavapipe):

```sh
python3 graphics/ui_renderer/scripts/check          # shaders, packages, wasm32, GPU comparison
python3 graphics/ui_renderer/scripts/test-browser   # the comparison in installed Chromium
python3 graphics/ui_renderer/scripts/bench          # dense scene against bench/budget.json
python3 graphics/ui_renderer/scripts/test-shared-texture  # imported texture through surface sprites
```

The comparison renders nine fixtures (the four `ui_scene` golden scenes, nested isolated layers
with clipped sprites and paths, gradients in eight interpolations on quads and paths, layer/backdrop
blur with color adjustments and blending, surface sprites from RGBA8 and BGRA8 textures, and a text
coverage ramp) into RGBA8 and BGRA8 targets.
It checks text correction against `TextSettings.correct` within one level and redraws the layered,
gradient, effects and surfaces scenes after another scene to check that pooled resources carry nothing over.

The benchmark draws 320 cards (shadow, bordered rounded quad, a line of glyphs; 3,521 primitives)
at 1280 x 800 and reports the median build, encode and frame times. On lavapipe in a 4-core
container: build 3.9 to 5.1 ms, encode 1.2 to 1.5 ms, frame about 70 ms (software rasterization).
The shared texture test makes a test pattern with another API and imports it: on Linux a second
Vulkan device exports an image as an opaque file descriptor (needs `libvulkan-dev`); on macOS an
IOSurface in BGRA. It draws the import through surface sprites (exact, stretched with rounded
corners, a source rectangle, in a clipped isolated layer) and compares with the CPU reference. On
lavapipe, which cannot export the semaphore Dawn signals when a submit reads a shared texture, it
stops after the access begins and ends.

The `graphics-ui-renderer` workflow runs the check, the shared texture test (Linux and macOS) and
the browser test on every pull request and the benchmark weekly.

Dependents import the package as `ui_renderer`.
