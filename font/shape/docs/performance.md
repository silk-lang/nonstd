# font-shape performance history

This is the record of how the port got from 11.25× to below Rust, with the instruction-count table
measured on Silk dev.25. The [README](../README.md#performance) has the current numbers.

`font/scripts/bench-shaping` mirrors harfrust's `benches/shaping.rs` workloads. Both
twins reuse fonts, buffers and shape plans, process the same pinned text, and
check identical glyph/cluster/position checksums. Wall times for the Rust twin
are tens of milliseconds and too noisy to compare, so the ratios below are
callgrind instruction counts for one iteration
(`font/scripts/bench-shaping --callgrind --iterations 1 --samples 1`), Silk
`0.1.0-dev.25+584955edf9ef` with Clang 22.1.8 against Rust 1.99.1, both release
builds. Lower is better.

| Font / text | Silk Ir | Rust Ir | Silk / Rust |
| --- | ---: | ---: | ---: |
| Roboto / English Little Prince | 5.81938e+07 | 6.53272e+07 | 0.89× |
| Roboto / English words | 7.50306e+07 | 8.7936e+07 | 0.85× |
| Noto Nastaliq Urdu / Persian Little Prince | 7.3293e+08 | 7.89359e+08 | 0.93× |
| Noto Nastaliq Urdu / Persian words | 7.0951e+08 | 8.46944e+08 | 0.84× |
| Noto Sans Devanagari / Hindi words | 2.04276e+08 | 2.25202e+08 | 0.91× |
| Amiri / Persian Little Prince | 3.22015e+08 | 3.73885e+08 | 0.86× |
| Source Serif Variable / react-dom | 7.60465e+08 | 1.00439e+09 | 0.76× |

The geometric mean is **0.86×**, down from 11.25× for the initial port. Plans
cache each lookup's subtables with per-subtable digests and expand class
definitions into per-glyph tables; ligature sets reject candidates by their
second component; shapers reuse default-instance metrics across calls; 16-bit
coverage tables are searched directly and value records are applied field by
field; contextual rule sets reject rules on their second input value without
walking the buffer, and format 3 rules check their first input coverage before
any other setup; ligature sets skip candidates the same way; plans keep a digest
of each contextual rule set's second input values, so a rule set none of whose
rules can match is skipped whole; each subtable's starting coverage is expanded
in the plan, so lookups skip uncovered subtables without a call and pass the
coverage index to the ones they apply; each subtable's class definitions are
resolved once in the plan instead of per glyph; plans keep a digest of each
ligature set's second components, so a set none of whose ligatures can match is
rejected without walking it; pair sets keep a digest of their second glyphs, and
kerning-only pair subtables adjust the advance directly; steps whose features
have no per-glyph conditions skip those checks; context matching compares each
glyph with its expected value once, and the common GDEF class checks for skipped
glyphs are inlined into every glyph walk; normalization keeps glyphs mapped in
place instead of copying them to a new list, and GDEF classes are assigned in one
pass; device and variation records are skipped without variation coordinates,
and single-glyph cluster merges are skipped; the default character mapping caches
recent codepoints within each batch; lookups that cover no glyph in the buffer
are skipped before any setup, and AAT tables are found once per font; multiple
and ligature substitutions move the rest of the buffer once instead of once per
glyph, and contextual rules reuse the second input glyph found for the quick
reject instead of walking to it again; plans keep each rule's second input value, or a
stop mark for rules that must be looked at, so rules are skipped without reading
them; format 3 rules are checked before the
general rule setup; shapers keep their default-instance metrics scaled, so a
shaping call borrows them instead of copying them; lookups that contextual
rules apply are cached in the plan too, once per lookup, so nested lookups skip
uncovered subtables the same way; a ligature set whose first glyph ends the
buffer skips its longer ligatures without trying to match them, and fonts map
U+0000 to U+2FFF to glyphs once, straight from sorted cmap ranges, instead of on every call; Indic consonant
position probes check a digest of each probed feature's lookups before setting
up a lookup, and vowel constraints are checked only against the script's own
pairs; per-call scratch lists are sized once instead of grown glyph by glyph; text is decoded and added to the buffer in one pass, and
the right-to-left script check is a generated match. Format 4 character maps
are searched through arrays located once per font. Normalization maps a code point
that stays one glyph in place, so Indic text is not copied to a new list. Composition first checks
that the mark is the second half of some composition. Text entirely below U+0300 skips
the mark scans in normalization, and flag propagation skips flagless single-glyph
clusters; ASCII text fills the buffer in a plain loop, and horizontal advances are
read straight from the hmtx bytes; glyph properties are set in place, and normalization
maps single glyphs without copying them and composes only marks that can be the second
half of a composition. Kerning-only 16-bit pair subtables
(including advance devices without variation coordinates) take a dedicated path,
and a lookup's subtables share one search for the second glyph; a format 1 pair set whose digest lacks that glyph is
rejected before the kerning path is called, and a step group that every glyph enables skips the per-glyph
feature check. Plans keep a digest of the glyphs that can follow the first one in each lookup's
ligatures and pairs, so a lookup none of whose second glyphs is in the buffer is skipped
whole unless the buffer records unsafe-to-concat flags; format 3 contextual subtables add
their second input or first lookahead coverage to that digest, and format 1 and 2
subtables add their rules' second inputs or first lookaheads, through the class
definitions for format 2. Plans also keep each rule's first backtrack value, so a
rule whose glyph before the match cannot fit is rejected before the backtrack walk, and
each single-input rule's first lookahead value, checked against the glyph after the match;
both checks run in the loop that skips rules by their second input, so a rejected rule is
never read. Subtables a glyph cannot start a match in are skipped in a loop of their own,
bounded by the slice length so it needs no index checks. Plans record where each group of
steps sharing a lookup ends, and the buffer's glyph digest is kept across shaper pauses that
only reorder glyphs.
Format 3 rules keep digests of their second input, first backtrack and first lookahead
coverages, so most failing rules are ruled out from the glyphs on either side of the first
one before the rest of the rule is read or any coverage is searched. A covered format 3 rule that fails
this way is rejected inside the lookup's subtable loop, without the contextual call and its setup. That check borrows the lookup and finds the rule's
digests by index, so its call copies little. Plans find the GDEF class definitions once,
so a shaping call does not look them up again, and keep the digests Indic consonant position
probes check. Shaper pauses run only at the stages where the shaper has
work to do. Multiple and ligature substitutions move the buffer's tail through a slice
starting at the edit, so the moves need no index checks. Lookups whose subtables all kern
pairs take a dedicated path without the branches for other subtable kinds and check an expanded coverage without
the subtable's digest, and lookups are
passed by reference instead of copied for every glyph. Kerning reads expanded pair
classes straight from the plan, and plans fill expanded coverages and class ranges in bulk. On buffers longer than
48 glyphs, multiple and ligature substitution lookups write their results to an
output list in one pass, started at the first edit, instead of moving the rest of
the buffer for every edit; deleting a glyph merges its cluster into the output
read so far. The scratch lists a lookup application needs, its saved input and
contextual input and ligature component positions, live in the buffer, so each table's application
neither creates nor frees them. A lookup's format 3 subtables check their rule
digests in the lookup's subtable loop, against the glyphs before and after the
first one, which are found once for all the subtables. Contextual rules find
the lookups they apply through the plan's lookup offsets, and the plan lists
each nested lookup once however many rules apply it. Input matching skips the
per-glyph feature check when the step group enables its lookup everywhere, and
checks ligature components inline unless the first glyph is itself a component.
Each lookup step records which per-glyph feature conditions apply to its feature, so
the feature check tests only those.
A multiple substitution before a long tail moves the tail with one block move per
added glyph.
Substitutions add their glyphs to the buffer's digest, as in harfrust, so a long
buffer is rescanned only after a pause.
A table none of whose lookups may apply to the glyphs returns before its context is
set up, which most single words' substitution tables do.
Digest checks narrow glyph ids without the checked conversion, which the compiler
does not inline.
Positioning reuses the digest substitution leaves, since it does not change glyphs.
A glyph's small properties are bytes, so a glyph is 64 bytes and moves cost less.
Each lookup step stores its joiner handling, worked out once per plan rather than
from its tag on every apply, along with its lookup's header fields and whether the
step's group is on for every glyph.
`calt`'s Hangul jamo check rejects code points below U+1100 with one compare.
A format 3 contextual subtable keeps its backtrack, input and lookahead counts, so the
digest pre-check does not read them from the table.
Kerning steps run their glyph loop in a function of their own with the pair lookup inlined,
so each glyph no longer pays for a call.
Steps whose subtables are all contextual get the same treatment: their digest rejections
run in the step's glyph loop, and only a possible match calls `contextual`.
Mark, cursive and other non-kerning positioning steps likewise loop over glyphs themselves,
calling `position` only for a covered glyph.
Single, multiple, alternate and ligature substitution steps do the same with `substitute`.
A multiple substitution moves the rest of the buffer once, however many glyphs it inserts.
Substituted glyphs are updated in place, not copied out of the buffer and back.
An output pass appends each passed-over glyph directly, in `nextGlyph`, instead of through a slice copy.
When the output outgrows the input, the output so far moves out in slices, not one glyph at a time.
A format 3 rule that a context step already checked is not checked again in `contextual`.
Adding text counts scalars with a loop that vectorizes and converts byte offsets to clusters without a check per scalar.
Clearing a buffer empties its language in place instead of dropping and replacing it.
The per-glyph feature check, the second-input search and the nested lookup header read are inlined into their callers.
Moving to Silk dev.24 (dev.25 is current), whose slice and list accesses no longer reload the list's base pointer and whose
large struct literals are stored field by field, took the geometric mean from 0.93× to 0.86× with no source
changes; every workload is now below Rust.
Inserting copies of a glyph uses the list's own `insertRepeated`, which opens the gap with one block move.
The remaining cost is mostly per-glyph table walking that harfrust
precomputes and per-call setup.
