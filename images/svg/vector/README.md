# images-svg-vector

A 2D vector rasterizer in pure Silk. It has no GPU and no C, and depends only on the standard
library. It is the drawing core under the [SVG renderer](..). It follows the sparse-strips design
of [vello_cpu](https://github.com/linebender/vello/tree/main/sparse_strips): coverage is computed
once as strips, and paints are composited through them. The [GPU scene renderer](../gpu_scene)
consumes the same coverage and produces byte-identical images.

## What it provides

- **Geometry and paths** (`geometry`, `path`): affine transforms, rectangles, and paths with
  lines, quadratics, cubics and exact elliptical arcs.
- **Flattening** (`flatten`, `projective`): device-space polylines within a 0.25 px tolerance,
  including projective (perspective) transforms clipped before division. Geometry that can't
  meet the tolerance fails with a `GeometryError` instead of drawing something wrong.
- **Stroking** (`stroke`): joins, caps, miter limits and dashes, plus a certified path-length
  metric.
- **Coverage** (`strips`): antialiased nonzero and even-odd fills into reusable `Coverage`, and
  aliased fills for `shape-rendering: crispEdges`.
- **Paints** (`paint`): solid colours, linear and two-circle radial gradients with every spread
  mode, and image patterns with nearest or bilinear sampling.
- **Layers** (`layer`): masks, clips, group opacity and the Compositing and Blending Level 1
  blend modes.
- **Filters** (`filter`): the Filter Effects primitives, from blur, morphology, colour matrices
  and component transfer to convolution, displacement, turbulence and lighting.
- **Pixmaps** (`pixmap`): premultiplied RGBA8. Compositing uses exact integer arithmetic, which
  is how the GPU path can match it byte for byte.

## Example

```silk
import vector.geometry { Affine }
import vector.geometry_error { GeometryError }
import vector.path { Path }
import vector.pixmap { Pixmap, Rgba8 }
import vector.strips { Coverage, NONZERO, Rasterizer }
import vector.paint { Solid }
import vector.paint as painting
import silk.mem.allocator { Allocator, OutOfMemoryError }

/// Draws a red disc on a transparent 256×256 image.
pub effect fn disc() -> Pixmap
  ! GeometryError | OutOfMemoryError
  ? &mut Allocator {
  let mut target = run Pixmap.make(256, 256)
  let mut path = Path.make()
  run path.circle(128.0, 128.0, 96.0)
  let mut raster = Rasterizer.make()
  let mut coverage = Coverage.make(256, 256)
  run raster.fill(&path, &Affine.identity(), NONZERO, &mut coverage)
  painting.fill(&mut target, &coverage, &Solid.make(Rgba8.make(220, 30, 30, 255)), 255)
  return move target
}
```

The rasterizer, coverage and paths can be reused across draws without reallocating. Dependents
import the package as `vector`.

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `images/svg/vector` | `images-svg-vector` | The library |
| `images/svg/vector/bench` | `images-svg-vector-bench` | Scenes timed against tiny-skia ([workloads](bench/WORKLOADS.md)) |
| `images/svg/vector/filter-bench` | `images-svg-vector-filter-bench` | Filters timed against resvg ([workloads](filter-bench/WORKLOADS.md)) |

## Tests

From the repository root:

```sh
images/svg/scripts/check-vector
```

This runs the 170 unit tests, checks the packages, and renders every GPU scene test on both the
CPU and Dawn (lavapipe in CI), requiring identical bytes. Use `--skip-native` to leave out the GPU
part. It runs in the `images-svg-vector` CI workflow.

## Performance

`images/svg/scripts/bench-vector` and `images/svg/scripts/bench-filters` compare against tiny-skia
and resvg on the same scenes, and also report how far the images differ. As of 2026-10-29,
vector takes 0.17–0.63× tiny-skia's time on fills, strokes, gradients, polygons and icons, and
matches it on image patterns. Every filter primitive beats resvg; blur, for example, takes
7 ms against resvg's 31 ms on a 512×512 image. The benchmarks run weekly in CI.
