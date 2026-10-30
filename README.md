# nonstd

Silk libraries that live outside the standard library: fonts, text, CSS, images and GPUs. They
are grouped by area, and every package is a member of one workspace that pins Silk
`0.1.0-dev.32+ebc526403637` (`toolchains.lock.json`). Nothing here is stable yet.

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

## Working in the workspace

The workspace builds into `build/` at the root. Commands run from the root unless a README says
otherwise:

```sh
silk test --manifest-path packages/cli/silk.toml --root src/tests.silk
silk run --manifest-path examples/greet/silk.toml -- --name Julia --times 2
```

Each area has its own gate script and CI workflow, for example
`images/svg/scripts/check`, `gpu/webgpu/scripts/check` and `css/layout/scripts/check`.

To add a package, run `silk init <area>/<name> --lib` from the root. It is added to `members` in
`silk.toml`.
