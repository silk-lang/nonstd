# SVG rendering and geometry API

## Rendering API and CLI

```sh
silk build --release --manifest-path images/svg/cli/silk.toml
build/llvm/aarch64-apple-darwin/release/images-svg-cli input.svg -o output.png
build/llvm/aarch64-apple-darwin/release/images-svg-cli input.svg -o output.png --width 300 --zoom 2
build/llvm/aarch64-apple-darwin/release/images-svg-cli input.svg -o detail.png --fragment '#detail' --mode secure-static
```

Use `aarch64-unknown-linux-gnu` or `x86_64-unknown-linux-gnu` for the corresponding
Linux build directory. The CLI requires an input path and `-o`; it creates no
output before parsing, rendering and encoding succeed. Invalid invocation exits
2; I/O/rendering/encoding failures exit 1.

Import `svg_render.lib`:

| Entry point | Ownership and result |
|---|---|
| `parse(data, &options, &environment)` | XML bytes → owned `RenderTree` including source graph/computed styles, without rasterizing |
| `record(move tree)` | Moves geometry into a backend-neutral `DisplayList` |
| `renderDisplayList(&list)` | Reusable retained input → owned `vector.pixmap.Pixmap` |
| `render(data, &options, &environment)` | Combined path → premultiplied sRGB RGBA8 pixmap |

All entry points require an allocator; `parse` and `render` also require the
`svg_core.resources.Resolver` effect. Errors are typed `RenderError` or
`OutOfMemoryError`. `Environment` supplies the base URL, embedding viewport,
measured font metrics, system colors, concrete system-font values and CSS limits.
Its `structure` options supply processing mode/resource budgets, ordered languages,
supported extension identifiers, reference-expansion budgets and an optional
encoded fragment override. An absent override uses the base URL fragment; a
present empty override clears it. SVG 2 behavior is the default; there is no `Profile` API.
`NativeHost` measures a selected installed serif at 16 CSS px; all six system-font
keywords alias that face. The headless palette is explicit light sRGB, not the
operating system's appearance. Linux CI installs `fonts-dejavu-core`.

The CLI permits `data:` resources and files confined to the input directory;
it does not fetch network resources. `--mode` accepts `static` (default),
`animated`, `secure-static` and `secure-animated`. Secure modes block external
requests before invoking a host resolver. Animation sampling is a later phase;
the current mode selection governs resource access, not a running timeline.
`--fragment` accepts encoded text with one optional leading `#`.
The 300×150 embedding viewport is independent of output-resolution overrides.
Portable hosts can provide measured font bytes through `NativeHost.fromFontBytes`,
or configure `Environment` directly. `Environment.fonts` is the font database text
uses; `NativeHost.fonts` starts with the discovered initial face, and hosts add faces
with `FontDatabase.add`. `--font-dir DIR` adds the `.ttf`, `.otf` and `.ttc` files
directly in `DIR`, in path order.

`Resolver.fetch` returns `Response { bytes, finalUrl, mediaType, charset }`.
`Response.fromBytes` supplies absent transport metadata. Redirect URLs establish
relative-reference bases; metadata governs stylesheet encoding/MIME and external
SVG decoding. HTTP(S) `use` requests and final redirects must match the including
document's normalized scheme/host/port. File/custom-scheme authorization remains
the host's responsibility. External use templates are secure-static; cloned
occurrences request additional resources under the including document's mode.
URL normalization byte/scalar/work exhaustion remains a resource error:
`UrlError.InputLimit` propagates through stylesheet loading to `RenderError.TooLarge`.
Both processing instructions and `@import` stop the render rather than treating
exhaustion as an ignorable malformed URL; allocation failure remains distinct.

`Catalog.matching` mutably borrows its catalog to build and reuse a conservative
ID/class/local-name selector index. Complete matching still determines specificity;
unkeyed arms and fingerprint collisions remain candidates, never false negatives.
Adding stylesheet rules invalidates the index. Candidate discovery and matching
share a 64,000,000-step document budget; exhaustion remains `CssError.MatchLimit`
(`RenderError.TooLarge` at the rendering boundary), not a selector nonmatch.

`RenderTree.graph` owns each source document once and retains metadata/private
data. Occurrences contain source IDs and separate light-child/shadow links; the
graph retains non-rendering sources as well as selected rendering instances.
`RenderTree.styles` retains occurrence styles, declaration source bases and the
selected view. A stylesheet rule set is scoped to its source document, while
all sets share one value/path arena. CSS path handles resolve in `RenderTree.paths`
after its single move from the CSS store. `record` consumes the tree and retains
only drawing data. `RenderTree.documents` owns embedded image responses and
`RenderTree.embedded` holds layouts keyed by source and logical viewport. Recording
moves these into `DisplayList.embedded`; `Command.Embedded` references a child
picture and carries its placement and viewport clip. Broken sources have no child
picture. `parseEmbedded` provides independent secure layout in an exact logical
viewport; rounding only affects its standalone output allocation, not geometry.
`DisplayList.projectionClips` contains device-space homogeneous halfplane chains
for physical viewport boundaries and nested positive-w flattening boundaries.
Parents precede children; execution validates that ordering and command indices.
`svg_image.png.encodePixels(width, height, pixels)` borrows premultiplied pixels;
no intermediate owned image copy is required.

`RenderOptions.make()` uses intrinsic/default object sizing, zoom 1 and a
16M-pixel output budget. A viewBox supplies an aspect ratio, not intrinsic pixel
dimensions: a viewBox-only square occupies 150×150 in the 300×150 default object
size. CLI width/height select output resolution without rewriting the logical
viewport. The executor also caps aggregate output/isolated surfaces at 64M
pixels; excessively nested opacity groups fail before allocating their surfaces.
The same `maxPixels` value separately caps aggregate cached pattern texels.
User-space pattern pictures are shared across differently sized referring
elements when their actual content layout and inherited context are identical;
placement remains per paint instance.

## Geometry API

Import `svg_geometry.geometry`. `Transform.multiply(left, right)` applies right
first; rotations use radians, while stored endpoint-arc rotations use SVG degrees.
Singular/nonfinite/unrepresentable inverses return `None`, never identity.
`Rect.united` and `Rect.intersection` preserve zero-area locations; disjoint bounds
are `None`. A transformed rectangle bounds all four corners, not the exact curve.

`Path` owns stdlib `List` storage. Borrow its segments; append rejects nonfinite
segments or a missing initial move without changing the path. Close restores the
subpath start. Import `svg_geometry.svg` for SVG path/points parsing and shape/
viewBox construction, `svg_geometry.arcs` for exact center-parameter normalization
and optional allocation-free cubic iteration, and `svg_geometry.transforms` for
the distinct SVG/CSS grammars. The backend receives exact ellipse primitives,
preserving source tangents and curvature. Coverage has a 0.25-device-pixel budget;
stroke-reference bounds use a tighter 1e-7 target-coordinate budget. Numeric or
subdivision limits fail explicitly rather than returning under-resolved geometry.
