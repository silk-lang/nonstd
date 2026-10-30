# images-svg

An SVG renderer for Silk, written from the specifications (SVG 1.1 Second Edition and SVG 2)
rather than ported from another engine. It parses a document and computes CSS over it. It then
resolves geometry, records a backend-neutral display list, and rasterizes that list to
premultiplied RGBA through [images-svg-vector](vector). Browsers and resvg are used as
diagnostic references; [SPECIFICATIONS.md](SPECIFICATIONS.md) records the authority, scope and
coverage.

## What renders today

- **Structure:** outermost and nested `svg`, `g`, `use`, `symbol`, `switch`, views and
  fragment selection, with shadow trees and reference boxes.
- **Styling:** CSS selectors, the cascade, custom properties, presentation attributes,
  inline and external stylesheets, `@media` and `@supports`.
- **Shapes:** paths and basic shapes, with 2D and projective transforms and clipping at
  viewport boundaries.
- **Paint:** solid colours, linear and radial gradients, patterns, markers, context paint,
  `paint-order`, `vector-effect`, opacity groups, linear-RGB compositing and `pathLength`
  dashes. All separable and non-separable `mix-blend-mode` values and explicit
  `isolation` are consumed by the CPU layer executor.

Clipping now includes referenced `clipPath` geometry, nested intersections, child unions,
`use`, basic CSS shapes and geometry boxes. Geometric unions are evaluated before
antialias rasterization. Legacy viewport `clip` uses the existing viewport resolver.
Text clipping and projective clip edge cases remain in progress.

SVG mask resources support alpha/luminance coverage, mask units, nested masks,
and CSS mask-layer composition. Image and gradient mask sources remain pending.
Filters, image decoding, text, animation and ICC colour are planned later phases. [Status](docs/status.md) describes what each phase delivered.

## Example

```silk
import svg_render.lib { Pixmap, RenderError, RenderOptions, render }
import svg_render.native_environment { NativeHost, NativeHostError }
import svg_core.resources { DataOnly, Limits, Resolver }
import svg_core.url { Url, UrlError }
import svg_image.png
import svg_image.image { ImageError }
import silk.collections.bytes { Bytes }
import silk.core.effect { Effect }
import silk.mem.allocator { Allocator, OutOfMemoryError }

/// Renders an SVG document to PNG bytes. Only `data:` URLs are resolved.
pub effect fn svgToPng(svg: &[u8]) -> Bytes
  ! RenderError | NativeHostError | UrlError | ImageError | OutOfMemoryError
  ? &mut Allocator {
  let base = run Url.parseAbsolute(b"file:///drawing.svg")
  let host = run NativeHost.make(300.0, 150.0) // the embedding viewport, in CSS px
  let environment = host.environment(&base)
  let mut resolver = DataOnly.make(Limits.defaults())
  let image = run render(svg, &RenderOptions.make(), &environment)
    |> Effect.provideMut<Resolver>(&mut resolver)
  return run png.encodePixels(image.width(), image.height(), image.data())
}
```

External resources go through the `Resolver` service, so the host decides what may be
fetched. `render` is the one-step entry point. `parse`, `record` and `renderDisplayList` expose
the render tree with its computed styles, and a reusable display list. The [API notes](docs/api.md)
cover the environment, processing modes, resource policy and the geometry API.

## Command line

```sh
silk build --release --manifest-path images/svg/cli/silk.toml
build/llvm/x86_64-unknown-linux-gnu/release/images-svg-cli input.svg -o output.png --width 300
build/llvm/x86_64-unknown-linux-gnu/release/images-svg-cli input.svg -o detail.png --fragment '#detail' --mode secure-static
```

The CLI resolves `data:` URLs and files in the input's directory, and never the network. It
writes nothing unless parsing, rendering and encoding all succeed.

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `images/svg` | `images-svg` | Document styling, structure and geometry resolution (imported as `svg_core`) |
| `images/svg/render` | `images-svg-render` | Render tree, display list and the rendering entry points (`svg_render`) |
| `images/svg/raster` | `images-svg-raster` | Executes display lists on the CPU through `vector` |
| `images/svg/geometry` | `images-svg-geometry` | f64 geometry, path and points parsing, arcs, transforms |
| `images/svg/image` | `images-svg-image` | Premultiplied RGBA storage and PNG encoding |
| `images/svg/filters` | `images-svg-filters` | Filter boundary (filters themselves are a later phase) |
| `images/svg/cli` | `images-svg-cli` | The command-line renderer |
| `images/svg/tests` | `images-svg-tests` | Test inputs, suite pins and reviewed expectations |
| `images/svg/bench` | `images-svg-bench` | Renderer workloads and the resvg comparison |
| `images/svg/vector` | `images-svg-vector` | The pure-Silk 2D rasterizer ([README](vector/README.md)) |
| `images/svg/gpu_scene` | `images-svg-gpu-scene` | Draws `vector` scenes on WebGPU, byte-identical to the CPU ([README](gpu_scene/README.md)) |

XML parsing is [text-xml](../../text/xml) and CSS is [css-style](../../css/style). Text measurement
uses [font-parse](../../font/parse).

## Tests

From the repository root:

```sh
images/svg/scripts/check
```

The gate type-checks and tests every SVG package. It then builds the release CLI and renders the
project's own reference tests (including 53 exact-RGBA painting tests), malformed inputs, and a
curated subset of the resvg suite. Every result is compared with a reviewed expectation, so a
known failure is recorded as one and never counted as a pass. It runs in the `images-svg` CI
workflow, and `images/svg/scripts/check-vector` runs the vector and GPU scene tests in
`images-svg-vector`. [Testing](docs/testing.md) covers the specification and suite caches,
expectation files and the reftest runner.

## Performance

The renderer is correct first and not yet fast. Against resvg, end-to-end time ranges from
0.66× on a 2,048-rule stylesheet workload to about 5× on icon and curve-heavy workloads. Parsing
and recording dominate. [Performance](docs/performance.md) has the per-stage tables, the A/B
method and how to reproduce them.

## Limitations

[LIMITATIONS.md](LIMITATIONS.md) records workarounds for gaps in the compiler and standard
library.

## License

MIT or Apache-2.0.

The standalone `image` package also decodes PNG samples, Adam7 images and APNG's
first frame, retaining source color metadata. This decoder is not yet connected
to SVG `<image>` rendering or color conversion.
