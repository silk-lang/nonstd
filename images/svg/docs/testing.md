# Testing the SVG implementation

## The gate

The gate needs Python 3.11+ with the Pillow version pinned in
`images/svg/scripts/requirements.txt`, and `SILK_CLANG` set to an absolute Clang 22 path. From
the repository root:

```sh
images/svg/scripts/check
font/scripts/generate --check
```

The SVG gate type-checks every SVG package and runs the vector library build, package
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

Before the move into nonstd, the phase-5 [GitHub Actions run](https://github.com/julia-script/read-fonts/actions/runs/40954264824)
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
