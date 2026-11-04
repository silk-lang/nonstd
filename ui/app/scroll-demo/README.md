# Fieldnotes Scroll Lab

A native scrolling stress demo built on `ui-app`, `ui-tree`, `css-layout`, `ui-text`,
and the shared GPU renderer. Every section stays mounted. There is no application
virtualization, canvas painter, or screenshot of the document.

The document mixes wrapped paragraphs, headings, sticky section labels, two-column
image grids, captions, tables, callouts, and code blocks. Section heights vary.
Bundled fonts and twelve bundled PNG/JPEG images keep runs deterministic and offline;
the images repeat, so this measures document rendering rather than loading thousands
of unique image resources.

## Run

From the repository root, using Python 3.11 or newer:

```sh
python3 ui/app/scroll-demo/scripts/run
python3 ui/app/scroll-demo/scripts/run --sections=1000 --profile
python3 ui/app/scroll-demo/scripts/run --bundle  # macOS
```

The default is 100 sections. Buttons select 100, 1,000, or 10,000 sections and toggle
images. Use the wheel/trackpad or **Auto scroll**; **Reverse** changes the direction.
The automatic pass injects ordinary wheel input at 5,000 CSS pixels per second,
capping each time step at 50 ms. It stops advancing at the document boundary; reverse
or pause it there. Resize the window to exercise text reflow and grid layout.

The 10,000-section option deliberately goes beyond the comfortable range of the
current libraries. Construction and each scroll frame can block the UI. Start with
100 sections, then increase it. The command line accepts `--sections=1` through
`--sections=10000`.

The bundle is `build/Fieldnotes Scroll Lab.app`. `--profile` prints the standard
window host's frame timings, including upload, draw, and presentation submission.
These are CPU timings around those stages, not GPU completion times or measured FPS.

## Measure

Build once, then run the same document headlessly through the real wheel dispatcher,
runtime event pump, layout engine, text system, and painter:

```sh
python3 ui/app/scroll-demo/scripts/run --build-only
python3 ui/app/scroll-demo/scripts/measure --sizes 100 1000
python3 ui/app/scroll-demo/scripts/measure --sizes 100 1000 --steps 8 --phases \
  --directory build/scroll-lab-phases
python3 ui/app/scroll-demo/scripts/measure --sizes 10000 --steps 4 --timeout 600 \
  --directory build/scroll-lab-10000
```

The normal benchmark measures the first mount, then 120 wheel/frame pairs: 60 down
by 96 CSS pixels and 60 up, at 1280 × 900 CSS pixels and device scale 2. It verifies
that every requested section is mounted, that the wheel moves the scroll container,
and that the reverse pass returns to the top. There are no discarded warm-up samples.
These passes revisit the first part of the document; they measure the effect of total
document size on local scrolling, not traversal of every section.

Each run saves raw logs and `results.json`, with median, p95, and maximum durations,
node/fragment counts, paint counts, and layout-skipped counts. CPU results exclude
native accessibility, the event loop, GPU work, and presentation. A 16.7 ms CPU result
alone does not establish 60 FPS.

`--phases` explicitly resolves layout before calling `frame` to isolate layout from
the remaining frame work. This changes the frame entry state; compare these runs
only with other phase runs. In this mode `layoutSkippedFrames` counts the subsequent
frame calls, not the separately measured layout work. Mount logs also separate app
construction from the first frame.

## Check rendering

```sh
python3 ui/app/scroll-demo/scripts/run --sections=100 --check
```

The native check clicks **Reverse**, verifies **Forward** appears, scrolls the document,
and compares the GPU readback with the shared CPU reference using the window host's
existing tolerance. It exits after the check. Run on a desktop with a supported GPU.

See [measurements](measurements/README.md) for the initial findings and captured runs.
