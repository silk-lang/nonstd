# graphics-ui-scene

The CPU side of the UI drawing layer, after GPUI's `Scene`. A frame appends flat primitives, each
gets a draw order from what it overlaps, and the scene is sorted and merged into a few batches a
GPU renderer draws with one call each. A CPU renderer draws the same scene through `vector`, for
headless screenshots and as the reference the GPU renderer is compared with.

Coordinates are scaled device pixels (`f32`, y down, after the window's scale factor). Nothing here
depends on a GPU, so it builds for wasm32 too.

## Modules

- `primitives`: the records a frame is made of, all `Copy`:
  - `Quad`: per-corner radii (`silk.geometry.corners.Corners`), per-edge border widths, a solid or
    dashed border, and a solid or two-stop linear gradient `Background` interpolated in any
    `silk.color` space (sRGB, Oklab, Oklch, ...).
  - `Shadow`: a blurred rounded rectangle with an offset and spread, drop or inset, as CSS
    `box-shadow` (the blur radius is twice the Gaussian's sigma).
  - `Underline`: straight or wavy.
  - `GlyphSprite`: a tinted coverage tile from a monochrome `graphics/atlas` texture.
  - `ImageSprite`: a premultiplied color tile, with opacity, corner radii and grayscale.
  - `SurfaceSprite`: a premultiplied texture from outside the atlas (a web page, a video frame),
    named by a caller-chosen surface id, with a source rectangle, opacity and corner radii.
  - `PathSprite`: `vector` strip coverage at an integer origin (made by `path_cache`).
  - Every primitive has a `ContentMask`, the rectangle it is clipped to.
- `effects`: `LayerEffects` for isolated-layer blur, backdrop blur, and color adjustments.
- `color`: helpers over `silk.color`. Primitives store `silk.color.rgba.Rgba<f32>`, straight-alpha
  sRGB ready for an instance buffer: `color.rgb(0x3366cc)`, `color.rgba(...)`, or
  `color.fromColor(c)` to gamut-map any `silk.color.color.Color`. `color.mix` interpolates stops.
- `bounds_tree`: `BoundsTree`, a balanced bounding-volume tree that gives a rectangle one more than
  the highest order of anything it overlaps, as GPUI's `BoundsTree`.
- `scene`: `Scene` with `quad`, `shadow`, `underline`, `glyph`, `image`, `surface`, `pathCoverage`,
  `pushLayer`/`pushIsolatedLayer`/`pushEffectLayer`/`popLayer`, `replay`, `finish`, and per-layer `batches`.
- `path_cache`: `PathCache` rasterizes `vector` paths (fills and strokes) into a scene and keeps
  their coverage across frames.
- `cpu`: `CpuRenderer` and `AtlasPixels` (CPU copies of atlas textures).

## A frame

```silk
import ui_scene.color
import ui_scene.primitives { Background, ContentMask, Quad }
import ui_scene.scene { Scene }
import silk.geometry.corners { Corners }
import silk.geometry.rect { Rect }
import silk.mem.allocator { Allocator, OutOfMemoryError }

pub effect fn paint(scene: &mut Scene) -> () ! OutOfMemoryError ? &mut Allocator {
  scene.clear()
  let window = ContentMask.new(Rect<f32>.new(0.0, 0.0, 800.0, 600.0))
  let mut card = Quad.fill(Rect<f32>.new(20.0, 20.0, 220.0, 120.0), window, Background.solid(color.white()))
  card.cornerRadii = Corners<f32>.uniform(8.0)
  drop run scene.quad(card)
  run scene.finish()
  // A renderer now walks scene.batches(0): each Batch names a kind and a range of that kind's
  // sorted list (scene.quads(0), scene.glyphs(0), ...), plus the atlas texture for sprites.
}
```

## Ordering and batches

Each primitive's order is one more than the highest order among primitives it overlaps (after
clipping to its content mask), so disjoint primitives share orders. `finish` sorts each kind by
order (sprites also by atlas texture) and merges the kinds GPUI's way: take the kind whose next
item has the lowest order, and extend its run while its orders do not pass the next order of any
other kind. A list of cards, each a shadow, a quad and a line of glyphs, draws in three batches
however many cards there are.

Equal orders never overlap, except inside a pinned layer: `pushLayer(bounds)` gives everything
until `popLayer` the order of `bounds`, as GPUI does, so overlapping primitives of different kinds
there draw in kind order (shadows, quads, paths, underlines, glyphs, images, surfaces, layers).
Surface sprites are batched by surface id the way glyphs and images are batched by atlas texture.

`pushIsolatedLayer(bounds, mask, isolation)` opens an offscreen group: its primitives are ordered
and batched on their own (layer `n`), and the parent draws one `LayerSprite` that composites the
group with an opacity and a `vector.layer` blend mode.

`pushEffectLayer(bounds, mask, isolation, effects)` adds filters to an isolated group.
Start with `LayerEffects.none()`. Set `blur` or `backdropBlur` to a Gaussian standard deviation
in device pixels; zero disables that blur. Unlike `Shadow.blurRadius`, these fields are sigma,
not twice sigma. Expand the layer's paint bounds by three blur standard deviations on each side
when its content is blurred. Set `clip`, `radius`, and `shape` (0 rounded rectangle, 1 ellipse)
to describe the backdrop region separately from those expanded bounds.

`brightness`, `contrast`, and `saturation` are multipliers with neutral value 1. The color matrix
applies saturation, brightness, then contrast in straight sRGB, after content blur and before
the layer's opacity and blend mode. Backdrop blur samples the preceding content, clips to the
specified shape, and mixes with the original backdrop using the layer opacity. Ordinary
`pushIsolatedLayer` calls keep their existing behavior through neutral effects.

Ordering bounds round outward to whole pixels so fractional primitives that cover the same
pixel retain painter order. Sorting coalesces consecutive equal-order/equal-texture runs before
sorting keys, then copies each run intact; ties retain insertion order.

## Replay

Every paint call is logged. Keep two scenes, note `operationCount()` before and after a view
paints, and when the view did not change, `replay(&previous, start, end)` copies its primitives,
layers and path coverage from the last frame instead of painting again. Swap the scenes after each
frame.

## Path coverage

`PathCache.fill` and `PathCache.stroke` rasterize a `vector.path.Path` with `vector` strips. With
a nonzero id, the coverage is cached under the id, the 2x2 part of the transform, the subpixel
offset rounded to 1/4 px, the fill rule and the stroke style. It is stored relative to the
path's pixel origin, so a path moved by whole pixels (scrolling) reuses it, and an entry not drawn
for two frames is evicted by `beginFrame`. Id 0 rasterizes at the exact transform, clipped to the
content mask, without caching.

A `PathSprite`'s strips are banded in 4-row bands starting at the sprite's `y`, which can be any
integer: a GPU renderer offsets the bands rather than aligning them to multiples of 4.

## CPU renderer

`CpuRenderer.draw(&scene, &pixels, &mut pixmap)` lowers everything to `vector`: quads, borders and
underlines become paths with exact area coverage, dashed borders are `vector` strokes clipped to
the border band, shadows are filled shapes blurred with `vector.filter.gaussianBlur`, isolated
layers are composited with `vector.layer`. Layer filters use `vector.filter`; replay retains their settings. Content masks clip by pixel area. Gradients are
evaluated at pixel centers. Sprites sample their tile bilinearly, clamped to the tile. Surface
sprites read the pixels given to `AtlasPixels.setSurface` (none: they draw nothing). A GPU
renderer with SDF quads and an erf shadow is expected to match it within a small tolerance, not
byte for byte. Paths match `vector`'s own fill byte for byte.

## Tests

```sh
silk test --manifest-path graphics/ui_scene/silk.toml --root src/tests.silk
silk build --manifest-path graphics/ui_scene/tests/silk.toml
build/llvm/<target>/debug/graphics-ui-scene-tests graphics/ui_scene/tests/goldens
```

The unit tests check draw orders against a brute-force overlap scan, that a 100 x 100 grid keeps
the tree shallow, batch counts on fixture scenes (disjoint quads, a card list, glyphs on two
textures, pinned and isolated layers), replay, path cache hits, misses and eviction, and pixels
for every primitive kind. The golden test renders four fixture scenes (cards, borders, shadows,
layers) with the CPU renderer and compares them with the PNGs in `tests/goldens`, allowing 2
levels per channel. Pass `--update` after an intended change and review the new images.
