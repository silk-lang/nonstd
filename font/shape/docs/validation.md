# Validating font-shape

Run `font/scripts/check-shaping` for the shaping PR gate, or these individual commands
from the repository root with recursive submodules present:

```sh
silk test --release --manifest-path font/shape/silk.toml --root src/tests.silk
silk build --release --manifest-path font/shape/cli/silk.toml
build/llvm/x86_64-unknown-linux-gnu/release/hr_shape --suite font/shape/tests/shaping.bin
build/llvm/x86_64-unknown-linux-gnu/release/hr_shape --regressions
font/scripts/check-shaping-trace
font/scripts/check-shaping-malformed
```

There are **6,090 non-macOS data-driven cases** at this pin, all passing with
**no skip list**. The issue's approximate 12,400 count does not describe this
revision. The 129 tests in `macos.rs` and `macos_lazy_tables.rs` require Apple
system fonts and are excluded. Four additional long-input regressions exercise
attachment limits; six work-limit checks assert buffer length and success state. Ordinary tests cover public buffer operations, callbacks,
advances/scaling, Unicode, language/script mappings, feature parsing, reusable
plans, serialization, digests, AAT actions, extended lookups and variations.
Rust-specific ownership, raw-pointer batch ABI, lazy-cache internals and
Send/Sync assertions are replaced by native ownership and interface behavior.

`font/scripts/generate-shaping-tests` extracts upstream expectations into one binary
fixture. The seven upstream smoke cases also have exact differential assertions
in `tests/differential.json`; repeated strings are compressed there and expanded
by the generator. In particular these preserve work-limit results and malformed
AAT ligature behavior. The runner compares every byte, including long results.
Font bytes are read directly from the submodule, including in library tests.

PR CI uses a fourth parallel job with sequential compilation and reuses its
release runner for the suite, long inputs, tracing and malformed-input smoke
checks. No Rust harfrust build is required in PR CI. The weekly/manual baseline
builds the pinned Rust twin, compares all 6,090 inputs, mutates every corpus
font, and runs checksum-verified benchmarks:

```sh
cargo build --locked --release --manifest-path font/scripts/rust-hr-shape/Cargo.toml --target-dir build/harfrust-rust
font/scripts/compare-shaping
font/scripts/check-shaping-malformed --all-fonts --mutations-per-font 16
font/scripts/bench-shaping
font/scripts/bench-shaping --filter en-thelittleprince --iterations 1 --samples 1 --callgrind
```

On 2026-10-27 the differential check had **zero differences**, and the broad
smoke campaign passed **11,546 malformed fonts** and nine invalid CLI options.
These are deterministic regressions and bounded mutation checks, not a proof
that all possible malformed inputs are harmless. Failed mutations are saved
under `build/shaping-malformed-failures/` and uploaded by CI.
