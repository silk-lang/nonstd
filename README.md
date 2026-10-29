# nonstd

Experimental Silk packages that live outside the standard library. Each one tests how far the
language goes for a kind of API. Nothing here is stable.

| Package | What it is |
| --- | --- |
| [`packages/cli`](packages/cli) | Declarative command-line parsing, planned during compilation |

Examples that use the packages are in [`examples`](examples).

## Layout

Packages are grouped by area. Each leaf folder is one Silk package, and every package is a member
of the root workspace.

| Area | Packages |
| --- | --- |
| `font/` | font parsing (`font/parse`) and text shaping (`font/shape`) |
| `gpu/` | WebGPU (`gpu/webgpu`) and Metal (`gpu/metal`) bindings |
| `images/` | SVG (`images/svg`) |
| `css/` | CSS layout (`css/layout`) and other CSS building blocks |
| `packages/` | packages headed for the standard library (`cli`) |

These areas are being filled by moving the code from julia-script/read-fonts,
julia-script/silk-gpu and silk-lang/silk-layout.

## Working in the workspace

The workspace and every member pin Silk `0.1.0-dev.29+94cf9559bf47` (`toolchains.lock.json`).
`scripts/install-silk` downloads it, checks it against the published checksums and prints its
`bin` directory. Silk also needs an LLVM 22 `clang`: set `SILK_CLANG` to it, or run
`scripts/install-llvm` to find or download one.

```sh
export PATH="$(scripts/install-silk):$PATH"
export SILK_CLANG="$(scripts/install-llvm)"
```

Project commands run inside a member directory:

```sh
cd packages/cli && silk test --root src/tests.silk
cd examples/greet && silk run -- --name Julia --times 2
```

To add a package, run `silk init <area>/<name> --lib` from the workspace root. It is added to
`members` in `silk.toml`.
