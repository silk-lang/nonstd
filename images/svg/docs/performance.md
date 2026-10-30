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

## Phase 7 standalone JPEG decoder checkpoint

Measured decoder snapshot `e0c9c40` on Ubuntu 24.04 ARM64 with Silk dev.32 and
LLVM 22.1.8. The A/B baseline binary was built at `1605d54`; its only difference
from parent main `a282ea1` is performance documentation. Three native samples,
one iteration, no warmup; separate Callgrind runs count complete processes.
JPEG decoding is not yet called by SVG rendering, so this comparison checks
existing renderer workloads rather than codec speed.

| Workload | Old process Ir | New process Ir | Render checksum equal |
| --- | ---: | ---: | --- |
| clipping/render | 1,831,973,363 | 1,831,973,359 | True |
| compositing/render | 507,509,097 | 507,509,128 | True |
| iconset/render | 388,403,837 | 388,404,477 | True |
| instances/render | 607,295,015 | 607,295,046 | True |
| largemap/render | 687,670,160 | 687,670,156 | True |
| masking/render | 4,933,710,656 | 4,933,710,668 | True |
| mixedcurves/render | 360,428,524 | 360,428,555 | True |
| paintservers/render | 287,070,870 | 287,070,853 | True |
| stylesheets/render | 535,919,081 | 535,919,112 | True |
| tiger/render | 363,310,924 | 363,310,920 | True |

All ten checksums match and process instruction changes are below 0.001%.
Native medians varied by up to about 10%; these short samples do not establish
an equivalent throughput change. Pinned resvg/usvg revision
`91455ee06d08ac2bfeab2b035ed2cfbfd0a68614`, measured on the same VM:

| Workload | Silk median ms | resvg median ms | Silk/resvg |
| --- | ---: | ---: | ---: |
| clipping/render | 111.7690 | 5.3416 | 20.9244 |
| compositing/render | 30.6655 | 5.1902 | 5.9084 |
| iconset/render | 7.5067 | 3.9706 | 1.8906 |
| instances/render | 3.1880 | 9.4913 | 0.3359 |
| largemap/render | 21.0360 | 15.4865 | 1.3583 |
| masking/render | 280.0987 | 10.9029 | 25.6904 |
| mixedcurves/render | 17.0469 | 4.8633 | 3.5052 |
| paintservers/render | 19.1106 | 6.6225 | 2.8857 |
| stylesheets/render | 1.5162 | 2.8442 | 0.5331 |
| tiger/render | 20.0217 | 10.2720 | 1.9491 |

Only stylesheet and instance checksums match resvg. Existing clipping/masking
performance and pixel differences remain open; the tracked baseline and
conformance expectations were not changed.

The separate `images/svg/scripts/bench-jpeg` harness builds the exact image
sources as a temporary executable package. It times fresh decoding after loading
the input, then hashes every output byte after timing and destroys the image.
The original 512×384 inputs come from `image/tests/jpeg_benchmark_fixtures.py`;
three fresh-process samples each use five measured decodes and one warmup.
Complete-process Callgrind counts below instead use one decode and no warmup,
and include startup, file I/O, hashing and destruction. No ICC transform or
orientation is timed. The baseline/progressive pairs produce equal checksums.

| Input | Bytes | Median ms/decode | Process Ir | Output checksum |
| --- | ---: | ---: | ---: | --- |
| L-baseline.jpg | 53,206 | 3.9206 | 72,353,667 | 13556602978170945557 |
| L-progressive.jpg | 42,390 | 4.8272 | 81,825,421 | 13556602978170945557 |
| RGB-baseline.jpg | 129,157 | 9.8238 | 150,399,912 | 17310860685485942489 |
| RGB-progressive.jpg | 115,572 | 12.1438 | 167,084,452 | 17310860685485942489 |

These codec results have no previous Silk JPEG implementation or native JPEG
reference timing to compare against. They are a reproducible initial measurement,
not proof of the phase-14 resvg target or JPEG pixel conformance. Reproduce with:

```sh
python3 images/svg/image/tests/jpeg_benchmark_fixtures.py build/svg/jpeg-inputs
SILK_CLANG=/absolute/path/to/clang images/svg/scripts/bench-jpeg \
  build/svg/jpeg-inputs/*.jpg --callgrind --output build/svg/jpeg-codec.json
```

Pillow is needed only to regenerate the original input fixtures. The benchmark
runner uses the Python standard library; its JSON includes hashes of each input
and the measured binary, native samples and checksums. Omit `--callgrind` on macOS.

## Phase 7 compressed-document checkpoint

Snapshot `237a6cb`, Silk dev.32/LLVM 22.1.8, Ubuntu 24.04 ARM64. The baseline
`1605d54` differs from parent main `a282ea1` only in performance documentation.
Three samples, one iteration, no warmup. The timed stage is parse+record; separate
Callgrind counts include complete processes and output rendering/hashing.

