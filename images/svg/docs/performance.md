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

## Phase 6 clipping checkpoint

Measured commit `f3be1c6` against the compositing renderer on the same Ubuntu 24.04 ARM64 VM and pinned Silk/LLVM 22 toolchain used above. Three native samples, one iteration, no warmup; Callgrind counts include the entire separate process, not only the render stage. The new deterministic clipping workload uses 64 translated groups with overlapping circular clips, nested object-bounding-box intersections and CSS polygon clips.

| Workload | Old process Ir | New process Ir | New/old Ir | Render checksum equal |
| --- | ---: | ---: | ---: | --- |
| clipping/render | 64,359,927 | 1,831,535,051 | 28.4577 | False |
| compositing/render | 506,523,215 | 506,898,509 | 1.0007 | True |
| iconset/render | 386,115,056 | 386,379,645 | 1.0007 | True |
| instances/render | 589,639,669 | 592,226,579 | 1.0044 | True |
| largemap/render | 681,391,004 | 682,547,773 | 1.0017 | True |
| mixedcurves/render | 358,734,483 | 358,538,860 | 0.9995 | True |
| paintservers/render | 286,347,263 | 286,363,652 | 1.0001 | True |
| stylesheets/render | 529,804,299 | 530,799,970 | 1.0019 | True |
| tiger/render | 362,358,377 | 362,128,684 | 0.9994 | True |

The clipping before/after ratio is not an equal-output speed comparison: the old renderer ignores these clips. Existing workloads retain their checksums.

| Clipping stage | Silk median ms | resvg median ms | Silk/resvg |
| --- | ---: | ---: | ---: |
| clipping/end-to-end | 107.3452 | 5.6965 | 18.8440 |
| clipping/parse | 2.7689 | 0.4166 | 6.6460 |
| clipping/render | 105.9303 | 5.3687 | 19.7310 |

Clipping output checksums differ from pinned resvg in all three modes; these measurements do not establish pixel conformance. The approximately 19.7× render-time gap remains open for phase 14. The evaluator currently builds full-size clip/layer surfaces and performs bounded geometric intersection work independently for each occurrence; profiling and caching/cropping work remain required. No tracked baseline or conformance tolerance was replaced.

## Phase 6 masking checkpoint

Measured masking snapshot `6c5408b` against main `a34ecd7` on the Ubuntu 24.04 ARM64 VM. Both binaries were rebuilt with Silk `0.1.0-dev.32+ebc526403637` and LLVM 22.1.8. Three native samples, one iteration, no warmup; separate Callgrind measurements count complete processes, including parsing and recording. The subsequent mask-root transform fix does not change this workload, which has no transform on its mask elements.

| Workload | Old process Ir | New process Ir | New/old Ir | Render checksum equal |
| --- | ---: | ---: | ---: | --- |
| clipping/render | 1,831,522,451 | 1,831,964,461 | 1.0002 | True |
| compositing/render | 506,891,939 | 507,503,980 | 1.0012 | True |
| iconset/render | 385,563,133 | 387,764,349 | 1.0057 | True |
| instances/render | 592,170,993 | 607,259,294 | 1.0255 | True |
| largemap/render | 682,541,423 | 687,665,152 | 1.0075 | True |
| masking/render | 63,389,777 | 4,933,716,518 | 77.8314 | False |
| mixedcurves/render | 358,532,338 | 360,423,407 | 1.0053 | True |
| paintservers/render | 286,332,159 | 287,050,108 | 1.0025 | True |
| stylesheets/render | 530,793,676 | 535,913,154 | 1.0096 | True |
| tiger/render | 362,122,324 | 363,305,922 | 1.0033 | True |

All nine pre-existing workloads retain their checksums. The masking workload uses 64 translated groups with nested object-bounding-box alpha and luminance masks. Its old/new ratio is not an equivalent-output speed comparison: the old renderer ignores masks. New rendering takes 272.788 ms median in this run; full-surface mask allocation, conversion, and composition remain performance work for phase 14.

The same snapshot was compared with the pinned resvg/usvg revision
`91455ee06d08ac2bfeab2b035ed2cfbfd0a68614` using identical inputs and sampling settings.

| Masking stage | Silk median ms | resvg median ms | Silk/resvg |
| --- | ---: | ---: | ---: |
| masking/end-to-end | 276.3355 | 11.8557 | 23.3082 |
| masking/parse | 3.0036 | 0.4921 | 6.1035 |
| masking/render | 272.8032 | 10.7761 | 25.3155 |

The output checksums differ in every mode, so these measurements do not establish pixel conformance. The 25.3× render-time gap remains open for phase 14. The reference measurement used a temporary baseline file; the tracked baseline and conformance tolerances were not changed.

## Phase 7 standalone PNG decoder checkpoint

Measured PNG snapshot `1605d54` against parent main `24262ac` on the same Ubuntu 24.04 ARM64 VM using Silk dev.32 and LLVM 22.1.8. Three native samples, one iteration, no warmup; separate Callgrind invocations count complete processes. The standalone decoder is not yet invoked by SVG rendering, so this checks existing-workload regressions rather than PNG throughput.

| Workload | Old process Ir | New process Ir | Render checksum equal |
| --- | ---: | ---: | --- |
| clipping/render | 1,831,958,390 | 1,831,958,377 | True |
| compositing/render | 507,501,309 | 507,501,314 | True |
| iconset/render | 387,399,293 | 387,402,109 | True |
| instances/render | 607,231,847 | 607,231,856 | True |
| largemap/render | 687,662,019 | 687,662,006 | True |
| masking/render | 4,933,695,779 | 4,933,695,788 | True |
| mixedcurves/render | 360,420,736 | 360,420,741 | True |
| paintservers/render | 287,034,819 | 287,034,802 | True |
| stylesheets/render | 535,910,699 | 535,910,704 | True |
| tiger/render | 363,303,101 | 363,303,088 | True |

All ten workloads retain identical output checksums. Full-process instruction changes are below 0.001%; these measurements make no claim about decoder throughput, image-rendering performance, or the open phase-14 performance targets.

Pinned-resvg comparison on the same machine and snapshot (render mode):

| Workload | Silk median ms | resvg median ms | Silk/resvg |
| --- | ---: | ---: | ---: |
| clipping/render | 113.2138 | 5.3628 | 21.1111 |
| compositing/render | 30.6002 | 5.4036 | 5.6629 |
| iconset/render | 9.3504 | 4.1675 | 2.2437 |
| instances/render | 3.1742 | 9.6238 | 0.3298 |
| largemap/render | 21.6169 | 15.5407 | 1.3910 |
| masking/render | 272.3610 | 11.1853 | 24.3498 |
| mixedcurves/render | 17.6009 | 4.7452 | 3.7092 |
| paintservers/render | 18.7912 | 6.8568 | 2.7405 |
| stylesheets/render | 1.5288 | 2.9873 | 0.5117 |
| tiger/render | 21.5213 | 11.8752 | 1.8123 |

Only stylesheet and instance checksums match resvg. This is the existing SVG workload comparison, not a PNG decoding benchmark. The tracked baseline was not overwritten, and the clipping/masking gaps remain phase-14 work.
