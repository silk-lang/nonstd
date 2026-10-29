# SVG for Silk

An original SVG 1.1 Second Edition and SVG 2 implementation, under MIT or
Apache-2.0. The specifications define behavior; browsers and resvg are diagnostic
references. See [authority, scope and coverage](SPECIFICATIONS.md).

## Current status

The renderer computes CSS over source documents and rendering occurrences before
resolving outermost/nested `svg`, groups, `use`, `symbol`, paths and basic shapes.
Selectors, cascade/custom properties, presentation attributes, inline/external
stylesheets, media/supports conditions, typed geometry and transforms are integrated.
Solid and paint-server fills/strokes, viewports, inherited paint, visibility and
isolated opacity produce premultiplied RGBA8 through the shared CPU `vector`
backend. `svg_cli` writes PNG; source XML, occurrence/computed-style trees and
display lists are public.

Integration checks exercise CSS precedence, reference geometry, projective
transforms, nested positive-w clipping, backface visibility and resource limits.
The actual CLI's CSS fixture matches its literal reference. A 256×64 projective
CLI smoke also matches an independent affine/polygon control with zero differing
pixels, including parent perspective and nested flattening boundaries. The CLI's
512×512 stylesheet workload (2,048 rules and rectangles) matches an independent
pixel control exactly; its benchmark checksum also agrees with resvg.
The integrated phase-4 SVG gate passes on macOS arm64 and Ubuntu 24.04 arm64.
These checks do not establish conformance for the full viewer.

The phase-4 structural fixtures match 12 literal pixel references exactly,
including shadow inheritance, symbol sizing, switch selection, foreign-content
boundaries and reference boxes, asymmetric overflow and projective viewport clips.
Fragment tests exercise `:target`, selected views, view-transform ordering, spatial
media fragments and malformed-fragment recovery. Actual CLI checks cover all four
processing modes, nested external uses and explicit fragment selection. The
512×512 repeated-instance workload, containing 1,024 nested symbol instances,
matches an independent integer-pixel control exactly. These are focused checks,
not a full conformance claim.

