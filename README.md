# nonstd

Experimental Silk packages that live outside the standard library. Each one tests how far the
language goes for a kind of API. Nothing here is stable.

| Package | What it is |
| --- | --- |
| [`packages/cli`](packages/cli) | Declarative command-line parsing, planned during compilation |

Examples that use the packages are in [`examples`](examples).

## Working in the workspace

The workspace and every member pin Silk `0.1.0-dev.20+10a8c67813a1`. Install it with:

```sh
curl -fsSL https://raw.githubusercontent.com/silk-lang/silk/main/install.sh | SILK_RELEASE='v0.1.0-dev.20+10a8c67813a1' sh
```

Project commands run inside a member directory:

```sh
cd packages/cli && silk test --root src/tests.silk
cd examples/greet && silk run -- --name Julia --times 2
```

To add a package, run `silk init packages/<name> --lib` from the workspace root. It is added to
`members` in `silk.toml`.
