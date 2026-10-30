# SVG implementation status

What each phase delivered and how it was checked. The [README](../README.md) has the summary.

The renderer computes CSS over source documents and rendering occurrences before
resolving outermost/nested `svg`, groups, `use`, `symbol`, paths and basic shapes.
Selectors, cascade/custom properties, presentation attributes, inline/external
stylesheets, media/supports conditions, typed geometry and transforms are integrated.
Solid and paint-server fills/strokes, viewports, inherited paint, visibility and
isolated opacity produce premultiplied RGBA8 through the shared CPU `vector`
backend. `svg_cli` writes PNG; source XML, occurrence/computed-style trees and
display lists are public.

Integration checks exercise CSS precedence, reference geometry, projective
transforms, nested positive-w clipping, backface visibility and resource limits.
The actual CLI's CSS fixture matches its literal reference. A 256×64 projective
CLI smoke also matches an independent affine/polygon control with zero differing
pixels, including parent perspective and nested flattening boundaries. The CLI's
512×512 stylesheet workload (2,048 rules and rectangles) matches an independent
pixel control exactly; its benchmark checksum also agrees with resvg.
The integrated phase-4 SVG gate passes on macOS arm64 and Ubuntu 24.04 arm64.
These checks do not establish conformance for the full viewer.

The phase-4 structural fixtures match 12 literal pixel references exactly,
including shadow inheritance, symbol sizing, switch selection, foreign-content
boundaries and reference boxes, asymmetric overflow and projective viewport clips.
Fragment tests exercise `:target`, selected views, view-transform ordering, spatial
media fragments and malformed-fragment recovery. Actual CLI checks cover all four
processing modes, nested external uses and explicit fragment selection. The
512×512 repeated-instance workload, containing 1,024 nested symbol instances,
matches an independent integer-pixel control exactly. These are focused checks,
not a full conformance claim.

Phase 5 adds linear and two-circle radial gradients, reusable pattern pictures,
markers on equivalent shape paths, context paint, `paint-order`, host-space vector
effects and linear-RGB interpolation/compositing. Paint metadata and resource
children use computed CSS and the existing occurrence/reference machinery.
`pathLength` calibrates absolute dash distances using certified native path
metrics; viewport percentages remain unchanged. Numeric/resource refusal policies
and unresolved specification choices are recorded in [SPECIFICATIONS.md](../SPECIFICATIONS.md#paint-and-vector-effect-interpretation-decisions).

The integrated dev.29 gate passes on macOS arm64, including 53 exact-RGBA
painting reftests. These cover gradient degeneracies, reusable/nested pattern
pictures and overflow, marker/context-paint placement, vector effects, painting
order, linear-RGB compositing and calibrated dashes. Nanounit geometry magnified
by a billion retains dash placement; signed-zero and unrepresentable period
arithmetic have dedicated regression coverage. No existing expectation was relaxed.

Phase 6 begins with typed blend modes retained through scene recording and CPU
layer execution. Ordinary groups share their parent's backdrop; explicit
isolation, non-normal blending, opacity and specified 3D transforms establish
isolated surfaces. The compositing manifest checks all 16 blend functions against
literal colors calculated from the normative equations, plus group opacity,
non-inheritance and 2D/3D isolation. No comparison tolerance is used.

General clipping/masking, image decoding, filters, text, animation and ICC remain
required later work, not exclusions from scope. `shape-rendering` controls current
shape rasterization; computed image/text hints gain consumers in their own phases.
Parsing those properties does not implement their rendering.
