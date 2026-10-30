# silk-typescript (spike)

Import Silk functions from TypeScript. The types come from a TypeScript 7.1 content mapper,
and the code comes from a `wasm32-unknown-unknown` build made when the module is loaded:

```ts
import { add, fib, isPrime } from './math.silk'

const sum: number = add(2, 40) // pub fn add(a: i32, b: i32) -> i32
const big: bigint = fib(90)    // pub fn fib(n: u32) -> u64
```

This is an experiment. It needs TypeScript `7.1.0-beta`, Node 22.18 or newer, `silk` on `PATH`
(or `SILK` set to it) and Clang 22 with `wasm-ld` (`SILK_CLANG`).

## Try it

```sh
cd packages/typescript && npm install
cd example && npm install
npm test   # tsc check, run with Node, build with Vite, run the bundle
```

## How it works

Nothing in the compiler changed. Everything goes through commands Silk already has:

| Piece | File | What it does |
| --- | --- | --- |
| Content mapper | [`src/mapper.js`](src/mapper.js) | TypeScript starts it for each `.silk` file (JSON-RPC over stdio). It answers with `export declare function` lines, mapped back to the Silk source |
| Signatures | [`src/silk.js`](src/silk.js) | Copies the file into a scratch package and runs `silk doc` (public functions, parameter spans) and `silk check --json` (errors) |
| Type mapping | [`src/types.js`](src/types.js) | Integers and floats up to 32 bits are `number`, `i64`/`u64` are `bigint`, `bool` is `boolean` |
| wasm build | [`src/silk.js`](src/silk.js) | Appends an `export "C"` shim per public function and runs `silk build --target wasm32-unknown-unknown` |
| Glue | [`src/glue.js`](src/glue.js) | A JavaScript module with the wasm inlined and one wrapper per export |
| Node | [`src/register.js`](src/register.js) | `node --import silk-typescript/register app.ts` |
| Vite | [`src/vite.js`](src/vite.js) | `plugins: [silk()]` |

The project opts in from `tsconfig.json`:

```json
"contentMappers": [{ "package": "silk-typescript", "extensions": [".silk"] }]
```

`tsc` needs `--runExternalCode`; the language server takes `"runExternalCode": true` in its
initialization options (VS Code asks for workspace trust instead).

## What was verified

On x86-64 Linux with Silk `0.1.0-dev.33`, TypeScript `7.1.0-beta`, Node 22.22 and Vite 7.3:

- `tsc --noEmit --runExternalCode` on the example passes in 0.9 s.
- Wrong calls fail with normal TypeScript errors: a missing export (TS2305), `number` into a
  `string` (TS2322), `bigint` into a `number` (TS2322), a `string` argument (TS2345).
- A Silk error in `math.silk` is reported by `tsc` at the Silk line, for example
  `src/math.silk(43,12): error silk135: SEM0135: Operator + does not accept (i32, bool)`.
- Through the language server, hover on `fib` in `app.ts` shows
  `function fib(n: number): bigint` with the Silk doc comment, and go to definition lands on
  `fib` in `math.silk`.
- `node --import silk-typescript/register src/app.ts` builds and runs in 0.4 s. The module is
  3.4 KB.
- `vite build` bundles the same program into one 5.5 KB file that runs under Node.

## Limits

- **Scalars only.** Strings, records, lists, `Option` and `Result` need glue that copies through
  linear memory. A function using them is left out of the TypeScript view, with a comment saying
  why.
- **One file at a time.** Each `.silk` file is analyzed alone, so it can import the standard
  library but not sibling modules or package dependencies.
- **Slow per keystroke.** Every transform runs `silk check` and `silk doc` (about 0.4 s). A real
  version would ask the compiler once, from its incremental cache.
- **Silk errors hide TypeScript errors.** While a `.silk` file has errors, `tsc` reports only
  those, and type errors in the `.ts` files that import it come back once it is fixed.
- **Extensionless imports do not work** under `bundler` resolution in the 7.1 beta
  (microsoft/TypeScript#64546), so imports name `./math.silk`.

## Compiler or separate tool?

Separate, with one compiler change. The mapper, the glue and the bundler plugins are
JavaScript-side plumbing that should follow TypeScript and Vite releases, not Silk's. What belongs
in the compiler is one command that prints a package's exported signatures (types resolved,
byte spans included) from the incremental cache. That would replace `silk doc` plus the signature
parsing in `src/silk.js`, and the shim generation could become a build flag that exports
public functions to wasm.