| Workload | Old process Ir | New process Ir | Parse+record new/old |
| --- | ---: | ---: | ---: |
| clipping/parse | 1,863,826,908 | 1,863,827,179 | 0.9601 |
| compositing/parse | 548,511,995 | 548,512,205 | 0.9810 |
| iconset/parse | 649,769,413 | 649,785,925 | 1.0095 |
| instances/parse | 1,150,920,191 | 1,150,920,339 | 1.0200 |
| largemap/parse | 1,005,919,339 | 1,005,919,762 | 1.0185 |
| masking/parse | 4,967,166,368 | 4,967,166,638 | 1.1623 |
| mixedcurves/parse | 476,221,611 | 476,221,757 | 0.9967 |
| paintservers/parse | 338,759,011 | 338,759,545 | 0.7791 |
| stylesheets/parse | 1,039,136,476 | 1,039,132,361 | 1.1541 |
| tiger/parse | 444,422,218 | 444,422,361 | 1.0289 |

All ten rendered checksums are unchanged. The maximum full-process instruction
increase is below 0.003%. Native timings are short samples and include scheduler
variation; no speedup is inferred from small differences.

Pinned resvg/usvg `91455ee06d08ac2bfeab2b035ed2cfbfd0a68614`, existing uncompressed
workloads and the prior reference feature configuration:

| Workload | Silk median ms | resvg median ms | Silk/resvg |
| --- | ---: | ---: | ---: |
| clipping/parse | 2.9182 | 0.4586 | 6.3629 |
| compositing/parse | 4.2975 | 0.3118 | 13.7850 |
| iconset/parse | 24.2750 | 2.2568 | 10.7563 |
| instances/parse | 122.1529 | 5.7400 | 21.2808 |
| largemap/parse | 41.5908 | 2.7855 | 14.9309 |
| masking/parse | 3.2245 | 0.5039 | 6.3989 |
| mixedcurves/parse | 12.4338 | 1.3395 | 9.2821 |
| paintservers/parse | 5.3697 | 0.7440 | 7.2169 |
| stylesheets/parse | 53.9725 | 74.0969 | 0.7284 |
| tiger/parse | 9.3200 | 1.2022 | 7.7524 |

Only stylesheet and instance checksums match the reference, as in the earlier
checkpoints. The tracked baseline and conformance tolerances were not changed.

A separate run compresses the exact generated `largemap.svg` input with gzip and
zlib. Three samples each use five measured parse+record iterations and one warmup.
Each engine's compressed-output checksum must equal its own plain-input checksum.
The reference harness now enables resvg's `svgz` feature; the first attempted
reference run explicitly rejected gzip because that feature had been disabled.
The benchmark build still enforces the pinned upstream registry versions/hashes.

| Engine/input | Input bytes | Median ms parse+record | Complete-process Ir |
| --- | ---: | ---: | ---: |
| silk/plain | 163,569 | 27.4340 | 1,005,650,075 |
| silk/gzip | 17,986 | 28.0524 | 1,052,887,416 |
| silk/zlib | 18,323 | 28.2409 | 1,055,887,443 |
| resvg/plain | 163,569 | 2.6655 | not collected |
| resvg/gzip | 17,986 | 2.7833 | not collected |

Both engines retain their plain-input checksum for gzip; Silk also retains it for
zlib. The pinned reference rejects a bare zlib document, which is recorded as
unsupported rather than a timing sample. Cross-engine pixel equality is not
claimed for this workload. Parsing, XML, CSS and geometry dominate these totals;
they are not isolated inflater-throughput measurements. Existing phase-14 targets
remain open.

Reproduce the compressed-input comparison after building both release benchmarks:

```sh
python3 images/svg/bench/compressed.py \
  --silk /path/to/images-svg-bench --rust /path/to/svg-reference-bench \
  --input images/svg/bench/.cache/workloads/largemap/largemap.svg \
  --callgrind --output build/svg/compressed-input.json
```

JSON records input and binary hashes, all native samples and output checksums.
Callgrind uses one iteration and zero warmup in separate runs and includes setup,
parsing, rendering, hashing and destruction. Omit it on hosts without Valgrind.

### Raster image integration

PNG/JPEG `<image>` loading and retained sampling were measured on the same
Linux ARM64 VM with dev.32 and LLVM 22.1.8. The A/B below isolates renderer
snapshot `085bb87` against `92c0ad9` (compressed documents plus JPEG codecs),
using three fresh-process samples, one parse+record iteration, no warmup, and
separate full-process Callgrind runs. Every output checksum remained identical.
The later data-URL correction has no input in these 138 workload SVG files
(they contain no data URLs); the unrelated main-branch cmap optimization is
also excluded from this isolation. Wall times are noisy shared-VM observations;
Ir is the regression measure. The tracked baseline was not replaced.

