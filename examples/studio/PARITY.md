# Native Studio parity contract

Reference: the browser Studio now packaged in `examples/studio/browser`.
Compare the same version-1 document, viewport (1440×960 and 1000×700),
camera, selection and interaction state. `tests/explorations.silkdesign` is the
browser's actual starter document. Platform window decorations and native file
pickers are platform adaptations. Cloud work remains excluded.

A passing compiler, GPU reference comparison or generic editing test does not
establish parity. Each item below needs a matched visual inspection and an
inspector-driven interaction where applicable. Unchecked items remain work.

- [x] Shell: typography, spacing, header/sidebar/inspector/footer geometry,
  disabled and hover states, tooltips, responsive panel sizing and hidden panels.
- [x] Pages and layers: active-page counts, names, hierarchy, collapse, truncation,
  search/empty state, Shift selection, per-layer lock/visibility actions.
- [x] Canvas: identical starter content, frame labels, all-selection dimensions,
  eight resize handles/cursors, marquee, dot grid, editable zoom, fit and pan.
- [x] Page inspector: name, grid/smart-guide switches, intro and quick actions.
- [x] Selection inspector: name, alignment, position/dimensions, multi-selection
  behavior and hints, appearance, color controls/palette, stroke, effects,
  drop/inner shadows, arrange and export.
- [x] Typography: family/weight dropdowns, size/content, double-click editing,
  commit and Escape cancellation.
- [x] File menu, searchable command dialog with Enter, shortcut dialog, backdrop,
  dismissal and focus behavior, local document switching.
- [x] Gestures and shortcuts: constrained resize, duplicate, smart guides,
  Shift selection, nudge, cut/copy/paste, ordering, undo/redo, zoom, panels.
- [x] Inspector: semantic state and input on the same dispatcher as native events;
  screenshots cover the inspected states, plus resize and empty-marquee sequences.
- [x] Regression: release contracts, GPU rendering, and 100k selection/bulk edits.

Visual comparison: same browser starter, fitted camera and matching 1440×960 and
1000×700 logical viewports. Reviewed page, shape, typography, command palette,
shortcuts, file menu, color picker, scrolled effect sections, multiple selection,
hidden panels and empty search. Native captures and semantic snapshots are
reproducible with `node examples/studio/scripts/parity-check` under `build/native-parity`.
The Node runner copies the fixture into a fresh temporary document for each
viewport, sends the same inspector input, retains screenshots/semantic snapshots,
and terminates the app before removing the temporary document. Use
`--app "$PWD/build/Silk Studio.app/Contents/MacOS/SilkStudio"` to exercise the
packaged launcher and its resource paths without opening a user design.

The native app now shares the browser composition, panel breakpoints, toolbar,
property sections, spacing, fitted text dimensions/baselines, page/frame labels,
selection geometry and command/shortcut layouts. Variable-font optical sizing
and per-instance glyph caching were corrected in the shared UI libraries.

Native adaptations and limits: Open/Save As use OS dialogs and ordinary local
files rather than browser storage; the color picker uses RGBA sliders. The native
scrollbars, font antialiasing and clipped long layer names differ from browser
scrollbars, rasterization and ellipsis. Those are not claims of pixel identity.
Native dialog automation covers their app triggers; OS file dialogs themselves
are outside the native UI inspector tree. Portable-file and export contracts
validate the document operations behind them. Cloud features are out of scope.

Validation on macOS arm64, 2026-11-03:

- Shared UI: 7 text tests; 22 tree/input/editing tests; 15 component tests. New
  regressions cover optical size, variable-weight glyph caching, backdrop clip
  and replay, and clicking after a hover-driven view change.
- Release editor contracts: hierarchy/history, input, smart guides and Alt bypass,
  selection bounds after undo, empty marquee redraw, portable documents,
  PNG/SVG export, high-zoom text, and 100k bulk edits.
- Inspector: commands, restored focus, layer flags and collapse, numeric/color
  edits, property scrolling, typography, cancellation, multi-selection/alignment,
  panels, pages and search at both viewport sizes. Keyboard sequences also cover
  cut/copy/paste, grouping/ungrouping, nudge, ordering and undo after selection
  changes. Captures go through the same composed scene as the editor, using ordinary pointer/key dispatch.
- Ten-frame empty-marquee and resize sequences, MCP PNG/timing response and
  transitions between populated and empty selection on the 100k page.
- GPU surface check: 2880×1920, mean absolute channel difference 0.00745/255
  against the CPU reference. CPU performance is recorded in PERFORMANCE.md.
