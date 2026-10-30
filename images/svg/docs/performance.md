# SVG performance

[Limitations](../LIMITATIONS.md) records dependency/toolchain and backend constraints.
No compiler or stdlib is patched. The phase-5 Ubuntu 24.04 arm64 baseline in
[`images/svg/bench/baseline.json`](../bench/baseline.json) uses three native samples,
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
images/svg/scripts/bench --silk /path/to/release/images-svg-bench --fetch-workloads --output build/svg/bench.json
images/svg/scripts/ab /path/to/old/images-svg-bench /path/to/new/images-svg-bench --output build/svg/ab.json
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

## Phase 6 compositing A/B

The compositing implementation at `548f98e` was measured against main `d243855` on the
existing Ubuntu 24.04 arm64 VM, using Silk dev.31 and LLVM 22.1.8.
Three wall samples use one iteration and no warmup. Separate Callgrind runs
measure full render-process instructions, including untimed parsing and recording.
The seven existing workloads retain identical old/new pixel checksums.

| Workload | Before Ir | After Ir |
| --- | ---: | ---: |
| iconset | 385,448,176 | 385,772,656 |
| tiger | 362,173,949 | 362,355,491 |
| largemap | 680,584,639 | 681,387,988 |
| mixedcurves | 358,436,563 | 358,731,712 |
| stylesheets | 529,005,603 | 529,802,409 |
| instances | 587,324,322 | 589,606,064 |
| paintservers | 286,226,163 | 286,328,795 |

The added `compositing` workload draws 64 nested opacity/isolation groups across
all 16 blend modes. Its old/new checksums differ because the base renderer ignores
blending and explicit isolation; its A/B ratio is therefore not a regression
comparison for equivalent rendering. References for the new behavior are the
19 exact-pixel cases in `tests/fixtures/compositing/manifest.json`.

The same dev.31 binary was compared with resvg/usvg at the pinned revision
`91455ee06d08ac2bfeab2b035ed2cfbfd0a68614`, using identical workloads and the same
sampling settings. Ratios below are Silk/resvg median wall time. Pixel checksums
match only for the stylesheet and instance workloads; the ratios do not establish
conformance or performance parity.

| Workload | Parse + record | Render | End to end |
| --- | ---: | ---: | ---: |
| iconset | 10.859× | 1.962× | 4.982× |
| tiger | 5.885× | 1.994× | 2.424× |
| largemap | 10.050× | 1.291× | 2.821× |
| mixedcurves | 7.838× | 3.713× | 4.611× |
| stylesheets | 0.571× | 0.528× | 0.588× |
| instances | 11.255× | 0.331× | 3.903× |
| paintservers | 6.572× | 2.780× | 3.091× |
| compositing | 12.123× | 5.909× | 5.856× |