Phase 5 adds linear and two-circle radial gradients, reusable pattern pictures,
markers on equivalent shape paths, context paint, `paint-order`, host-space vector
effects and linear-RGB interpolation/compositing. Paint metadata and resource
children use computed CSS and the existing occurrence/reference machinery.
`pathLength` calibrates absolute dash distances using certified native path
metrics; viewport percentages remain unchanged. Numeric/resource refusal policies
and unresolved specification choices are recorded in [SPECIFICATIONS.md](SPECIFICATIONS.md#paint-and-vector-effect-interpretation-decisions).

The integrated dev.29 gate passes on macOS arm64, including 53 exact-RGBA
painting reftests. These cover gradient degeneracies, reusable/nested pattern
pictures and overflow, marker/context-paint placement, vector effects, painting
order, linear-RGB compositing and calibrated dashes. Nanounit geometry magnified
by a billion retains dash placement; signed-zero and unrepresentable period
arithmetic have dedicated regression coverage. No existing expectation was relaxed.

General clipping/masking, image decoding, filters, text, animation and ICC remain
required later work, not exclusions from scope. `shape-rendering` controls current
shape rasterization; computed image/text hints gain consumers in their own phases.
Parsing those properties does not implement their rendering.

## Packages

All are root workspace packages with the `svg_` prefix:

| Package | Responsibility |
| --- | --- |
| `svg_geometry` | f64 geometry, SVG path/points parsing, arcs, shape construction and transforms |
| `svg_xml` | Namespace-aware nonvalidating XML, UTF-8/UTF-16, bounded DTD/entity processing |
| `svg_css` | Tokenization, selectors, cascade/custom properties, typed computed values, conditions and stylesheet decoding |
| `svg_image` | Checked premultiplied RGBA storage and PNG encoding; decoding pending |
| `svg_core` | Document styling, exact source geometry and reference-box resolution; specification and limitation records |
| `svg_render` | Render tree to backend-neutral retained display list and public rendering entry point |
| `svg_raster` | Thin CPU executor over `vector`, not a second rasterizer |
| `svg_filters` | Filter evaluation boundary; implementation pending |
| `svg_cli` | Rendering command-line package |
| `svg_tests` | Conformance inputs, suite pins and reviewed expectations |
| `svg_bench` | Renderer workloads and measured baselines |

Nothing in the existing font/shaping/Unicode stack depends on an SVG package.
Font dependencies remain `font_types`, `read_fonts`, `harfrust` and `ucd`.
There is no silk-layout dependency.

`vector` (`images/svg/vector`) is the pure-Silk 2D core that `svg_raster` executes on.
Only that package is built: no WebGPU, Dawn, GPU driver or GPU backend is required.
Geometry, flattening, coverage, stroking, paints and layers belong to `vector`;
never copy its implementation into `svg_raster`.

## Setup and checks

Use the workspace's pinned Silk **0.1.0-dev.29+94cf9559bf47**, Python 3.11+, and
Clang 22 or newer. The [workspace setup](../../font/README.md#set-up) installs the Linux
CI toolchain. `SILK_CLANG` must be an absolute path; on macOS an LLVM 22 Homebrew
installation can supply `/opt/homebrew/opt/llvm@22/bin/clang`.

From the workspace root:

```sh
python3 -m venv images/svg/tests/.cache/venv
. images/svg/tests/.cache/venv/bin/activate
python3 -m pip install -r images/svg/scripts/requirements.txt
export SILK_CLANG=/absolute/path/to/clang
images/svg/scripts/check
font/scripts/generate --check
```

The SVG gate runs workspace type checking, the vector library build, package
format checks, SVG/vector native tests, tooling tests and a release CLI build.
It executes the CLI on own fixtures, malformed inputs and the curated resvg
subset, checking reviewed expectations rather than treating known pixel
non-passes as successes. Reports go under ignored `build/svg/`. Compiles are
sequential. Its CI job runs alongside the existing jobs with a 15-minute timeout,
version-keyed toolchain caching and hash-keyed reference caching.
`font/scripts/generate --check` remains the separate workspace freshness gate and
requires source changes to have been committed.

Use `images/svg/scripts/check --offline` after populating the caches. `--skip-fetch`
skips pinned-reference checks and the external corpus, not native/tooling tests
or the actual own/malformed rendering runs. Formatting uses one manifest per
package; a directory argument is outside its own `src/` selection in dev.27.

The phase-5 [GitHub Actions run](https://github.com/julia-script/read-fonts/actions/runs/40954264824)
passed all 11 jobs, including the workspace `font/scripts/generate --check` gate.
A separate [cold-cache run](https://github.com/julia-script/read-fonts/actions/runs/40954271867/job/123730154546)
passed the complete SVG job in **7m36s** on a fresh hosted Ubuntu 24.04 runner.
That verification branch disabled Silk, LLVM, pip, specification/suite and
encoding/IDNA cache restoration; pip also used `--no-cache-dir`. It was closed
without merging its workflow changes. Production CI retains its caches and
15-minute timeout.

## Specifications and suites

```sh
python3 images/svg/scripts/fetch-specs.py             # verify/fetch all 155 locked documents
python3 images/svg/scripts/fetch-specs.py --offline   # verify all cached original bytes
python3 images/svg/scripts/fetch-suites              # only 12 curated SVG/PNG pairs
python3 images/svg/scripts/reftests --validate       # schema, cache integrity and coverage; renders nothing
python3 images/svg/scripts/fetch-suites --suite resvg --full
python3 images/svg/scripts/fetch-suites --suite w3c-svg11 --full
python3 images/svg/scripts/fetch-suites --suite wpt --full
```

Caches live inside `images/svg/.cache/` and `images/svg/tests/.cache/`, never in source
control. Explicit `--update` refreshes pins; review changed hashes and upstream
revisions rather than accepting changed bytes during a normal build. Git suite
updates additionally require `--revision` with a full reviewed commit SHA.
Full suites, reference renderers, browser diffs, fuzzing and benchmarks do not
belong in PR CI; their scheduled rendering jobs arrive with the renderer.

`images/svg/tests/expectations/*.txt` contains JSON with `version`, `suite`, and a `cases`
array. Every case names `id`, `status`, `reason`, and an HTTPS normative `spec`
anchor. Status is `pass`, `fail`, `spec-difference` or `skip`; differences also
record `spec_result` and `reference_result`. Optional `tolerance` records channel
and differing-pixel limits plus a reason. `antialias_channel` applies only when
both samples have partial alpha; it does not forgive opaque/transparent changes.
It is opt-in per case, not a global tolerance for translucent artwork.
Missing/stale expectations, unexpected passes/failures, renderer crashes and
missing output fail the runner. `failed_cases` includes known pixel non-passes;
`gate_failures` counts unexpected results and untriaged cases. Remaining full-suite
cases are untriaged, not implicitly passing or added to the conformance skip list.

The adapter executes an explicitly supplied renderer without a shell:

```sh
python3 images/svg/scripts/reftests \
  --renderer '["/path/to/renderer", "{input}", "--width", "300", "-o", "{output}"]' \
  --expectations /path/to/reviewed-expectations.json \
  --report images/svg/tests/.cache/report.json
```

The resvg normal corpus scales to 300 pixels wide, preserving aspect ratio
([pinned upstream harness](https://github.com/linebender/resvg/blob/91455ee06d08ac2bfeab2b035ed2cfbfd0a68614/crates/resvg/tests/integration/main.rs)).
Supply that width in the renderer command; the adapter does not resize the PNG
after rendering or silently infer a different viewport. Other suites need their
own matching host viewport/font configuration.

It compares decoded RGBA samples, including alpha and dimensions. Multiple WPT
matching references are alternatives; every mismatch reference must differ.
`--diff-dir images/svg/tests/.cache/diffs` writes images only on unexpected failures.
WPT cases needing HTML/script or manual extraction are reported explicitly.
The Python Pillow dependency belongs only to this tooling, not the Silk runtime.

## Rendering API and CLI

```sh
silk build --release --manifest-path images/svg/cli/silk.toml
build/llvm/aarch64-apple-darwin/release/svg_cli input.svg -o output.png
build/llvm/aarch64-apple-darwin/release/svg_cli input.svg -o output.png --width 300 --zoom 2
build/llvm/aarch64-apple-darwin/release/svg_cli input.svg -o detail.png --fragment '#detail' --mode secure-static
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
or configure `Environment` directly.

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
only drawing data.
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

## Limitations and performance

[Limitations](LIMITATIONS.md) records dependency/toolchain and backend constraints.
No compiler or stdlib is patched. The phase-5 Ubuntu 24.04 arm64 baseline in
[`images/svg/bench/baseline.json`](bench/baseline.json) uses three native samples,
one iteration and no warmup, plus a separate Valgrind 3.22.0 Callgrind pass.
The VM has four CPUs and 8 GiB RAM; binaries use Silk dev.29, LLVM 22.1.8 and
Rust 1.96.0. The measured phase-5 snapshot is `76308c0`, before the subsequent
main-branch XML follow-up merge; the merged tree's CI evidence is above.
Ratios are Silk/resvg; greater than 1 is slower.

| Workload | Parse + record time | Render time | End-to-end time | Render-process Ir |
|---|---:|---:|---:|---:|
| 128 original icons | 10.865× | 2.058× | 5.029× | 4.121× |
| Tiger | 7.801× | 1.895× | 2.428× | 2.769× |
| Large map/CAD | 13.039× | 1.372× | 2.876× | 2.399× |
| Mixed curves | 8.649× | 3.867× | 5.142× | 4.149× |
| 2,048 stylesheet rules/rectangles | 0.653× | 0.538× | 0.659× | 0.436× |
| 1,024 nested symbol instances | 13.836× | 0.338× | 4.752× | 2.757× |
| Gradient/pattern mosaic | 7.379× | 2.706× | 3.208× | 2.663× |

This is **not performance parity**. Only the stylesheet and repeated-instance
workloads' pixel checksums agree with resvg; timing does not certify rendering
correctness. Both also passed independent exact pixel controls. The new 512×512
mosaic exercises four gradients, two reusable pattern pictures and 256 painted
geometries. An independent CLI/reference pixel probe reproduces both recorded
checksums: 46,490 of 262,144 pixels differ, with maximum channel delta 55.
No tolerance promotes that comparison to a passing conformance test.

A separate `images/svg/scripts/ab` run rebuilt phase-4 main `99bab0a` and phase 5 with
the same dev.29 toolchain and sampling configuration. The native vector pins are
`7cd08d5` and `9dba9b9`, respectively. These are full render-process instruction
counts, including untimed parsing:

| Workload | Phase 4 Ir | Phase 5 Ir |
|---|---:|---:|
| 128 original icons | 385,618,188 | 388,381,027 |
| Tiger | 361,408,642 | 362,210,240 |
| Large map/CAD | 678,334,381 | 683,235,524 |
| Mixed curves | 356,926,829 | 358,593,551 |
| 2,048 stylesheet rules/rectangles | 526,343,101 | 531,157,398 |
| 1,024 nested symbol instances | 579,997,547 | 591,311,867 |

Old/new pixel checksums agree for all six workloads and all three stages.
Phase 5 adds 0.22–1.95% to these full render-process instruction counts. The new
paint-server workload is excluded from A/B because phase 4 could not render it.
The three wall samples are noisy, not evidence of small speedups. Closing every
remaining performance gap is still required.

```sh
silk build --release --manifest-path images/svg/bench/silk.toml
images/svg/scripts/rust-bench/build
images/svg/scripts/bench --silk /path/to/release/svg_bench --fetch-workloads --output build/svg/bench.json
images/svg/scripts/ab /path/to/old/svg_bench /path/to/new/svg_bench --output build/svg/ab.json
```

The explicit Rust build pins resvg/usvg/tiny-skia to the corpus revision and
verifies registry packages against its upstream lock. It is not a production
dependency or a PR-CI step. `--record-baseline` is the only intentional baseline
replacement path. Tiger is an explicitly downloaded AGPL-3.0-or-later benchmark
input, never a runtime dependency; the original is preserved and both engines
receive the same hash-recorded 900×900 sizing adaptation.

Stage timers exclude file I/O, PNG encoding, checksums and destination
destruction; end-to-end includes intermediate-tree destruction. Render includes
a fresh zeroed pixmap in both engines. `--callgrind` on Linux separately records
**full-process Ir**, including startup, setup, warmups, checksums and the untimed
parse-result rasterization; it is not stage-only instruction accounting.