| Workload | Old Ir | Image integration Ir | Ir change | Old parse+record ms | New ms |
|---|---:|---:|---:|---:|---:|
| clipping | 1,863,818,283 | 1,863,985,808 | +0.009% | 2.773 | 3.031 |
| compositing | 548,509,457 | 548,731,873 | +0.041% | 3.845 | 4.384 |
| iconset | 649,437,253 | 650,719,208 | +0.197% | 21.624 | 21.571 |
| instances | 1,150,868,416 | 1,152,453,435 | +0.138% | 70.540 | 76.767 |
| largemap | 1,005,917,101 | 1,006,953,070 | +0.103% | 31.462 | 32.438 |
| masking | 4,967,157,708 | 4,967,301,204 | +0.003% | 4.143 | 3.473 |
| mixedcurves | 476,219,009 | 476,712,391 | +0.104% | 10.603 | 10.443 |
| paintservers | 338,732,028 | 338,978,647 | +0.073% | 5.135 | 4.951 |
| stylesheets | 1,039,134,399 | 1,040,664,198 | +0.147% | 59.091 | 84.993 |
| tiger | 444,419,652 | 444,670,607 | +0.056% | 6.798 | 6.496 |

The pinned resvg benchmark now explicitly enables `raster-images` as well as
`svgz`; its Git revision and registry versions/checksums remain unchanged.
The existing-workload reference comparison uses the same sample configuration.
It does not claim identical outputs where earlier geometry/paint differences remain.

| Workload | Silk parse+record ms | resvg ms | Silk/resvg | Equal checksum |
|---|---:|---:|---:|---|
| clipping | 3.107 | 0.437 | 7.112 | no |
| compositing | 4.495 | 0.320 | 14.029 | no |
| iconset | 24.968 | 2.290 | 10.902 | no |
| instances | 80.696 | 6.772 | 11.916 | yes |
| largemap | 38.589 | 3.348 | 11.525 | no |
| masking | 2.918 | 0.505 | 5.780 | no |
| mixedcurves | 12.472 | 1.302 | 9.582 | no |
| paintservers | 5.823 | 0.765 | 7.616 | no |
| stylesheets | 48.746 | 74.623 | 0.653 | yes |
| tiger | 8.153 | 1.224 | 6.661 | no |

`bench/images.py` generates original 512×384 grayscale-block PNG/JPEG inputs,
with either one image or 64 references to the same data URL. The following
measurement uses `a8d7ca1`, including the forgiving-Base64 fix and main rebase,
with one iteration, zero warmup and three alternating fresh-process samples.
All four inputs have equal Silk/resvg output checksums in every measured stage.

Silk decodes once while constructing the retained tree and reuses samples;
[pinned resvg decodes raster bytes while rendering each image](https://github.com/linebender/resvg/blob/91455ee06d08ac2bfeab2b035ed2cfbfd0a68614/crates/resvg/src/image.rs#L159).
Consequently parse and render timings include different work; end-to-end cost
is the comparable total. Full-process Ir includes startup, input loading and
checksum work, and must not be read as stage-only instructions.

| Input | Silk parse ms | resvg parse ms | Silk render ms | resvg render ms | Silk total ms | resvg total ms | Total Ir Silk/resvg |
|---|---:|---:|---:|---:|---:|---:|---:|
| jpeg-1.svg | 1.605 | 0.015 | 3.463 | 1.268 | 5.278 | 1.299 | 6.745 |
| jpeg-64.svg | 3.712 | 0.975 | 3.185 | 11.102 | 6.975 | 12.189 | 0.897 |
| png-1.svg | 2.997 | 0.008 | 3.219 | 1.949 | 6.353 | 1.733 | 6.665 |
| png-64.svg | 4.406 | 0.337 | 3.277 | 43.895 | 7.271 | 43.976 | 0.243 |

Single-image total cost remains slower than resvg and belongs to phase 14.
Shared decoded assets make the repeated-image cases cheaper; this is a measured
cache benefit, not a claim of overall renderer parity or complete image conformance.
The retained CPU executor currently copies each decoded asset into its backend
pixmap once per execution; removing that copy is an open performance opportunity.

Reproduction (the input generator needs Pillow; the measurement runner uses only
Python's standard library):

```sh
python3 images/svg/bench/images.py --generate build/svg/image-bench-inputs
python3 images/svg/scripts/rust-bench/build
silk build --release --manifest-path images/svg/bench/silk.toml
python3 images/svg/bench/images.py --inputs build/svg/image-bench-inputs \
  --silk build/llvm/aarch64-unknown-linux-gnu/release/images-svg-bench \
  --rust images/svg/scripts/rust-bench/target/release/svg-reference-bench \
  --iterations 1 --warmup 0 --samples 3 --callgrind \
  --output build/svg/images-measured.json
```

The JSON includes binary/input hashes, native samples, output checksums and full
process instruction counts. Reports remain ignored build artifacts.
