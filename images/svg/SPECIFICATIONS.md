# SVG specifications and conformance policy

## Authority

Normative requirements win over Chrome, Firefox, resvg, and other renderer observations. A mismatch is a reason to investigate, never permission to replace a specification-derived expected result. This is an original implementation, not a port. The policy follows silk-layout's Authority model, without copying its implementation.

The target is SVG 1.1 Second Edition's **Conforming Static SVG Viewer** (`SVG-static`) plus the language features of `SVG-animation`, and SVG 2's **Conforming SVG Viewer** in static, secure static, animated, and secure animated modes. The [SVG 1.1 viewer requirements](https://www.w3.org/TR/2011/REC-SVG11-20110816/conform.html#ConformingSVGViewers), [feature strings](https://www.w3.org/TR/2011/REC-SVG11-20110816/feature.html#SVG-static), and [SVG 2 processing modes](https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#processing-modes) define that boundary. Dynamic interactive mode is excluded, not the apparently browser-like static viewer requirements: CSS syntax and required properties, the UA stylesheet, PNG/JPEG/SVG images, gzip/deflate, data URLs, alpha compositing, and image resampling remain required.

SVG 2 CR 2018-10-04 and its separately pinned Editor's Draft are both references. Follow an ED correction to a CR defect only with the exact ED anchor and an explanation in the regression test and this document. Draft status is not blanket permission to change behavior. Record ambiguities with the relevant SVGWG/CSSWG issue, the chosen interpretation, and a regression test. Later CSS modules override only the provisions they replace. SVG 2 painting is normative; CSS Fill and Stroke 3 is informative and is not a substitute.

## Implementation status

Phase 1 established the package boundaries, pinned inputs and check tooling.
Phase 2 implements namespace-aware nonvalidating XML, presentation values,
outermost viewport sizing, paths/basic shapes, affine resolution, retained
fill/stroke/layer commands, the vector CPU executor, PNG encoding and the CLI.
Local tests and actual rendering results are summarized in [README.md](README.md).
The first shape-heavy resvg timing baseline is measured, not a parity claim.

Phases 1–4 are merged. Phase 5 integrates paint servers, marker pictures, vector
effects, dash calibration and painting controls. The section-level checklist
still reserves check marks for merged, fully covered requirements: partial
implementation of a broad item does not complete it. Images, filters, text,
animation and ICC remain later work. Pinned documents and fetched corpora are
not coverage, and the current renderer is not a full-conformance claim.

### CSS authority and current integration

The CSS package implements tokenization, selectors, cascade/custom properties,
typed values, computation, conditions and external stylesheet decoding. The
core stylesheet catalog resolves conditional imports, keeps namespace bindings
local to each sheet and retains winning declaration base URLs. The renderer now
consumes this computed state, including CSS geometry and reference-box transforms.
A standalone executable exercised conditional `data:` imports and namespace
isolation; the actual CLI CSS fixture matches its reference with zero differing
pixels. Projective geometry now uses the upstream backend, and an actual CLI smoke
matches independent projected polygons and affine controls pixel-exactly. This
is not a completed styling-conformance claim.

Two corrections use the pinned SVG 2 Editor's Draft styling chapter
(`dbbc1f8bcb1a3b05777d1ec03dac8040738b02941142018e44e2e02dad691195`):

- [Presentation attributes](https://svgwg.org/svg2-draft/styling.html#PresentationAttributes)
  precede author stylesheets. The CR's “following all other author-level style
  sheets” is corrected to “followed by all other author-level style sheets.”
- [The UA stylesheet](https://svgwg.org/svg2-draft/styling.html#UAStyleSheet)
  uses `white-space-collapse`, not the CR's obsolete `text-space-collapse`.
  The pinned CSS Text 4 longhands and shorthand expansion govern this property.

The pinned [Selectors 4 `:empty`](https://www.w3.org/TR/selectors-4/#empty-pseudo)
allows document whitespace. XML ID selectors use DTD-declared ID attributes
and SVG's unqualified `id`, rather than guessing that any XML attribute named
`id` has type ID. Font matching, ICC transforms, font-face loading and animation
remain their later rendering phases; parsing a value does not implement those
rendering effects.

### Structural rendering and reference policy

Phase 4 separates owned source documents from light/shadow occurrences. Styles
inherit through occurrence parents; selectors see their own tree scope and a
featureless shadow host. Source declarations are compiled once, then matched
and computed per occurrence in a shared value/path arena. External rule sets
cannot leak into the including document. Normal/important encapsulation
precedence follows [CSS Cascade 4](https://www.w3.org/TR/css-cascade-4/#cascade-sort);
tests exercise external and nested shadow scopes.

[SVG 2 use processing](https://www.w3.org/TR/2018/CR-SVG2-20181004/struct.html#UseShadowTree)
creates shadow trees even for hidden/non-rendering sources. Active ancestry
detects cycles without rejecting independent instances of the same source.
`href` wins over `xlink:href` by presence, including an empty or invalid value.
XML Base governs attribute URLs; redirects establish external document bases.
HTTP(S) requests and redirects must preserve the including document's origin;
file/custom-scheme access remains host policy. Secure modes reject external
requests before host fetch. Templates are secure-static, while cloned content
uses the including document's mode, as required by
[referencing modes](https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#referencing-modes).

The following interpretation choices are explicit:

- [Switch selection](https://www.w3.org/TR/2018/CR-SVG2-20181004/struct.html#SwitchElement)
  always uses SVG 2's `allowReorder=yes` semantics. Ordered host-language matches
  outrank unconditional fallbacks; document order breaks ties. Eligibility uses
  conditional attributes, never `display`, visibility or renderability.
  `requiredFeatures` is ignored under the chosen SVG 2 conflict policy.
- Symbol `refX`/`refY` accept number/length/percentage/math and their axis keywords.
  The CR/ED table's length-only grammar conflicts with its percentage prose;
  [SVGWG #64](https://github.com/w3c/svgwg/issues/64) supports viewBox-relative
  percentages, and [#1137](https://github.com/w3c/svgwg/issues/1137) retains the
  keywords. Percentages use viewBox dimensions, without adding its minima.
  An absent reference coordinate is not an explicit zero.
- Non-scrolling `overflow:auto` is visible, per
  [the pinned SVG rule](https://www.w3.org/TR/2018/CR-SVG2-20181004/render.html#OverflowAndClipProperties),
  notwithstanding [SVGWG #329](https://github.com/w3c/svgwg/issues/329).
  Computed overflow longhands are evaluated independently; viewport clips are
  physical polygons, not transformed axis-aligned bounds. Legacy `clip` uses
  [SVG 1.1 user-space rectangles](https://www.w3.org/TR/2011/REC-SVG11-20110816/masking.html#ClipProperty).
- CSS local-fragment provenance remains attached to the declaration's source
  document through inheritance; it is distinct from XML Base and stylesheet
  base URLs. External-use URL freezing follows SVG's source-document rule.
  [CSSWG #3320](https://github.com/w3c/csswg-drafts/issues/3320) records the
  tree-scoping interaction. Typed provenance tests cover this distinction;
  paint-server consumers belong to the next phase.
- Ordinary IDs set `:target` before styling without pruning sibling content.
  Selected `view` parameters override the root individually. `svgView` applies
  viewBox before its independent transform; spatial media percentages use the
  resolved SVG size. Invalid explicit views fall back atomically to the root.
  Parameter whitespace is accepted, structural whitespace rejected, following
  [SVGWG #1170's resolution](https://github.com/w3c/svgwg/issues/1170) of the
  grammar/prose conflict. Percent decoding precedes SVG view grammar; media
  dimension delimiters are recognized before decoding.

Unknown SVG elements render as generic containers under the pinned CR.
Foreign private subtrees do not render; `foreignObject` establishes a containing
block and clipping, allowing nested SVG through non-SVG wrappers without
implementing HTML layout. Metadata remains in the source-document arena.


### Conditional Rules 3 general-enclosed reference

The pinned [Conditional 3 grammar](https://www.w3.org/TR/css-conditional-3/#typedef-supports-in-parens)
links `<general-enclosed>` to a removed Values 4 definition
([CSSWG #14689](https://github.com/w3c/csswg-drafts/issues/14689)).
We use the [2022 CR's reference](https://www.w3.org/TR/2022/CR-css-conditional-3-20220113/#typedef-supports-in-parens)
to [Media Queries 5's production](https://www.w3.org/TR/mediaqueries-5/#typedef-general-enclosed):
`[ <function-token> <any-value>? ) ] | [ ( <any-value>? ) ]`.
Only the grammar is borrowed: [Conditional 3's evaluation rule](https://www.w3.org/TR/css-conditional-3/#at-supports)
requires **false**, not MQ5's `unknown`. Thus `selector(svg)` is false and
`not selector(svg)` is true; this does not adopt Conditional 4 selector queries.
`supports_tests.silk::generalEnclosedIsFalseNotSelectorSupport` covers that choice.

### Bounding-box ambiguity

The pinned [SVG 2 bounding-box algorithm](https://www.w3.org/TR/2018/CR-SVG2-20181004/coords.html#BoundingBoxes)
initializes its accumulator to `(0,0,0,0)` before unions, which would spuriously
include the origin. [SVGWG #422](https://github.com/w3c/svgwg/issues/422) records
this unresolved inconsistency. We use an empty accumulator, return `(0,0,0,0)`
only when no geometry contributes, and retain positioned zero-area geometry.
Groups measure actual transformed descendant curves, not transformed child AABBs.
Opacity and visibility do not remove geometry; non-rendered descendants do.
Renderer regressions cover nested transformed quadratic extrema and a zero-width
rectangle at a nonzero position. Stroke boxes union object geometry with the
undashed stroke, regardless of paint opacity.



### XML error and resource policy

Malformed XML rejects the complete document; no partial render tree is returned.
This follows [SVG 2 error processing](https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#ErrorProcessing),
rather than SVG 1.1's optional render-up-to-error behavior. SVG path-data errors
remain distinct: valid segments before the first invalid tuple are retained.
External DTDs/entities are never fetched. Nonvalidating skipped external content
is exposed by the XML document API; external entity references in attributes
are rejected. Metadata, comments, processing instructions and foreign-namespace
data are retained, not treated as rendering elements.

Default XML ceilings are 16 MiB input, 64 MiB retained storage, 8 MiB charged
entity expansion, one million nodes/attributes/declarations, element depth 256
and entity depth 32. `parseWithLimits` can lower them; hard recursion ceilings
remain. Error offsets address normalized decoded UTF-8, except decoding errors,
which address original input bytes. The renderer defaults to 16,000,000 output
pixels and caps aggregate output/isolated surfaces at 67,108,864 pixels.
These are implementation resource limits, not claims that larger SVGs are invalid.

Source expansion additionally defaults to 32 documents, one million occurrences,
64 reference levels, 128 external requests, 64 MiB of source bytes and 64 MiB of
retained URL serializations. Composed occurrence depth has a hard 256-edge ceiling
with root depth zero; hosts can lower it, not bypass it. This bounds rendering
recursion even when shallow, acyclic source documents compose deeply through `use`.
Budget exhaustion is a render error, not a missing reference or truncated tree.

## Baseline integrity

`specs.lock.json` is the machine-readable standards baseline: **155 fetched documents**. Each record contains its original URL (`url`), redirect-resolved URL (`resolved`), and SHA-256 of the original downloaded bytes (`sha256`). No rewriting or text extraction precedes hashing; PDF references remain PDF bytes. The catalog in `../scripts/svg/fetch-specs.py` includes complete documents and individual SVG 1.1, SVG 2 CR/ED and CSS 2.1 chapters.

From the workspace root:

```sh
python3 images/svg/scripts/fetch-specs.py
python3 images/svg/scripts/fetch-specs.py --offline
python3 images/svg/scripts/fetch-specs.py --only svg2-coords svg2-paths svg2-conform
python3 images/svg/scripts/fetch-specs.py --update
python3 -m unittest discover -s images/svg/scripts/tests -p test_specs.py
```

Normal runs verify cached bytes and fetch only missing entries. A corrupted cache or changed upstream bytes fails closed and never changes the lock. Remove a corrupt cache entry explicitly before retrying. Offline runs never contact the network and fail on missing entries. `--only ID ...` bounds the gate's fetches without weakening verification of the selected documents; it cannot be combined with `--update`. `--lock PATH` and `--cache PATH` support isolated tooling use.

Only explicit `--update` downloads the complete catalog and publishes a new lock, atomically, after all downloads succeed. Review that diff as a standards-baseline change, not routine maintenance. A failed update leaves the old lock intact. Content-addressed files at `.cache/specs/<sha256>` retain earlier pinned bytes even across updates; the cache is gitignored. Mutable URLs may stop serving an older pin, so preserve the cache in CI or local storage. A cold fetch after upstream changes must fail rather than silently follow the new text. Redirect destinations are provenance; unchanged bytes at a new redirect destination do not silently rewrite the baseline.

Tests cite an exact locked original URL with a real `#anchor`, such as [SVG 2 coordinate systems](https://www.w3.org/TR/2018/CR-SVG2-20181004/coords.html#InitialCoordinateSystem). Find its `url` record in the lock and read `.cache/specs/<sha256>` for the pinned copy. The unversioned `/TR/SVG2/` shortcut is not equivalent to the dated CR citation. Tooling integrity tests cite this policy as their behavioral contract and the locked normative conformance section as their scope; an SVG specification does not itself mandate our SHA-256 CLI. Downloaded documents retain their publishers' licenses and are not part of the MIT/Apache-2.0 library distribution.

### Reference coverage

| Area | Locked IDs / reference family |
|---|---|
| SVG 1.1 | `svg11`, `svg11-errata`, and `svg11-*` chapter pages, including conformance, features, coordinates, paths, animation, fonts, color, filters, and implementation notes |
| SVG 2 | `svg2` (2018 CR), `svg2-ed`, and corresponding `svg2-*` / `svg2-ed-*` chapter pages, including conformance, structure, styling, coordinates, painting, text, embedding, linking, and changes |
| Filters, masking, blending | `filter-effects-1`, `css-masking-1`, `compositing-1`; Filter Effects 1 includes the legacy background appendix |
| Transforms | `css-transforms-1`, `css-transforms-2` |
| Styling | `css-syntax-3`, `css-cascade-4`, `selectors-4`, `css21` and its syntax/error-handling and property chapters, `css-namespaces-3`, `mediaqueries-4`, `css-conditional-3`, `css-variables-1`, `css-shadow-1` |
| Values and images | `css-values-3`, `css-values-4`, `css-color-4`, `css-images-3` (including EXIF orientation policy) |
| Text | `css-fonts-4`, `css-text-3`, `css-text-decor-3`, `css-writing-modes-3`, `css-inline-3`, `css-shapes-1`; `unicode-uax9`, `unicode-uax14`, `unicode-uax24`, `unicode-uax29`, `unicode-uax50` |
| Animation | `svg11-animate`, `smil-animation`, `svg-animations-2`, `css-animations-1` (pinned in preparation; implementation scope still subject to the phase-11 decision) |
| Integration | `svg-integration`, `svg2-conform` sub-resource modes, `smil-content` conditional-language ordering, `media-frags` |
| XML and resources | `xml`, `xml-names`, `xmlbase`, `xlink11`, `rfc2397`, `url`, `rfc1950`, `rfc1951`, `rfc1952` |
| Image and color formats | `png-3`, `jpeg-t81` (baseline and progressive JPEG), `jpeg-jfif`, `icc-v4` |

The optional Filter Effects 2 / `backdrop-filter` reference is deliberately absent. Cascade 5 `@layer` is not selected for phase 1. Pinning Selectors 4 does not promote its stretch features to completed coverage. JPEG EXIF orientation follows CSS Images 3; the lock does not claim to include a separate CIPA EXIF document. Unicode annex snapshots record their own revisions; `ucd` owns its Unicode data baseline, and consistency between those revisions and `ucd` must be checked in the text phase rather than inferred from the annex URL.

## Exact skip list

This is the handoff section 2.1 boundary, not an implementation-status list. Section numbers below refer to the corresponding locked specification. “Network fetching” is delegated, not omitted.

| Skipped | Why | Spec |
|---|---|---|
| Scripting: `<script>`, event attributes (`onclick`, `onload`, …), any script execution | Disabled in every non-dynamic mode | SVG 2 §15.8–15.9, SVG 1.1 ch. 18 |
| The SVG DOM: all `SVG*Element` interfaces, IDL, `SVGAnimated*`, DOM bindings | Only meaningful with script | SVG 2 §4.3–4.7 and every "DOM interfaces" section, SVG 1.1 App. B–E |
| User interaction: events, pointer-events delivery, focus, `tabindex`, cursor (incl. the 1.1 `cursor` element), text selection and clipboard, link traversal | "Interaction" is disabled in all four modes | SVG 2 §15, §11.12, §16.2 activation, SVG 1.1 ch. 16 |
| Zoom and pan UI, `zoomAndPan`, `currentScale`/`currentTranslate` | UI behaviour | SVG 1.1 §5.1.2, §16.7 |
| Event-based animation timing: `begin="click"`, `accessKey(...)`, `repeat(n)` event values, hyperlink-started animation, `beginElement()` | Needs user input or the DOM. Treat such a begin value as an unresolved time, as SMIL does for events that never fire | SMIL Animation §3.6.6, SVG 1.1 §19.2.8 |
| HTML embedding: SVG inside HTML parsing rules, the HTML `link` element for style sheets, style sheets of an enclosing HTML document, HTML metadata elements | Requires an HTML engine | SVG 2 §6.3, §6.4, §5.9 |
| Non-SVG content of `<foreignObject>` (HTML, MathML), and HTML `audio`, `video`, `canvas`, `iframe` elements in SVG | Requires an HTML/media engine. Render nothing for that content, but still honour the element's own geometry, `<switch>` selection and any SVG content nested inside | SVG 2 §12.4, §12.1 |
| Network fetching | Not skipped, delegated: the host supplies a resolver (section 6.4). The default resolves files under a base directory and `data:` URLs only | SVG 2 §2.2.1, §16.1 |
| Accessibility API mappings (WAI-ARIA, title/desc exposure) | No accessibility tree. Keep `title`, `desc`, `metadata` and ARIA attributes in the document tree and expose them through the API, but don't map them | SVG 2 §5.12, App. C |
| Dynamic CSS pseudo-classes `:hover`, `:active`, `:focus`, `:focus-visible`, `:visited` | Never match without interaction. `:link` matches `<a href>`. `:target` matches when the host renders with a fragment identifier | Selectors 4 |
| CSS Transitions | Only triggered by style changes, which need script or interaction | SVG 2 §2.2.1 lists them under declarative animation, but nothing in a static document starts one |

Not on the skip list, though it's tempting: SVG fonts (1.1 ch. 20), `color-profile` and ICC colour (1.1 ch. 12), `enable-background` with `BackgroundImage`/`BackgroundAlpha` (1.1 §15.6, Filter Effects 1 App. A), `<switch>` with `systemLanguage` (the host supplies the user's languages), `<view>` and `#svgView(...)` fragment identifiers (they choose what to render, which is applicable when the host passes a fragment), `<a>` (it renders its children; only activation is skipped), `pointer-events` (computed and exposed, used by an optional hit-test API in the last phase), CSS Animations (they run at load in animated modes; see question 4), `@font-face` with local or `data:` sources, and `@media` queries against the viewport size and host-supplied preferences.

## SVG 1.1 versus SVG 2

Implement removed SVG 1.1 requirements additively where they do not conflict: SVG fonts and their child elements, `altGlyph` family, `tref`, `color-profile` and `icc-color()`, `enable-background`, `clip`, `kerning`, `glyph-orientation-*`, `filterRes`, `requiredFeatures`, `xml:base`, and `xlink:*`. Check the [SVG 2 changes appendix](https://www.w3.org/TR/2018/CR-SVG2-20181004/changes.html) against the older normative section when each feature is implemented.

For genuine behavior conflicts, default to SVG 2. Do not introduce a speculative profile switch. If that rule cannot resolve a real case, ask Julia before adding a document-level `Profile { svg11, svg2 }`, defaulting to `svg2`. Mesh gradients, hatches, `solidcolor`, and `z-index` are outside the pinned CR scope unless Julia requests them.

The table is a register of cases to test, not a claim of complete rendering support. No implemented behavior currently needs a profile switch.

| Feature | SVG 1.1 rule | SVG 2 rule / conflict to verify | Applies |
|---|---|---|---|
| `requiredFeatures` / `switch` | Evaluate supported feature strings | Attribute removed; SVG 2 mandates language-priority reordering | SVG 2: ignore `requiredFeatures`; tested conditional selection |
| `use` instances | Deep-cloned instance model | Shadow trees and different selector matching | SVG 2; tested host inheritance, scoped matching and external templates |
| Markers on shapes | Paths, lines, polylines, polygons | Markers extended to shapes | SVG 2; equivalent-path vertex/tangent placement, including basic shapes |
| `overflow` on `symbol`, `marker`, `pattern` | Check element and clipping rules | SVG 2 element rules and UA stylesheet | Viewport and resource-local clips; visible pattern overflow follows the policy below |
| `symbol` geometry | No SVG 2 geometry properties | `x`, `y`, `width`, `height`, `refX`/`refY` supported | SVG 2; tested used instance dimensions and reference coordinates |
| `version` | SVG 1.1 version metadata | Ignored in SVG 2 | Retained by XML; ignored by the phase-2 resolver |
| Radial focal geometry | Focal point constrained to the outer circle | `fr` and two-circle geometry, including external focal circles | SVG 2; explicit shrinking, tangent, coincident and external-cone fixtures |

### Browser and resvg differences

The pinned resvg revision is `91455ee06d08ac2bfeab2b035ed2cfbfd0a68614`.
At the suite's 300-pixel reference width, all six curated rectangle cases match
RGBA exactly. Six circle cases remain strict pixel-reference non-passes:
696–1,518 pixels differ per case with the phase-3 renderer. All observed
differences lie within one pixel of a color or alpha edge in both images;
constant-color interiors away from those edges agree. Missing/negative radii
correctly suppress the circle. Per-case counts and reasons are retained in
`images/svg/tests/expectations/resvg.txt`; none is silently skipped.

Phase 3 changes the shared vector geometry/precision path and therefore these
edge samples. Compared with phase 2, all six cases have fewer differing pixels
and lower maximum alpha differences (42–54 rather than 65–91). Their `fail`
statuses and exact comparison tolerances are unchanged. This refresh records
measured output, not a new exemption or a claim of resvg-equivalent coverage.

[SVG 2 rendering accuracy](https://www.w3.org/TR/2018/CR-SVG2-20181004/conform.html#ConformingSVGViewers)
permits antialiasing and requires one-device-pixel spatial accuracy. Therefore
exact PNG disagreement alone does not establish a normative geometry defect.
The circle results remain recorded pixel non-passes pending the full conformance
sweep's reviewed comparison/precision decisions, not assertions of a resvg bug.

Own round-cap and round-join equivalent-outline cases use a per-case
`antialias_channel` allowance of 80 only where both samples have partial alpha.
The budget derives from the pinned vector stroker's 0.0625-pixel chord tolerance
plus the 0.25-pixel filled-path tolerance, rounded upward to 8-bit coverage.
Opaque/transparent transitions and ordinary channel tolerance remain exact.
This is a comparison policy for these opaque edge fixtures, not a license to
ignore errors in translucent fills or to apply a global 80/255 tolerance.

### Decisions deferred to their implementation phases

Julia chose full 4×4 composition followed by flattening to the SVG plane for
non-perspective 3D transforms. The handoff's flattening-only profile does not
retain `preserve-3d` rendering contexts; that is a profile choice, not a claim
that the property is inapplicable to SVG. CSS Transforms 2
[explicitly includes SVG transformable elements](https://drafts.csswg.org/css-transforms-2/#svg-three-dimensional-functions).
The renderer composes the parent's `perspective` property with the child's full
matrix before flattening. Projective geometry uses upstream homogeneous-w
clipping, including intermediate positive-w halfplanes for nested flattening;
it is never silently approximated by an affine matrix. Upstream inverse
projective paints are available for the later SVG paint-server/image phases.

The pinned backface algorithm's m33 test has an acknowledged defect:
[CSSWG issue 917](https://github.com/w3c/csswg-drafts/issues/917). We use the
inverse-transpose normal's z sign, including perspective, rather than projected
winding or m33 alone. Thus `scaleX(-1)` mirrors a front face while `rotateY(180deg)`
turns it away; singular full 4×4 matrices, including `scaleZ(0)`, paint nothing.
The issue also leaves arbitrary negative-perspective interpretations unresolved;
this profile consistently uses the inverse-normal rule for those matrices.

The checklist's “question 4” means whether CSS Animations join SMIL (ask in
phase 11). Julia confirmed SVG 2 defaults without a `Profile` API for phase 4.
For phase 5, Julia deferred mesh gradients, hatches and `solidcolor`; revisit
them in the optional-feature phase. GIF/WebP wait for phase 7, and ICC depth
for phase 12. These decisions are not reasons to omit mandatory reference pins.
HTML/media engines, GPU backends, demos and optional hit testing are not silently added.

### Paint and vector-effect interpretation decisions

The pinned CR's [`vector-effect` host rules](https://www.w3.org/TR/2018/CR-SVG2-20181004/coords.html#VectorEffectProperty)
retain `viewport` (the immediate SVG viewport) and `screen` (root content CSS
pixels, before output scaling). Stroke width, dash lengths and dash offset all
use the chosen stroke-host coordinate system; see
[SVGWG issue 323](https://github.com/w3c/svgwg/issues/323).

[SVGWG issue 2448](https://www.w3.org/Graphics/SVG/WG/track/issues/2448)
leaves vector effects inside patterns and markers undefined. Effects on their
contents use the resource's local drawing surface as their host, before the
resource-placement transform. This makes a pattern a repeatable paint rather
than a different drawing at every repetition. This does **not** create a new
SVG viewport for percentage lengths: the pinned
[`ElementsThatEstablishViewports`](https://www.w3.org/TR/2018/CR-SVG2-20181004/coords.html#ElementsThatEstablishViewports)
explicitly excludes patterns and markers, even with `viewBox`. Their
attribute-specific percentage rules (for example marker reference points)
still apply. Separately, a non-scaling stroke on the **marked shape** makes
its `markerUnits="strokeWidth"` markers use that shape's stroke-host space.

For an exactly antiparallel marker join, choose the incoming tangent rotated
clockwise by 90 degrees; the bisector is otherwise ambiguous
([SVGWG issue 333](https://github.com/w3c/svgwg/issues/333)).

For `overflow:visible` patterns, render every overlapping tile permitted by
the resource limits, left-to-right within top-to-bottom rows. Do not truncate
overflow to the eight neighboring tiles. This follows the encouragement in
[`PatternNotes`](https://www.w3.org/TR/2018/CR-SVG2-20181004/pservers.html#PatternNotes)
while its normative result remains unresolved
([SVGWG issue 129](https://github.com/w3c/svgwg/issues/129)).

Pattern definitions retain a resource-local drawing, an origin-zero physical tile
and conservative painted-content bounds. Their handles address the owning
render tree/display list's shared path, paint, dash and clip arenas; backend
textures are not public scene data. Bounds include strokes, non-scaling strokes,
markers and nested pictures. A finite two-axis tile clip bounds even an
unbounded positive-w centerline without requiring its unclipped bounds. Legacy
`clip` may retain overflow outside the physical tile. A valid empty resource
paints nothing; it neither selects URL fallback paint nor allocates a texture.

The CPU executor caches native textures by resource and adequate sampling size,
uses a conservative projective Jacobian bound over the finite destination, and
wraps every bilinear sample tap. `RenderOptions.maxPixels` also caps cumulative
cached pattern pixels; the occurrence budget caps repeated picture-command work.
Combined temporary-surface limits and active-resource checks still apply.
Excessive dimensions, overflow copies or nested allocations fail explicitly,
rather than lowering sampling quality or silently dropping tiles.

[`pathLength`](https://www.w3.org/TR/2018/CR-SVG2-20181004/paths.html#PathLengthAttribute)
is non-inherited geometry metadata. Invalid or negative values are unspecified.
Absolute distance terms in dash math are calibrated in the stroke's coordinate
space; percentage distances retain their nearest SVG viewport basis, including
inside mixed `calc()` expressions. Dimensionless ratios are not distances.
Normal strokes measure source geometry; non-scaling strokes measure the chosen
host centerline, before output zoom. Metrics cover every contour and close
segment and are cached by path/host mapping. The native measurement reports its
certified uncertainty; calibration refines it to at most `0.0001` coordinate
units and one part per million of the certified lower length bound. This keeps
tiny source paths accurate when magnified without coupling the metric to output
zoom. A zero estimate with nonzero uncertainty is refined, not treated as empty.
At most eight metric calls are permitted; unbounded projective length, underflow,
or unattainable precision (including extremely small returning curves) produces
`InvalidGeometry` rather than an uncalibrated or incorrectly solid stroke.

For author length zero, follow the positive-scale limit described by
[SVGWG issue 81](https://github.com/w3c/svgwg/issues/81) and
[issue 383](https://github.com/w3c/svgwg/issues/383): zero distances stay zero,
positive absolute distances become infinite, and percentages stay finite.
Resolve the periodic offset before taking limits, so an offset of one complete
period does not become `Infinity/Infinity`. Keep finite prefix intervals and cap
transitions; replace only a terminal infinite interval with a guard beyond the
entire measured path. Do not approximate zero with an arbitrary small author
length. An infinite offset against a finite percentage-only period uses the
largest finite representable position permitted by issue 81.

The zero-author evaluator limits polynomial degree to 64 and coefficient work to
131,072 operations. Unrepresentable coefficient arithmetic is an explicit
numeric refusal, not rounded phase selection; for example `(2^53+1)S` must not
silently become `2^53 S`. An unbounded period quotient has no limiting phase;
quotients beyond exact integer selection (`2^52`) also fail explicitly.
Signed zero and NaN remain internal CSS math values until the outer used-value
boundary; division by negative zero must not select the positive-infinity
`min()`/`max()` branch.

`color-interpolation:linearRGB` controls both gradient interpolation and alpha
compositing, including opacity groups; output storage remains premultiplied
sRGB RGBA8. Context paint exists only for actual `use`/marker membership, not
merely because an element references a paint server. Rendering-hint parsing
remains separate from image/text consumers in their later implementation phases.


### Compositing groups

The [SVG compositing rules](https://www.w3.org/TR/compositing-1/#svgcompositing)
and [isolation property](https://www.w3.org/TR/compositing-1/#isolation) govern
backdrop boundaries. Explicit isolation, opacity below one, non-normal blending,
and specified 3D transforms create transparent intermediate surfaces. A specified
3D identity retains this boundary even when its flattened matrix is affine;
ordinary 2D transforms do not create a boundary. The retained `BlendMode` enum
maps to the shared vector compositor only at execution. Group opacity applies
once when the surface is composited into its parent.

Clip-path resource geometry and CSS basic shapes now feed retained boolean clip
nodes. CSS Masking 1 #the-clip-path requires isolation even for an unresolved URL;
#ClippingPaths requires child unions and nested intersections independent of paint.
These are checked with literal-geometry reftests, including antialiased shared edges.
The phase checklist remains open pending the remaining clipping cases and gates.

Masking, filters and their additional isolation behavior remain under
implementation; these tests do not complete the combined coverage item below.

## Section-level coverage checklist

Use this as the coverage map. Each line becomes tests before code. ✓ means done in a merged PR. Keep it updated in `SPECIFICATIONS.md`, not in a separate progress file. Section numbers are SVG 2 unless marked 1.1.

### 5.1 Document structure and syntax
- [ ] XML 1.0: elements, attributes, namespaces, CDATA, comments, PIs (ignored except `xml-stylesheet`, which loads a sheet through the resolver), character and entity references, internal DTD subset entity declarations (common in Illustrator files), external DTD not fetched, BOM and UTF-8/UTF-16 decoding
- [ ] Foreign namespaces and private data kept but not rendered (§5.10, 1.1 §23)
- [ ] `svg` element: outermost and nested, `x`/`y`/`width`/`height`, `viewBox`, `preserveAspectRatio`, auto sizing (§5.1, §8.3, §8.12 intrinsic sizing), `version`/`baseProfile` ignored
- [ ] `g`, `defs`, `symbol` (incl. SVG 2 `x`/`y`/`width`/`height`, `refX`/`refY`), `use` with shadow trees, inheritance into instances, CSS matching inside instances, `use` → external file through the resolver (§5.2–5.5)
- [ ] Conditional processing: `switch`, `systemLanguage` (BCP 47 matching against host languages), `requiredExtensions`, 1.1 `requiredFeatures` (§5.6, 1.1 §5.8)
- [ ] `desc`, `title`, `metadata` kept in the tree (§5.8)
- [ ] Common attributes: `id`, `class`, `style`, `lang`, `xml:lang`, `xml:space` (with its 1.1 text behaviour), `tabindex` parsed only, `xml:base` (1.1) (§5.11)
- [ ] Error handling: invalid attribute values make the attribute behave as unspecified (SVG 2 §2.4.6 and per-attribute rules), non-rendering elements, unknown elements

### 5.2 Styling (§6)
- [ ] `style` element with `type` and `media`; `@import`, `@media`, `@supports`, `@namespace`, `@font-face`, `@keyframes` (if CSS Animations), unknown at-rules skipped per CSS Syntax 3
- [ ] Selectors 3 in full (type, class, id, attribute selectors incl. namespaces, structural pseudo-classes, combinators, `:not`, `:lang`, `:root`, `:first-child` …), static Selectors 4 additions, specificity
- [ ] Cascade: origins, `!important`, `inherit`, `initial`, `unset`, `revert`, custom properties and `var()` with fallback and cycle detection, inheritance of every property per its definition
- [ ] Presentation attributes for every property in SVG 2 §6.6's table, plus the 1.1-only ones (`enable-background`, `clip`, `kerning`, `glyph-orientation-*`, `color-profile`) and SVG 2 geometry properties (`cx`, `cy`, `r`, `rx`, `ry`, `x`, `y`, `width`, `height`, `d`) (§6.6, §7)
- [ ] Required properties (§6.7) and the user agent style sheet (§6.8)
- [ ] Values: lengths with all CSS units, percentages, numbers, `calc()` family, angles incl. `turn`, colours (all CSS Color 4 syntaxes: hex, `rgb()`/`hsl()`/`hwb()`/`lab()`/`lch()`/`oklab()`/`oklch()`/`color()`, named colours, `transparent`, `currentColor`, system colours, 1.1 `icc-color()`), `url()`, paint values, lists, the 1.1 attribute grammars (§4.2, 1.1 ch. 4)

### 5.3 Coordinate systems (§8, 1.1 ch. 7)
- [ ] Initial viewport and coordinate system from the host size, `width`/`height`/`viewBox` (§8.3, §8.4)
- [ ] `transform` attribute and property: all functions, the attribute's comma/whitespace grammar, `transform-origin`, `transform-box`, CSS Transforms 1 serialization rules (§8.5)
- [ ] `viewBox` + `preserveAspectRatio` (all align/meetOrSlice combinations, `defer` on `image`, degenerate boxes disable rendering) (§8.6, §8.7)
- [ ] Nested viewports and `overflow`/clip on `svg`, `symbol`, `marker`, `pattern`, `image`, `foreignObject` (§8.8, 1.1 §14.3)
- [ ] Units and percentages (diagonal normalisation for `r` etc.) (§8.9)
- [ ] Bounding boxes: object, stroke, decorated (§8.10); `objectBoundingBox` units incl. zero-size boxes (§8.11)
- [ ] `vector-effect`: `non-scaling-stroke` and the SVG 2 at-risk values (`non-scaling-size`, `non-rotation`, `fixed-position`) (§8.13, §13.6)

### 5.4 Paths and shapes (§9, §10)
- [ ] Path data grammar exactly as specified, incl. error recovery (render up to the error, §9.5.4/1.1 F.2), compact arc flags (`a1 1 0 00.5.5`), implicit commands
- [ ] Arc conversion and out-of-range radii (App. B.2), zero-length segments, `Z` then non-move commands
- [ ] Path directionality and `pathLength` (§9.4, §9.6)
- [ ] `d` as a property (SVG 2)
- [ ] `rect` (incl. auto `rx`/`ry` rules), `circle`, `ellipse` (`auto` radii), `line`, `polyline`, `polygon` (odd point counts) as equivalent paths (§10)
- [ ] Distance along a path, used by markers, `textPath`, `animateMotion` and dashing (§9.6)

### 5.5 Painting (§13, 1.1 ch. 11)
- [ ] Paint: `none`, colours, `url()` with fallback, `context-fill`/`context-stroke` (markers and `use`), `currentColor` (§13.2, §13.3)
- [ ] `fill`, `fill-rule`, `fill-opacity` (§13.4)
- [ ] Stroke: width, caps, joins incl. `miter-clip` and `arcs` (SVG 2), miter limit, dashes (incl. odd counts, negative, zero-sum, percentages, `pathLength` scaling), the exact stroke-shape definition (§13.5.7), zero-length subpaths with round/square caps
- [ ] Markers: `marker` element, `markerUnits`, `refX`/`refY` incl. SVG 2 keywords, `orient` incl. `auto-start-reverse`, `viewBox`, clipping, `marker-start/mid/end`, the `marker` shorthand, markers on all shapes (§13.7)
- [ ] `paint-order` (§13.8)
- [ ] `color-interpolation` for gradients and compositing (§13.9)
- [ ] Rendering hints: `shape-rendering` (`crispEdges`, `optimizeSpeed` → no AA), `text-rendering`, `image-rendering` (incl. `pixelated`/`crisp-edges` from CSS Images 3), `color-rendering` (§13.10)
- [ ] Rendering model: painter's order, group rendering and isolation, `opacity`, `visibility` vs `display`, parent compositing (§3)

### 5.6 Paint servers (§14, 1.1 ch. 13)
- [ ] `linearGradient`, `radialGradient` incl. focal point outside the circle, `fr` (SVG 2), `gradientUnits`, `gradientTransform`, `spreadMethod` pad/reflect/repeat, `href` inheritance of attributes and stops
- [ ] `stop` with `offset` clamping and ordering, `stop-color`, `stop-opacity`
- [ ] `pattern`: units, `patternContentUnits`, `viewBox`, `patternTransform`, `href` inheritance, overflow, nested patterns
- [ ] Degenerate cases: zero-length gradient vectors, single stop, bounding-box units on zero-size boxes (each has a defined result)

### 5.7 Text (§11, 1.1 ch. 10, ch. 20)
- [x] `text`, `tspan`, `x`/`y`/`dx`/`dy`/`rotate` lists and their inheritance across tspans (§11.2)
- [ ] The SVG 2 text layout algorithm (§11.5) step by step: CSS-laid-out "addressable characters", per-character absolute positioning, `textLength`/`lengthAdjust`, anchored chunks and `text-anchor`, bidi reordering (via `ucd`), `rotate`
- [x] White space: SVG 2 `white-space` and 1.1 `xml:space` (§11.10.3, 1.1 §10.15)
- [ ] Pre-formatted (§11.6) and auto-wrapped text: `inline-size`, `shape-inside` and `shape-subtract` (done), `shape-padding`, `shape-margin`, CSS Text 3 line breaking via `ucd` (§11.4, §11.7)
- [x] `textPath`: `href` and the SVG 2 `path` attribute, `startOffset`, `method`, `spacing`, `side`, glyph midpoints off the path end (§11.8)
- [x] Fonts and glyphs: font matching, synthetic bold/oblique per CSS Fonts 4, fallback per cluster, `font-variant-*`, `font-feature-settings`, `font-kerning`, 1.1 `kerning`, `font-size-adjust`, `font-variation-settings` (§11.1.2)
- [x] Baselines: `dominant-baseline`, `alignment-baseline`, `baseline-shift` incl. `sub`/`super`, 1.1 values (CSS Inline 3)
- [x] Vertical text: `writing-mode` (CSS and 1.1 values), `text-orientation`, 1.1 `glyph-orientation-vertical`/`-horizontal`, UAX #50 (§11.10)
- [x] `letter-spacing`, `word-spacing`, `direction`, `unicode-bidi`
- [x] Text decoration with SVG fill/stroke of decorations and their painting order (§11.11, §11.9)
- [ ] Text bounding boxes and painting order (fill, stroke, markers not applicable) (§11.9)
- [ ] 1.1 only (done except `vkern`, `lang` selection, glyph child elements and external SVG fonts): `tref`, `altGlyph` family, SVG fonts (`font`, `glyph`, `missing-glyph`, `hkern`/`vkern`, `font-face` + `font-face-src`/`-uri`/`-name`, arabic-form and `lang` glyph selection, `unicode-range`) (1.1 §10.17, ch. 20)
- [ ] `a` inside text (§16.2)

### 5.8 Embedded content (§12)
- [ ] `image`: PNG, JPEG, SVG (nested document in secure mode), `preserveAspectRatio`, auto sizing from intrinsic size, `crossorigin` ignored, broken images render nothing (§12.3)
- [ ] `foreignObject`: geometry, clipping, `switch` fallback; non-SVG content not rendered (§12.4)

### 5.9 Clipping, masking, compositing (CSS Masking 1, Compositing 1, §3.9, 1.1 ch. 14)
- [ ] `clipPath` with `clipPathUnits`, `clip-rule`, nested `clip-path` on the clip path and its children, `use` children, text children, transforms; invalid children ignored
- [ ] `clip-path` with basic shapes (`inset`, `circle`, `ellipse`, `polygon`, `path()`) and geometry boxes
- [ ] `mask` element: `maskUnits`, `maskContentUnits`, `mask-type` luminance/alpha, nested masks
- [x] CSS `mask` layers as far as they apply to SVG content (`mask-image` with `url()` to SVG masks and to images, `mask-mode`, `mask-repeat`, `mask-position`, `mask-size`, `mask-composite`), `mask-border` only if trivial
- [ ] 1.1 `clip` property on viewport elements
- [ ] `mix-blend-mode` (all separable and non-separable modes), `isolation`, Porter-Duff operators

### 5.10 Filters (Filter Effects 1, 1.1 ch. 15)
- [x] `filter` element: region, `filterUnits`, `primitiveUnits`, subregions, `href`, 1.1 `filterRes`
- [x] `filter` property with `url()` and the filter functions (`blur`, `brightness`, `contrast`, `drop-shadow`, `grayscale`, `hue-rotate`, `invert`, `opacity`, `saturate`, `sepia`) and filter lists
- [x] Inputs: `SourceGraphic`, `SourceAlpha`, `BackgroundImage`/`BackgroundAlpha` (isolation groups per FE1 and `enable-background` per FE1 App. A), `FillPaint`, `StrokePaint`, named results, forward/missing references
- [x] Every primitive: `feBlend` (incl. `no-composite`), `feColorMatrix`, `feComponentTransfer` (+ `feFuncR/G/B/A`), `feComposite` (incl. `arithmetic`), `feConvolveMatrix`, `feDiffuseLighting`, `feSpecularLighting`, `feDistantLight`, `fePointLight`, `feSpotLight`, `feDisplacementMap`, `feDropShadow`, `feFlood`, `feGaussianBlur` (incl. `edgeMode` and the box-blur approximation rule), `feImage` (element and image references), `feMerge`/`feMergeNode`, `feMorphology`, `feOffset`, `feTile`, `feTurbulence` (the spec's reference code is normative; match it bit for bit)
- [x] `color-interpolation-filters`, `flood-color`/`flood-opacity`, `lighting-color`
- [x] Filter resolution and the "kernelUnitLength" rules, infinite and empty regions, filters on empty groups

### 5.11 Linking (§16, 1.1 ch. 17)
- [ ] URL references: same-document, external through the resolver, `data:`, invalid references (each property defines its fallback) (§16.1)
- [ ] `a` renders its children; `href`/`target` kept, never activated (§16.2)
- [ ] Fragment identifiers: bare `#id` (render the view/element), `#svgView(viewBox(...);preserveAspectRatio(...);transform(...);zoomAndPan(...);viewTarget(...))`, `view` elements (§16.3, 1.1 §17.2)

### 5.12 Colour (1.1 ch. 12)
- [ ] `color-profile` element and property, `icc-color()`, embedded profiles in PNG/JPEG, `rendering-intent`. Requires an ICC transform engine (matrix/TRC profiles first, LUT profiles after). Defaults to sRGB when no profile applies

### 5.13 Animation (1.1 ch. 19, SMIL Animation, SVG Animations 2)
- [ ] Elements: `animate`, `set`, `animateMotion` (+ `mpath`, `path`, `keyPoints`, `rotate="auto|auto-reverse"`), `animateTransform`, 1.1 `animateColor`
- [ ] Targets: `href`/`xlink:href`, `attributeName`, `attributeType` (CSS/XML/auto)
- [ ] Timing: `begin`/`end` lists with offsets, syncbase (`a.end+1s`), wallclock (resolved against a host-supplied document start), indefinite; event and accessKey values unresolved (section 2.1); `dur`, `min`, `max`, `restart`, `repeatCount`, `repeatDur`, `fill`
- [ ] Values: `from`/`to`/`by`/`values`, `calcMode` discrete/linear/paced/spline with `keyTimes`/`keySplines`, `additive`, `accumulate`, the animation sandwich and priority
- [ ] Which attributes and properties are animatable and how (per-property animation type: discrete, by computed value, colour, length lists, path data morphing with matching segment types, transform lists)
- [ ] CSS Animations (question 4): `@keyframes`, `animation-*` properties, sampled at *t*

### 5.14 Optional, last
- [ ] Hit testing following `pointer-events` (§15.5–15.6) as an API for hosts. Not part of any mode, so only if Julia wants it

Mask resources use CSS Masking 1 [mask element coordinates](https://www.w3.org/TR/css-masking-1/#MaskElement)
and [mask value calculation](https://www.w3.org/TR/css-masking-1/#MaskValues).
Each layer is converted to coverage before [mask-composite](https://www.w3.org/TR/css-masking-1/#the-mask-composite)
combines it with the accumulated layers below it. The bottom layer ignores its
operator. [Mask mode](https://www.w3.org/TR/css-masking-1/#the-mask-mode) overrides
the resource's mask type; shorter property lists repeat across image layers.
Literal reference fixtures independently exercise partial-alpha Porter–Duff
results and order-sensitive three-layer expressions.

`<gradient>` mask layers follow [CSS Images 3](https://www.w3.org/TR/css-images-3/#gradients)
and are sized, positioned and tiled per [mask-size](https://www.w3.org/TR/css-masking-1/#the-mask-size),
[mask-position](https://www.w3.org/TR/css-masking-1/#the-mask-position) and
[mask-repeat](https://www.w3.org/TR/css-masking-1/#the-mask-repeat), which defer to
CSS Backgrounds 3. Interpretation decisions:

- Reference boxes follow [mask-clip](https://www.w3.org/TR/css-masking-1/#the-mask-clip)
  for SVG elements without a CSS layout box: `content-box`/`padding-box` use the fill box,
  `border-box`/`margin-box` the stroke box; so the initial origin and clip are the stroke box.
- `no-clip` with a repeated axis has no painting area to tile; the tiles cover the stroke
  box, which bounds everything the element can paint.
- [Transition hints](https://www.w3.org/TR/css-images-3/#coloring-gradient-line) are sampled
  into sub-stops at the backend ramp's resolution (1,024 entries over the gradient span),
  so the hint curve's error stays within ramp quantization.
- [Degenerate radials](https://www.w3.org/TR/css-images-3/#degenerate-radials) with zero
  height paint the last stop (the period average when repeating); zero width becomes a
  1e-9 × height ellipse. A zero-length span is widened by 1e-9 of the line length.
- [Repeating gradients](https://www.w3.org/TR/css-images-3/#repeating-gradients) with an
  empty period paint the premultiplied average of their first and last stops, as the spec's
  note describes; a non-empty period averages over the period.
- Repeated layer images are retained pictures executed as pattern tiles, like SVG patterns.

`url()` mask layers that do not name a `mask` element are `<image>` values
([#the-mask-image](https://www.w3.org/TR/css-masking-1/#the-mask-image)): they are fetched
through the resolver under the referencing document's policy (relative URLs against the
declaring stylesheet), decoded like `<image>` sources, and sized with their natural
dimensions and ratio. Raster layers honour `image-orientation` and `image-rendering`; SVG
layers are laid out as independent secure documents in the concrete object size and clipped
to it. Fragment-only references always name elements: unresolved ones, and anything that is
not a decodable image, are transparent black layers.

`mask-border` is not implemented: nine-slice border images are not trivial, and the
checklist admits `mask-border` only if trivial.

### Filter graph

A `filter` element resolves to a program (`images/svg/filters`): its
[filter region](https://www.w3.org/TR/filter-effects-1/#filter-region), primitives with
[subregions](https://www.w3.org/TR/filter-effects-1/#FilterPrimitiveSubRegion) already
defaulted, named inputs and parameters, all in the filtered element's user space. The
executor runs it on premultiplied RGBA8 surfaces over `vector.filter`. Interpretation
decisions:

- Filter space. When user space maps to the device by a positive scale and translation the
  filter runs on device pixels. Otherwise it runs on a surface scaled by the lengths of the
  user axes (so the region keeps its axes parallel to user space), and the result is drawn
  through the remaining transform with bilinear sampling, as the
  [region note](https://www.w3.org/TR/filter-effects-1/#element-attrdef-filter-x) suggests.
  Lengths are scaled into that space; offsets and morphology radii round to whole pixels.
- Region pixels. The region and subregions cover every pixel they touch (rounded outward,
  after snapping edges within 1e-6 of a pixel boundary). The working surface is limited to
  the canvas grown by its own size on each side.
- Empty regions. The pinned text of
  [#element-attrdef-filter-width](https://www.w3.org/TR/filter-effects-1/#element-attrdef-filter-width)
  is cut off ("…ng of the element which referenced the filter"); we read it as
  "negative or zero values disable rendering of the element which referenced the filter",
  matching browsers. Bounding-box units on an empty box, and a filter with no primitives
  ([#FilterPrimitiveTree](https://www.w3.org/TR/filter-effects-1/#FilterPrimitiveTree)),
  also leave the element unrendered.
- Empty groups. A filter region in `userSpaceOnUse` does not depend on content, so a group
  with no rendered children still runs its filter on a transparent `SourceGraphic` (an
  `feFlood` shows). Huge or practically infinite regions are clipped like any other to
  the working surface.
- `color-interpolation-filters: auto` uses linearRGB. Flood colors are converted with the
  same byte conversion as images, after premultiplying.
- A primitive whose subregion has zero or negative width or height is disabled: its result
  is transparent black. Blur and morphology read their input across the whole filter region
  and are clipped to their subregion afterwards.
- `feDropShadow` is its spec expansion; a negative `stdDeviation` there means no blur.
- Filter functions are programs of their
  [markup equivalents](https://www.w3.org/TR/filter-effects-1/#FilterPrimitiveRepresentation),
  always in sRGB. Their [UA-defined region](https://www.w3.org/TR/filter-effects-1/#filter-region-for-shorthands)
  is the stroke bounding box, grown by `3σ + 2` user units for each blur (the box
  approximation reaches a little past 3σ) and by drop-shadow offsets, cumulatively through
  the list; a referenced filter grows it to its own region.
- `href` on `filter` follows SVG 1.1
  ([#FilterElementHrefAttribute](https://www.w3.org/TR/2011/REC-SVG11-20110816/filters.html#FilterElementHrefAttribute)),
  which FE1 dropped: unspecified attributes, and the primitives when the element has none,
  come from the template chain, sharing the paint-server template machinery and its cycle rules.
- SVG 1.1 `filterRes` sets the surface to exactly that many pixels over the filter region,
  drawn back with bilinear sampling; non-integers truncate, zero hides the element, and a
  negative value is an error that leaves the automatic resolution.
- `feTurbulence` follows the reference code of Filter Effects 1, which differs from SVG 1.1's
  listing (and from browsers, which follow SVG 1.1): `init` draws a new gradient for a zero
  vector and discards vectors longer than 1, and the `seed` attribute truncates toward zero
  instead of rounding. `setup_seed` runs in f64 so that huge seeds stay exact. Noise is
  sampled at each pixel's top-left corner mapped back to the `primitiveUnits` space (for
  `objectBoundingBox`, `(user - box origin) / box size`, with `baseFrequency` per box
  unit); the subregion in that space is the stitching tile. Negative `baseFrequency` or
  `numOctaves` values are unsupported and give transparent black, a non-integer
  `numOctaves` is invalid and leaves 1, and `numOctaves` is clamped to 32, which the spec's
  clamping note allows.
- `feBlend`'s `no-composite` (Compositing 1 #blending, FE1 #element-attrdef-feblend-no-composite)
  writes the mixed color `(1 - αb)·Cs + αb·B(Cb, Cs)` with the source's alpha and no
  Porter-Duff source-over step, so the backdrop shows only through the blend function.
- `feConvolveMatrix` acts as a pass through filter on every unfulfilled precondition
  (the change log's "pass through on unfulfilled pre-conditions"): orders below 1 after
  truncation, a kernel whose length is not `orderX * orderY`, and a target outside the
  kernel or not an integer. The input's extent for `edgeMode` is the primitive subregion.
  `kernelUnitLength` is honoured by resampling the input bilinearly to one pixel per kernel
  unit, running the kernel there and resampling the result back; a unit is at least half a
  surface pixel, and a unit that maps to one pixel skips the resampling. A missing,
  negative or zero value means one surface pixel.
- `feDisplacementMap` displaces by whole pixels (nearest sampling), with a table per axis,
  since `scale` is in `primitiveUnits` and maps to pixels differently along x and y. Its
  `in` image stays in its own color space and only `in2` is converted.
- Lighting. Light positions are in `primitiveUnits`; a bounding box scales z by its
  normalized diagonal `sqrt((w² + h²) / 2)`, and the surface space scales z by the root mean
  square of its axis scales. `lighting-color` is converted into the primitive's color
  space. A lighting primitive without a light source child produces transparent black; with
  several, the first counts. Negative `diffuseConstant` and `specularConstant` are invalid
  and leave 1. The sign of `limitingConeAngle` is ignored (the cone is symmetric).
  `feSpecularLighting`'s `(Sr, Sg, Sb, max)` is taken as a premultiplied color, as its alpha
  rule intends.
  `kernelUnitLength` (deprecated) is honoured like `feConvolveMatrix`'s: the normals are
  computed on the input resampled to one pixel per kernel unit, with the light in that grid.
- `feImage`. A reference without a fragment loads an image resource (PNG, JPEG or an SVG
  document) and renders it like `image` in the primitive subregion with the feImage's
  `preserveAspectRatio` and `image-rendering`; whatever falls outside the subregion is cut.
  A fragment reference renders the element like `use`, in the user space set by
  `primitiveUnits` (bounding box units scale it). The subregion's `x`/`y` do not translate
  it: FE1 §9.15 says "rendered according to the behavior of the use element" and the
  feImage has no `x`/`y` of its own in that sense. Chrome translates the element by the
  subregion origin (the filter region origin when `x`/`y` are absent), so its output
  differs. A reference back into the element being filtered is a cycle and draws
  transparent black, where Chrome draws the element unfiltered. A missing reference fills
  the subregion with transparent black, as FE1 says.
- `BackgroundImage` follows FE1's main text: the backdrop of the current isolation group
  behind the filter region when the filter runs, sampled at the filter surface's pixel
  centers and clipped by the filter region like every input. Inside an isolated group
  (including the one the filtered element's own opacity, blending or masking creates, as
  those apply after the filter) it holds only what the group drew so far. `BackgroundAlpha`
  is its alpha with black color. Chrome reads both as transparent black.
- `enable-background` (FE1 Appendix A lets user agents keep SVG 1.1's) is implemented
  additively. `new` on a container makes it an isolated group, so BackgroundImage for
  its descendants starts there. The optional `x y width height` region limits
  BackgroundImage to that rectangle in the container's user space. A negative width or
  height is an error, which leaves `accumulate`. Without a `new` ancestor, FE1's
  isolation model applies instead of SVG 1.1's transparent black, since the two
  conflict there. Background accumulation stops at any closer isolated group, such as
  an opacity group, where SVG 1.1 would accumulate through it.
- The filtered element's own group (opacity, blending, masking or clipping) applies after
  the filter, so BackgroundImage reads the layer beneath it.
- `FillPaint` and `StrokePaint` are the filtered element's used fill or stroke paint with
  `fill-opacity` or `stroke-opacity` over the whole filter region; paint servers keep the
  element's bounding box and spread past it. The opacity follows FE1's subregion example,
  where a circle with `fill-opacity="0.5"` makes the FillPaint rectangle translucent. On a
  group the paint is the group's own `fill`/`stroke`. Chrome reads both as transparent
  black.

PNG decoding is implemented independently of SVG rendering. Sample reconstruction
uses PNG 3 [scanline serialization](https://www.w3.org/TR/png-3/#7Scanline),
[filtering](https://www.w3.org/TR/png-3/#9Filters), and
[Adam7 passes](https://www.w3.org/TR/png-3/#8Interlace).
[Transparency samples](https://www.w3.org/TR/png-3/#11tRNS) mask unused high bits
before comparison. APNG selects the first animation frame, including when the
fallback IDAT image is outside the animation, on a transparent initial canvas
([frame controls](https://www.w3.org/TR/png-3/#fcTL-chunk)). Later frame payloads
are not inflated for this first-frame API. Color metadata is retained; its
interpretation/conversion remains incomplete; PNG samples are integrated into SVG image rendering.

### Font database and matching

`images/svg/fonts` holds the faces text layout may use. The host fills it with font
data. CSS Fonts 4 #font-matching-algorithm leaves the set of installed fonts undefined.
Generic families resolve to the first configured family that has faces. Interpretation
decisions:

- Family names are the typographic (name ID 16) and legacy (name ID 1) names in every
  language. They are compared with Unicode Default Caseless Matching (#localized-name-matching):
  full case folding (status C and F) from the Unicode 18 `CaseFolding.txt` that `ucd` pins,
  with no normalization, generated by `scripts/generate-casefold`.
- Static faces map to descriptor values as the font descriptors do:
  - `usWeightClass` gives the weight (400 when outside 1 to 1000; `head.macStyle` bold
    gives 700 without OS/2).
  - `usWidthClass` gives the font-width keyword percentage.
  - fsSelection ITALIC gives italic value 1 and no oblique angles.
  - fsSelection OBLIQUE gives the `post.italicAngle` slope, or 14deg when that is 0.
  - Upright faces have italic value 0 and oblique angle 0.
- Variable faces support their `wght`, `wdth`, `ital` and `slnt` ranges. `slnt` is
  negated, so oblique angles lean forward. The selection carries the values the "Apply
  font matching variations" step sets.
- #font-style-matching is applied on the two scales it names, italic values and oblique
  angles. For a negative oblique request ("negated values and opposite directions"),
  the oblique scale is mirrored and the italic steps are kept, since negative italic
  values do not exist.
- Synthesis (`font-synthesis` initial value `weight style`):
  - An italic or oblique request that ends on an upright face is sheared by the requested
    angle, or by 14deg for italic.
  - A request of 600 or more on a face whose weights all lie below 600 is emboldened.

### Text layout

`images/svg/text` runs the SVG 2 text layout algorithm (#TextLayoutAlgorithm) on one
`text` element's addressable characters, on a single horizontal line. Interpretation
decisions:

- Per-character font choice follows CSS Fonts 4 #cluster-matching in a simplified form:
  each character takes the first face of its span that maps it in `cmap`. Marks, ZWJ, ZWNJ
  and variation selectors keep the face of the character before them in the same span.
- Runs of characters with the same font instance (face, variation values, synthesis and
  size) are shaped with HarfBuzz's algorithm (`font/shape`) and default features, across
  element boundaries (CSS Text 3 #boundary-shaping). The pen continues across runs.
- A cluster's glyphs move with its first character. Characters that do not start a cluster
  (after composition or ligation) are not the first character of a typographic character,
  so their `x`, `y`, `dx` and `dy` values are ignored.
- Anchoring uses the extent of the glyph advances of each text chunk, as the
  "Apply anchoring" step defines it.
- Letter spacing follows the pinned CSS Text 3: half of each character's amount on each
  side of its typographic character, and none at the start or end of the line (the whole
  text). Where it is nonzero, the `liga`, `clig`, `dlig` and `hlig` features are off.
  Word spacing adds to the advance of each word separator (U+0020, U+00A0, U+1361,
  U+10100, U+10101, U+1039F, U+1091F).
- The steps run in the algorithm's order: dx/dy, then `textLength`, then x/y, then
  anchoring. The algorithm's x/y step would discard a character's own `dx` when the same
  character has an `x`. The attribute definitions say `dx` shifts from the new position,
  so a character with an `x` lands at `x + dx` (likewise for `y` and `dy`).
- `textLength` is followed literally: only the element's characters move. With
  `spacing`, the difference spreads over its typographic characters, and a nested element
  with its own `textLength` counts as one. With `spacingAndGlyphs`, positions and glyphs
  scale horizontally about the start of the extent. Characters after the element do not
  move, since the algorithm shifts only the range `[i, j]`.
- Each text chunk is an independent block for ligatures and bidi reordering, as the
  #TermTextChunk definition says, so shaping also breaks where an `x` or `y` value starts
  a chunk. The text element's `direction` sets the paragraph level (`unicode-bidi:
  plaintext` on it picks the level from the text). Descendants' `unicode-bidi` and
  `direction` become the formatting characters of CSS Writing Modes 3
  #bidi-control-codes around their content. Levels come from `ucd`'s UAX #9 on the
  whole chunk as one line. Runs split where the font instance or level changes, are
  placed in L2 visual order and shaped right to left at odd levels.
- A right-to-left character's position is the right edge of its cluster, so its advance
  runs negative from it, as the algorithm notes. `x` therefore places the right edge of
  a right-to-left first character. Anchoring takes the direction of the chunk's first
  character: `start` aligns the right end of the extent for `rtl`. With `textLength`,
  an `rtl` element's characters move left (`spacing`) or scale about the right edge
  (`spacingAndGlyphs`).
- Font features follow CSS Fonts 4 #feature-precedence: `font-kerning`, then
  `font-variant-*`, then `font-feature-settings`, each a ranged shaper feature over the
  element's own characters, so a later setting of a tag wins. Letter-spacing's ligature
  suppression comes last. SVG 1.1 `kerning` with a length turns `kern` off and adds the
  length to `letter-spacing` (1.1 §10.11). `font-kerning` and the `font-variant-*`
  longhands are not presentation attributes in SVG 2, so only CSS sets them; the
  `font-variant` shorthand is. Variants are not synthesized when the font lacks the
  feature (CSS Fonts 4 allows synthesizing small caps and sub/superscripts).
- `@font-face` (CSS Fonts 4 #font-face-rule) uses its first `src` entry that yields a face.
  `local()` matches an installed face's full or PostScript name (case-insensitively, as
  family names). A url works when its format is absent, `truetype`, `opentype` or
  `collection`, when the sheet's processing mode may fetch it (secure modes allow `data:`
  only), and when it holds a readable sfnt face. The url's first face is used. The face
  joins font matching for this render only. WOFF/WOFF2 and `tech()` sources are skipped. `font-weight`, `font-width`/`font-stretch` and
  `font-style` descriptors replace the face's own values, and `auto` keeps them. A family
  that a document defines hides installed faces of the same name. `unicode-range`,
  `font-display`, `size-adjust` and the metric overrides are ignored.
- `font-variation-settings` axis values follow the ones font matching sets, so they win.
  `font-optical-sizing` is not applied yet (no test font has an `opsz` axis).
- `font-size-adjust` takes a number (the ex-height metric). The used size makes the x-height
  of the span's first available font (its first matched face, at default variations) that
  fraction of the computed size. Without an x-height metric the size is unchanged. `em`
  units still use the computed size.
- Synthetic bold (#font-synthesis-weight, method left to the UA) follows FreeType's
  `FT_Outline_EmboldenXY` and `FT_GlyphSlot_Embolden`: outlines grow by 1/24 em in x and y
  (in font units, before scaling), and each advancing glyph's advance grows by the same
  amount. Marks with no advance keep it.
- Text on a path follows the algorithm's "Position on path" step. Each typographic
  character's midpoint (position plus half its advance plus `startOffset`) maps to the
  point that far along the path. The character turns to the tangent there, and its
  baseline offset (`dy`, baseline alignment) goes along the normal. Characters whose
  midpoints fall off an open path are hidden. A single closed subpath wraps for one
  circuit, with the anchor- and direction-dependent bounds. Characters after the
  element continue from the path's end until the next anchored chunk. A `textPath`
  always starts an anchored chunk, so also a bidi and shaping block.
- The distance along a path is measured on a polyline. Lines are exact, and each
  quadratic or cubic Bézier becomes 64 chords uniform in its parameter. Arcs become
  curves first (tolerance 0.01). `method="stretch"` and `spacing="auto"` are allowed
  adjustments the algorithm leaves to the UA, and we make none. The path is the `path`
  attribute when it has a segment, else the `path` or basic shape that a same-document
  fragment `href` names. That element's transform applies as a supplemental
  transformation, and its `pathLength` scales a length `startOffset`. Any other
  reference renders none of the element's characters.
- Inside a `textPath`, `y` values are ignored (the algorithm's note on horizontal text on
  a path), and `dy` moves glyphs along the normal. The algorithm's "unset
  resolve_y[index]" reads as all characters of the element. Applying the text element's
  own `y` along the normal would contradict that note.
- Text decoration (§11.11, CSS Text Decoration 3) is painted by the element that declares
  it, with that element's fill, stroke and paint order, across its descendants' glyphs.
  Underlines and overlines paint before the element's glyphs and line-throughs after its
  whole content (#painting-order). Positions come from the element's first face: the
  post table's underline position and thickness, the OS/2 strikeout, and the overline
  at the ascent, so a descendant with another font or baseline shift does not move the
  line (#line-decoration). A numeric `text-decoration-thickness` replaces both
  thicknesses. Each run of unrotated glyphs on one baseline gets one rectangle; a rotated
  glyph, including one on a path, gets its own
  rectangle in its rotated frame.
  `text-decoration-style` is drawn as solid, `text-decoration-fill`/`-stroke` are not
  applied, and decorations do not add to the bounding box (SVG 2 #TextBoundingBox counts
  glyph cells only) or to a clipping path.
- Text in a `clipPath` contributes the glyph outlines of the text element and of each
  descendant that renders characters (CSS Masking 1 #ClipPathElement).
- Baselines follow CSS Inline 3 #baseline-alignment on horizontal text. The text
  element's dominant baseline sits on the text position. Each child aligns its baseline
  of the alignment type (`alignment-baseline`, or the parent's dominant baseline for
  `baseline`/`auto`) with the parent's baseline of that type, then `baseline-shift` moves
  it. Baseline positions come from each element's first face, synthesized as
  #baseline-synthesis-fonts allows, because the `BASE` table is not read yet:
  `text-top`/`text-bottom` are the ascent and descent, `central` is halfway between them,
  `middle` and `mathematical` are half the x-height (OS/2 `sxHeight`, else 0.5em),
  `ideographic` is the descent and `hanging` is 0.6em. The SVG 1.1 edge keywords map to
  `text-top`/`text-bottom`; `auto`, `use-script`, `no-change` and `reset-size` keep the
  parent's dominant baseline (alphabetic at the root).
- `baseline-shift: sub` and `super` use the parent's OS/2 subscript and superscript
  y offsets (else 1/5 and 1/3 of its font size). Percentages refer to `line-height`.
  `top`, `center` and `bottom` align to a line box, which SVG text without `inline-size`
  does not have, so they do not shift.

`src/used_text.silk` feeds it from the document:

- Addressable characters come from the `text` subtree in document order. Text content
  children are `tspan`, `a`, `textPath` and unknown elements, which render as unpositioned spans. Other SVG elements inside text
  render nothing. Characters inside `display: none` elements are not addressable.
- White space follows CSS Text 4 #white-space-phase-1 on one line. With `collapse`,
  segment breaks and tabs become spaces, a space after a collapsible space is removed,
  and spaces at the start and end of the line are removed. The preserving values keep
  spaces; tabs render as spaces, and so do segment breaks unless `inline-size` wraps the
  text. `xml:space="preserve"` reaches this as `white-space-collapse: preserve-spaces`
  through the UA stylesheet.
- Auto-wrapped text (#InlineSize, #TextLayoutAuto): a positive `inline-size` on the `text`
  element wraps it, except when it holds a `textPath`. Percentages refer to the viewport
  width. `inline-size` is a property only: SVG 2's list of presentation attributes
  (styling.html) does not include it, although an example in §11.4.1 uses the attribute.
  The text is laid out once on one line, then broken greedily at UAX #14 opportunities
  (`ucd`, default options; `line-break` and `word-break` are not read yet). A line ends at
  the last opportunity whose content fits. A word longer than the line overflows. Without
  soft wrapping (`text-wrap-mode: nowrap`) only forced breaks apply. A preserved segment
  break is a forced break.
- The white space at the end of a line hangs: it has no advance, is not drawn, and does not
  count for anchoring. With `collapse` CSS removes these spaces instead, which renders the
  same, but they stay addressable for `dx` and `rotate`. Letter and word spacing start
  afresh on each line.
- Each line is an anchored chunk (#TextLayoutAlgorithm sets the flag at each line start).
  Its first character takes the first character's `x`, and the line's baseline as `y`. All
  other `x` and `y` values are ignored (§11.7); `dx`, `dy` and `rotate` still apply, and
  `textLength` does not. §11.4.1 anchors the wrapping area with `text-anchor` while
  §11.5 requires `text-align: start`. But the algorithm then anchors each line chunk at
  its own start, so each line is anchored at the first `x`: `middle` centres every line
  on it, and `end` (or `start` in right-to-left text) ends every line there.
- Line boxes follow CSS 2.1 #line-height. Each span on the line, and the `text` element's
  strut, adds an inline box: its first face's ascent and descent (`hhea`, or `OS/2` typo
  metrics with USE_TYPO_METRICS), set on the span's alphabetic baseline and grown by half
  the leading above and below. `line-height: normal` is ascent + descent + line gap
  (CSS Inline 3). The first baseline is at the first `y`, and each next one lies lower by
  the previous line's bottom minus the new line's top. Bidi levels are resolved per line
  rather than per paragraph.
- `shape-inside` and `shape-subtract` follow the SVG 2 Editor's Draft (#TextShapeInside,
  #TextShapeSubtract); the 2018 Candidate Recommendation drops them. A list of shapes other
  than `auto` sets the content area instead of `inline-size`, for horizontal text off a
  path. Basic shapes (`circle()`, `ellipse()`, `polygon()`) resolve against the viewport.
  A `url()` names an SVG shape element in its geometry and own transform; a reference to
  anything else is ignored, and so are box values. Shapes become polygons (curves as 64
  chords) filled nonzero, or by `polygon()`'s fill rule.
- Lines fill the first shape from its top. Every line is as tall as the text element's
  strut line box (CSS 2.1 #line-height), and taller inline boxes do not grow it yet. A
  line's band takes, left to right, the spans of x that lie inside the shape and outside
  every subtracted shape for the band's whole height (#TextLayoutAutoNotes "broken lines").
  A span that cannot hold the next word is skipped. A band that holds nothing moves down
  a pixel, following CSS Shapes' model of a shape's edge as pixel floats. Each part of a
  line is an anchored chunk. §11.5 fixes `text-align` at its initial value, so
  `text-anchor` aligns each part at its span's start, middle or end. Text that overflows
  one shape continues in the next; what is left after the last is not rendered.
  Not done yet: `shape-padding`, `shape-margin`, `shape-image-threshold` and image
  shapes, and vertical text in shapes.
- `tref` (SVG 1.1 #TRefElement) takes the character data of the same-document element its
  `href` or `xlink:href` names, markup removed, and treats it as its own text with its own
  style, white space and positioning attributes, including `textLength`. Its own children
  add nothing, and an unresolved reference adds no characters.
- `altGlyph` (SVG 1.1 #AltGlyphElement) names a `glyph` of one of the document's SVG fonts,
  or an `altGlyphDef` whose glyphRefs, or whose first altGlyphItem with only resolvable
  glyphRefs, name such glyphs. The glyphs replace the element's characters and come from
  their font whatever the `font-family`; in positioning lists the first glyph takes the
  characters' place. Glyphs from more than one font, `glyphRef`'s `glyphRef`/`format`
  attributes and glyphs of other documents are not supported, and fall back to rendering
  the content like a `tspan`, as for any unresolved reference.
- SVG fonts (SVG 1.1 ch. 20): each `font` of the main document with a `font-face` child
  adds a face of the family that `font-face` names, after the @font-face faces. The font is
  compiled into OpenType data (`fonts/src/opentype.silk`), so matching, fallback, shaping,
  baselines and decorations work as for any face:
  - Glyph selection (#GlyphSelectionRules) takes the first glyph in document order whose
    `unicode` matches. The `cmap` maps each character to the first single-character glyph
    for it; a multi-character glyph becomes a mandatory ligature (`ccmp`) unless an earlier
    glyph's `unicode` is a prefix of its own. A character that only appears inside
    ligatures maps to a copy of the `missing-glyph`.
  - `arabic-form` glyphs become the `init`, `medi` and `fina` substitutions, so the joining
    of the shaper picks them; a glyph without the attribute serves every form. In upright
    vertical text, `vert` substitutions switch to the first glyph that allows vertical
    use when it differs from the horizontal choice.
  - `hkern` pairs (`u1`/`g1`, `u2`/`g2`) become a `kern` table; the first `hkern` for a pair
    wins. `vkern` is not supported.
  - Outlines (`d` only) become CFF charstrings in 16.16 fixed point, moved by
    `horiz-origin-x`/`-y`; quadratic segments are raised to cubics and arcs become curves.
    Advances, metrics and kerning values round to whole font units. Glyph child elements
    are not rendered.
  - `ascent` and `vert-origin-y` default to each other in 1.1; with neither given, the
    ascent is `units-per-em` and the descent 0. `font-weight` lists become the range they
    span. `font-style` and `font-stretch` lists and `all` keep an upright, normal-width
    face. A `unicode-range` makes glyphs for characters outside it unselectable. Glyphs
    with a `lang` attribute are never selected, since the shaper is not told the text's
    language.
  - Each glyph is also mapped from U+F0000 plus its index, so `altGlyph` can name it.
    Text that uses those private-use characters therefore shows these glyphs.
  - External SVG fonts (`font-face-uri`, @font-face `format("svg")`) are not loaded.
- Vertical text (CSS Writing Modes 3 #vertical-layout): the `text` element's `writing-mode`
  (`vertical-rl`, `vertical-lr`, and the SVG 1.1 `tb`/`tb-rl` mapped to `vertical-rl`) lays
  the text out as horizontal text in a frame turned a quarter clockwise. The inline axis
  runs down, `y` and `dy` position along it and `x` and `dx` across it. Characters are set
  upright or sideways by `text-orientation`; for `mixed` this uses their UAX #50
  orientation per grapheme cluster (`ucd.vertical`). Upright runs are shaped top to bottom,
  which applies `vert` and the font's vertical advances and origins (HarfBuzz's fallbacks
  without `vmtx`). Sideways runs are shaped as horizontal text, including bidi, and turned
  90° clockwise. Tu and Tr characters rely on `vert` for their transformed forms.
- The text position is on the central baseline: `dominant-baseline: auto` resolves to
  `central` in vertical text, also for sideways text as #DominantBaselineProperty asks.
  Upright glyphs are centred on their span's central baseline. `text-anchor: start` is the
  top whatever `direction` says (#TextAnchoringProperties). Wrapped vertical lines stack
  leftward (`vertical-rl`) or rightward (`vertical-lr`); their inline boxes are centred on
  the central baseline, except for `text-orientation: sideways`.
- `glyph-orientation-vertical` aliases `text-orientation` (§11.10.1.3): `0deg` is upright
  and `90deg` sideways. The two are separate properties in our cascade, so a value other
  than `auto` wins over `text-orientation`. `glyph-orientation-horizontal` was removed in
  SVG 2 and is ignored. Not done yet: `text-combine-upright`, the `sideways-*` writing
  modes of Writing Modes 4, and vertical text on a path, which is laid out horizontally.
- `x`, `y`, `dx`, `dy` and `rotate` are lists of CSS lengths, percentages or numbers
  separated by white space or commas. Percentages resolve against the viewport width
  (`x`, `dx`) or height (`y`, `dy`). An invalid list is ignored as a whole. Lists count
  UTF-16 code units, as #TermAddressableCharacter requires; the second unit of a
  surrogate pair takes no value. Elements apply their lists in document order, so a
  descendant's values replace an ancestor's for the descendant's characters. The last
  `rotate` value repeats over the rest of the element's characters.
- Each element's face list holds one selection per `font-family` entry, then one per
  installed family in database order. That last part is our system fallback for
  #cluster-matching. The host's measured initial face is in the database, so text in a
  missing family still renders.
- Each element paints its own glyph outlines as one path, before its child elements. When
  a child's glyphs fall between a parent's (`A<tspan>B</tspan>C`), the parent's glyphs
  still paint first. This differs from painting in document order only where glyphs of
  different elements overlap.
- The fill bounding box of a text content element is the union of its glyph cells
  (#TextBoundingBox): advance by ascent and descent from the font's horizontal line
  metrics. The stroke bounding box still uses the outlines.
- Markers do not apply to text.

### JPEG scan reconstruction

The local JPEG decoder follows the pinned `jpeg-t81` document's B.2 marker/frame/
scan syntax, C Huffman table construction, F sequential DCT decoding, and G.1.2 /
G.2 progressive coefficient coding and decoding. Coefficients survive scans;
spectral bands track their current successive-approximation level per component.
Refinement requires the preceding level, AC scans contain one component, and
restart boundaries reset DC predictors and require any EOB run to be exhausted.
Single-component scans traverse their actual block dimensions; interleaved scans
traverse the padded frame MCU grid. Quantization is retained when each component
first appears, before final inverse DCT reconstruction.

Current resource policy limits coefficient storage to 1,048,576 blocks (256 MiB),
scan count to 256 and cumulative block visits to 16,777,216. These limits return
`TooLarge`; they are application limits, not JPEG validity rules. Coefficient
storage, output planes and the RGBA image can coexist, so 256 MiB is not an
aggregate allocation promise. The decoder's current 8-bit one/three-component
scope and nearest chroma reconstruction do not establish the full phase-7 image
or phase-12 color-management requirements.

### JPEG metadata and orientation

ICC.1:2022 Annex B points to Technical Note 10-21 for media embedding. The new
`icc-embedding` pin adds that note without replacing any existing specification
snapshot. Its JFIF section (page 5) defines APP2 identification and chunk sequence
fields. The decoder retains one assembled byte sequence in chunk order, including
APP2 segments between progressive scans. It rejects missing, duplicate, zero or
inconsistent sequence/count fields. It does not yet interpret profile contents.
The format itself bounds profile bytes below 16 MiB; no decompression is involved.

`jpeg.decodeWithMetadata` returns unrotated samples, orientation and profile bytes.
`orientation.apply` implements the eight EXIF pixel permutations, swapping intrinsic
width/height for orientations 5–8 and preserving premultiplied channels exactly.
The image consumer uses an equivalent sample-coordinate transform for CSS Images 3
`image-orientation: from-image`; decoding itself does not silently override CSS orientation. Unrelated
APP1 data (for example XMP) does not erase an earlier EXIF orientation. Invalid or
absent orientation metadata uses the identity.

### Compressed SVG source documents

SVG 1.1 G.7 (`#ConformingSVGViewers`) requires gzip/deflate input support.
Root documents and fetched SVG source documents now recognize RFC 1952 gzip
and RFC 1950 zlib headers before XML parsing; the stdlib `silk.compress.inflate`
validates framing, DEFLATE, checksums, trailers and concatenated gzip members.
Decoded bytes still pass through XML's mandatory encoding detection, including
UTF-16 BOMs. A gzip filename is not required, and file extensions do not select
the decoder. Raw headerless DEFLATE is not guessed from arbitrary XML bytes.

The structure budget charges both encoded bytes and successfully expanded bytes.
Each expansion is additionally capped by XML's 16 MiB input ceiling, 1,024 gzip
members and 64 KiB of cumulative gzip headers. Inflation uses an 8 KiB output
chunk and the stdlib's fixed 64 KiB state; output grows only as validated steps
produce it. These are resource-policy limits, not format-validity rules. Limit
failures remain `TooLarge`; malformed root streams are `InvalidXml`, and malformed
external documents follow the existing unavailable-reference behavior. Trailing
bytes after the compressed stream are rejected. Transport hosts remain responsible
for any content codings they remove before returning a resource response.

### Raster image positioning and retained samples

SVG2 embedded content `#Placement` and `#ImageElement` define the positioning
rectangle and reference CSS Images 3 `#default-sizing`. Images use oriented natural
dimensions for auto sizing, with the 300 by 150 fallback when dimensions are absent.
The positioning rectangle remains the geometry reference box; preserveAspectRatio
controls sample placement, including meet, slice, none and all alignments. Zero
size disables painting. Raster resources ignore `defer`, as SVG2
coords `#PreserveAspectRatioAttribute` requires.

PNG/JPEG assets and their source colour metadata remain owned by the display list.
Repeated normalized URLs share a decode, including negative caching for broken
images. Resource policy runs before cache lookup. Out-of-memory and aggregate
budget failures propagate; unavailable or malformed images paint nothing. Each
image is sampled with its full projective transform, then participates in the
existing clip/mask/group compositing pipeline. Fill and stroke properties do not
paint the image rectangle. SVG `optimizeSpeed` selects nearest sampling; `auto`
and `optimizeQuality` select bilinear sampling. The subsequent sampling and
embedded-document sections describe CSS Images 3 keywords and nested SVG images.

The projective nearest-sampling fixture uses a continuous blue field, a binary red
band and one antialiased outer clip as its reference. Two separately antialiased
adjoining rectangles create a partial-alpha seam that an opaque sampled image
does not have; they are not an equivalent reference for that test.

### Base64 data payload correction

SVG2 resource fetching delegates data URLs to Fetch's `#data-url-processor`,
which invokes Infra `#forgiving-base64-decode`. The newly pinned Fetch and Infra
texts require removal of ASCII whitespace, acceptance of omitted terminal padding,
and discarding unused low bits. The previous RFC-2397-only strict decoder rejected
these valid payloads, including whitespace-bearing embedded PNGs in the pinned
resvg suite. Payload decoding now follows Infra while preserving exact preflight
size limits and allocation-failure propagation. Invalid alphabet characters,
impossible lengths, partial padding and non-whitespace after padding still fail.

Four former rejection cases (`YQ`, `YR==`, `YWF=`, `YQ%20==`) are now explicit
acceptance assertions under that normative algorithm. The allocator preflight test
now uses an invalid alphabet character instead of nonzero discarded bits. This is
a correction of expected behavior, not a pixel-tolerance change. Existing
percent-escape and metadata parsing policies are unchanged by this payload fix.

### Per-occurrence image orientation

CSS Images 3 [`#the-image-orientation`](https://www.w3.org/TR/css-images-3/#the-image-orientation)
(pinned SHA256 `74eb4b475aa0845a50ebedb4bbb3ba7bf3966f975817d1c5cf8e3d512f53447e`)
defines inherited `from-image` as the initial value. `none` uses raw samples;
explicit angles replace metadata, round to the nearest quarter turn with ties
toward positive infinity, and normalize to one turn. Horizontal `flip` follows
rotation. The deprecated angle/flip grammar is supported, including `calc()`.
The property participates in Cascade 4 [`#all-shorthand`](https://www.w3.org/TR/css-cascade-4/#all-shorthand).

Decoded assets retain raw pixels and metadata. Each image occurrence computes its
oriented natural dimensions and composes sample orientation before aspect-ratio
fitting and the element’s transform. This avoids repeated pixel allocations and
allows different CSS orientations to share a normalized image URL. Exact references
use six distinct PNG samples and independently rotated integer coordinates;
shared-resource and JPEG `none` cases distinguish occurrence styling from decoding.
The `all` probes restore `x` and `y` after the shorthand, because `all` also resets
those positioning properties. Decorative CSS image consumers remain pending and
must apply the specification’s separate decorative-image orientation rule.

Orientation math also follows CSS Values 4
[`#numeric-data-types`](https://www.w3.org/TR/css-values-4/#numeric-data-types) and
[`#calc-infinities`](https://www.w3.org/TR/css-values-4/#calc-infinities)
(pinned SHA256 `7b6b68c34d00d7f6945e66e4e2efa913266299f597d5825393cae85dac1cc78c`).
The finite angle limit is the supported binary64 whole-turn limit already used by
the numeric unit converter. Overflow and either infinity therefore normalize to
zero degrees, as does a NaN calculation after its outermost-boundary censorship.

### CSS image resampling

[CSS Images 3 §5.3](https://www.w3.org/TR/css-images-3/#the-image-rendering)
controls image sampling. `crisp-edges` and legacy `optimizeSpeed` select nearest
neighbors. `auto`, `smooth`, `high-quality` and legacy `optimizeQuality` use
bilinear interpolation. `high-quality` expresses a preference; this executor
does not reduce quality under load.

`pixelated` first expands each source axis to its closest positive integer
multiple using nearest neighbors, then bilinearly maps that intermediate to the
final destination. Exact halfway values select the larger integer (the section
does not prescribe a tie rule). Affine scale uses each source-axis column norm
of the complete device mapping, including occurrence orientation and placement.
For perspective, whose scale varies over the image, the executor uses the same
conservative forward-Jacobian bound over the finite destination rectangle as
pattern resolution. This is an implementation choice for a target scale not
uniquely specified by that section.

Expanded premultiplied samples are cached by source resource and integer scale
within one execution. Their aggregate storage plus the original backend image
copies must fit `maxPatternPixels`; dimensions and products are checked before
allocation. Exceeding the limit fails with `TooLarge`. It does not silently
substitute a different sampling algorithm. Original two-by-two color fixtures
compare integer, fractional, anisotropic and downscaled cases against independently
expanded PNGs under the same second-stage bilinear mapping, at zero tolerance.

Coincident transformed image bounds can place both ends of a clipped edge within
floating-point uncertainty of the same halfplane. Computing a crossing parameter
from those signs magnifies a tiny positional error along the whole edge. After
finite viewport clipping, the vector backend instead snaps such a vertex to the
actual plane only when the displacement and retained error fit one eighth of the
existing geometric tolerance. It charges the displacement to the vertex's error
bound. Horizon clipping retains its original handling; high-uncertainty vertices
still fail. A fractional translated 90-degree image and a vector-level rectangle
area test exercise this case without relaxing pixel comparisons.


### Embedded SVG image documents

SVG 2 CR2018 [§12.3 `#ImageElement`](https://www.w3.org/TR/2018/CR-SVG2-20181004/embedded.html#ImageElement)
(pinned SHA256 `9f2286fa76c0d82df7f8f2f373fb1d083ee2e30c468305ae542373aedd964e8c`)
makes the image-rendering rectangle the independent document's SVG viewport.
The outer image's `preserveAspectRatio` determines that rectangle; the child
root's value is treated as `none` during layout. SVG 1.1 `defer` selects an
explicit child root/view aspect-ratio value before fitting. Absolute computed
root dimensions supply intrinsic sizes; percentages and `auto` do not. A selected
viewBox supplies the ratio when definite root dimensions do not supply one,
following [§8.12 `#IntrinsicSizing`](https://www.w3.org/TR/2018/CR-SVG2-20181004/coords.html#IntrinsicSizing).
Without a viewBox, changing the viewport does not scale fixed user-unit geometry.

Each child starts an independent cascade and media context. Static parents select
secure-static children; animated parents select secure-animated children. External
requests are blocked before resolver dispatch, while data resources remain usable.
Response MIME/charset validation and decompression share the external SVG parser.
A redirect changes the base URL; the requested fragment still selects the view
and `:target` before intrinsic measurement and layout.

Child display lists retain geometry, paints and physical clip planes. Execution
composes their placement with the parent mapping and transforms clip planes by
the inverse transpose, retaining positive-w boundaries. Image and child-root
`overflow` independently govern the positioning and image-rendering rectangles.
Isolated child output receives the image element's opacity and compositing once.
Exact original fixtures cover intrinsic/percentage sizing, meet/none, stylesheet
isolation, secure external-resource rejection, source reuse across viewports,
rotation, perspective, recursive data images, overflow and group opacity.

Image-bearing pattern pictures remain live while child layouts are pending.
Once those layouts exist, visible pattern overflow includes their painted content;
fully clipped tiles use the finite tile boundary directly. A translucent overlap
fixture distinguishes correct neighboring tile enumeration from simply using the
image positioning rectangle. Document counts, bytes, occurrences and decoded
pixels share a budget across nested documents; recursive execution also shares the
remaining isolated-surface allowance instead of restarting it for each child.


SVG content images also follow CSS Images 3
[`#the-image-orientation`](https://www.w3.org/TR/css-images-3/#the-image-orientation).
The property applies to image sources referenced by SVG elements, and all sizing
uses the oriented natural dimensions. Quarter turns therefore swap optional
intrinsic width/height and invert an available aspect ratio before image sizing.
The child SVG receives the corresponding unrotated logical viewport; its retained
geometry is then rotated/flipped before the occurrence's CSS transform. With no
orientation metadata, SVG `from-image` behaves as `none`.

Explicit color-cell references cover all eight orthogonal orientations, auto
sizing from definite dimensions or a viewBox-only ratio, percentage viewport
geometry, inherited orientation with a shared raw layout, and perspective after
orientation. This extends the already supported deprecated angle/flip values to
SVG content sources; decorative CSS image rules remain separately applicable.
