# Font dump protocols

Milestone 0 defines **directory scope**, not complete table-field coverage. Both
implementations must produce this same protocol as their support reaches each gate.
Never call a directory-only comparison a full parser comparison.

The output is UTF-8, one `key=value` record per line, with LF after every line,
including the last. It contains no paths, timestamps, addresses, or locale-dependent
text. Array indices and counts are decimal. Tags are exactly eight lowercase hex
digits representing the four original bytes (including spaces and non-ASCII
bytes). Sfnt versions and checksums are `0x` plus eight lowercase hex digits.
Absent optional header fields are `none`.

Order is fixed: format/scope, file byte length, container kind/count, TTC header
if present, then each face in collection order. A standalone sfnt has face index
0. Directory records retain upstream array order; they are not sorted by the dumper.

```text
font-dump.version=1
dump.scope=directory
file.length=12
file.kind=sfnt
file.fonts=1
font[0].sfntVersion=0x00010000
font[0].numTables=0
font[0].searchRange=0
font[0].entrySelector=0
font[0].rangeShift=0
font[0].tableRecords.length=0
```

For each table record `font[N].tableRecords[M]`, emit `tag`, `checksum`, `offset`,
`length`, and `lookup`, in that order. `lookup` is `available` or `missing` according
to `FontRef::table_data(tag)`, including its null-offset and duplicate-tag semantics.
It is not an assertion about table structure, checksum validity, or successful
parsing. `numTables` and `tableRecords.length` are separate observations: upstream
can accept a directory header while returning an empty truncated record array.

For TTCs, `file.fonts` is `CollectionRef::len()`. The header records, in order, are:

```text
ttc.ttcTag=74746366
ttc.version.major=<decimal>
ttc.version.minor=<decimal>
ttc.numFonts=<decimal>
ttc.tableDirectoryOffsets.length=<decimal>
ttc.tableDirectoryOffsets[0]=<decimal>
...
ttc.dsigTag=<decimal or none>
ttc.dsigLength=<decimal or none>
ttc.dsigOffset=<decimal or none>
```

These are the public `TTCHeader` fields. In extended TTC versions, `file.fonts`
and the actual enumerated faces reflect `CollectionRef`'s extended-list selection;
the header's legacy `numFonts` and offsets remain the public header observations.

If `FileRef::new` fails, emit `file.error=<ReadError>` immediately after
`file.length`, with no kind or faces. A failed collection face emits only
`font[N].error=<ReadError>` in its position and does not prevent later faces from
being visited. Follow `FileRef`'s own collection-to-sfnt fallback behavior.

Errors preserve variant identity and payload. Unit variants use their names;
`InvalidFormat` and `InvalidCollectionIndex` use decimal payloads in parentheses;
`InvalidSfnt` uses a fixed-width `0x` payload; `InvalidTtc` and `TableIsMissing` use
eight-digit tags; `MalformedData` uses a Rust-debug-escaped quoted string. An
upstream enum change makes the exhaustive serializer fail to compile until mapped.

## Exit statuses

- Reference: 0 for a complete dump, **including a font parse error**; 2 for usage,
  unreadable input, or output I/O failure. A panic is always a harness failure.
- Silk: 0 for a complete dump (including a parse error) or help/version, 2 for
  usage, unreadable input, or output failure. A trap is always a harness failure.
- Comparison: 0 for complete matching valid dumps, 1 for a textual difference,
  2 for setup/process/timeout/protocol failure (even if both outputs match).

The historical milestone-0 skeleton emitted `dump.status=unimplemented`, which
was deliberately **not** a valid parsed dump.
New table scopes will be specified before comparison gates use them; no supported
field may be suppressed to make two implementations agree.

## Format 2: generated table fields

The format 2 header is `font-dump.version=2` and `dump.scope=core-tables`.
Directory fields retain format 1's order and encoding. After each face's directory,
dump `head`, `maxp`, `MAXP`, `cmap`, `DMAP`, `hhea`, `HHEA`, `hmtx`, `HMTX`,
`name`, `OS/2`, and `post`, in that order. A missing or unreadable table emits `font[N].TAG.error=VARIANT`.

Table fields follow the input grammar's order with camelCase keys. Numbers are
exact decimal values: fixed-point fields use their signed storage bits, versions
use their raw unsigned bits, and flags use the decoded bits (unknown bits are
masked as upstream specifies). MajorMinor emits `.major` and `.minor`. Other
scalar wrappers emit their numeric value; optional absence is `none`. Reserved
scalars with suppressed getters are read through their public byte ranges.

Arrays emit `.length` followed by every indexed value or record. Offset fields
emit their raw number, followed by the resolved target under the name without
`Offset`. Null optional targets emit `none`; resolution failures emit `.error`.
Format groups emit `.kind=FormatN`, followed by that variant's fields. This includes
all bytes represented by the grammar. No output fields are removed before comparing.

Handwritten observations follow each table's generated fields:

- Names: raw storage bytes, Unicode classification, BCP-47 language (ASCII hex),
  decoded Unicode scalar sequences and language-tag sequences. Mac Roman and
  malformed UTF-16 follow upstream decoding. String errors retain ReadError.
- Metrics: advance and side bearing for every stored long/bare record and two
  extra glyph IDs, exposing repeated final advances and absent bearings.
- Post: numNames, every readable `(glyph, name)` from the cached iterator, and
  eight direct lookup probes including IDs 65534/65535. Names use ASCII hex.
- Cmap subtables: language and every mapping within `CmapIterLimits::default()`.
  `.mappings[i]=codepoint,glyph,lookup` records both iteration and direct lookup;
  `lookup=-1` means None. Unicode variation observations use
  `.variants[i]=codepoint,selector,mapping,lookup`, where -2 means UseDefault,
  -1 means None and nonnegative values are glyph IDs. Counts follow the sequence.
  Cmap/DMAP also emit best/UVS selection and 15 fixed codepoint probes.

The iteration limits are upstream's maxChar=1114111 and glyphCount=65535, with
upstream format-specific semantics; all encoded groups and records are still
fully dumped. Format 14/15 limits are aggregate budgets, not value filters.
The expanded debug gate allows 120 seconds per process for full-repertoire fonts;
FDArrayTest257 produces 2.49 million lines. Output buffering changes no bytes.

## Version 3: layout and shared table graphs

The format 3 header is `font-dump.version=3` and `dump.scope=layout-tables`. It adds
all grammar fields and resolved offset arrays for GDEF, GSUB, GPOS, shared layout
structures, and their ItemVariationStore dependency. ValueRecord scalar/device
fields and raw bytes are included. Write-only compiler sentinels are excluded.

Each table view emits `.node=N` on first visit. A repeated view emits `.ref=N`,
referring to its complete preceding field dump. IDs are monotonic within a face.
The cache resets between top-level tables; identity includes grammar type, byte
suffix length, and the three-slot read-argument product. Parameterized records
forward their arguments to nested views. Cache eviction repeats the fields with
a new ID. No source byte is changed or canonicalized by the traversal.

Traversal stops at 64 path components or ten million node/record visits. It emits
`=traversal-limit`; the comparison harness rejects such output as incomplete.
The harness also rejects missing references, reused node IDs, process failures,
truncation, invalid UTF-8, and missing final newlines. All successful reports
include hashes of the complete streamed dumps.

## Version 4: variations, vertical metrics and glyph data

Version 4 used `font-dump.version=4` and `dump.scope=variation-tables`.
After the version 3 fields, dump fvar, avar, HVAR, VVAR, MVAR, gvar/GVAR, glyf,
vhea/VHEA, vmtx/VMTX, and VORG in that order. Their generated traversal includes
all grammar fields and resolved targets. fvar instance records include optional
PostScript name IDs. Variable record accessors retain upstream's complete suffix,
even where the declared count positions later fields.

Each ItemVariationStore additionally evaluates every outer/inner index, plus the
first undeclared inner index where representable, at four locations. Locations
0–3 set every axis to 0, -0.5, +0.5 and +1 (2.14 bits 0, -8192, 8192, 16384).
`.evaluated[L].outer[O].inner[I]` is the exact signed 48.16 result or `none`;
null/malformed outer records retain their ordinary absence/error observations.

`glyfLoca` and `GLYFLOCA` dump both location encodings independently: raw offsets,
ascending order, and every glyph's simple/composite fields, instruction bytes and
encoded payload. Empty glyphs emit `empty`; unreadable glyphs emit `none`, matching
`Loca.get`. The traversal starts a new graph scope for every glyph payload. This
is required because different glyphs can have identical suffix lengths. Scope
changes invalidate prior cache entries without clearing the whole cache; node IDs
remain monotonic within the face.

`gvarGlyphs` and `GVARGlyphs` traverse every glyph's raw variation header, serialized
bytes, tuple peaks/intermediate coordinates, decoded point positions and deltas.
Raw tuple-header arrays use hexadecimal bytes because their elements require an
axis-count argument. Each tuple's `.evaluated[L]` contains its scalar and every
scaled delta's 16.16 x/y bits at the four locations above, or `none` if inactive.
These observations evaluate explicit tuple deltas; inferred contour deltas are
covered by the ported gvar/deltas unit tests.

`HVARMetrics` and `VVARMetrics` evaluate every glyph through selected MAXP/maxp's
count, plus one out-of-range glyph ID, at those same four locations. Advances,
side bearings and vertical origins use signed 48.16 bits. `MVARMetrics` evaluates
every metric tag with the upstream rounded metric API and emits 16.16 bits.
Vertical metric tables also include advance/side-bearing lookups as in format 2.
All earlier format bounds, reference validation and error rules still apply.


## Version 5: AAT tables and decoded helpers

The version 5 header is `font-dump.version=5` and `dump.scope=aat-tables`.
After the VORG grammar fields, generated traversal emits morx, mort, kerx, trak,
ankr, feat and ltag. This covers all their grammar fields, arrays and resolved
references, including AAT lookup/state headers. The kern wrapper selects the
OpenType or AAT header and emits every subtable's generated fields separately.
Variable-length tables start independent graph scopes: equal-sized chains and
subtables can contain different bytes and therefore cannot share a cache entry.

Before the metric variation observations, morxKinds, mortKinds, kerxKinds and
kernKinds emit format dispatch, coverage predicates, cached-parts fields and
reconstruction status, state headers/classes, complete action/component/glyph
arrays, typed lookup fields and values, and kerning matrices/vectors. Lookup and
state class queries cover glyph IDs zero through the font's selected glyph count,
clamped to 65535. Typed lookups also probe glyph 65535. State entry queries use
states [0, 1, 2, 65535] and classes [0, 1, 2, 3, 255, 65535] (254 replaces 65535 for
legacy byte classes). Payloads retain their actual format-specific fields. Raw
state and entry bytes are also included through their generated header targets.

Kerning format 0 additionally queries every stored pair. All pair/class formats
query the Cartesian product of glyph IDs [0, 1, 2, 31, lastGlyph, glyphCount,
65535, 65536]; an empty font uses zero for lastGlyph. Complete class lookups and
value/index arrays remain part of the dump independently of those probes.
Legacy mort contextual substitutions probe five signed offsets and four glyphs;
ligature readers probe positive, negative and out-of-range absolute offsets.

trakValues contains complete Fixed size arrays (raw 16.16 bits) and per-size
tracking values. ankrPoints queries every glyph through the selected count,
clamped to 65536, and emits every resolved anchor. featSettings includes exclusive
flags, default setting indices and feature-name lookup results. ltagStrings
contains every valid tag's UTF-8 bytes in hexadecimal and its lookup index.
Missing, null and malformed data retain the previous error/absence syntax.
The variation and glyph observations remain unchanged after these additions.

## Version 6: CFF and CFF2

Version `6`, scope `cff-tables`, appends CFF and CFF2 observations after the
version-5 fields. Each table includes its generated header, names/strings/top
DICT/global-subroutine INDEX fields, decoded DICT operands, and the selected
font's metadata, matrices, charstrings, charset and encoding. DICT links follow
the bounded top/font/private hierarchy and expose FDArray, FDSelect, custom
encoding and local-subroutine fields, including failed offset resolutions.
DICT operand observations use no blend state; location-dependent private
values are observed separately through subfont construction.

Each glyph reports its SID, bytes of its name, reverse charset mapping, selected
subfont, advance width and transformed control-point bounds. Metadata strings are
UTF-8 bytes encoded as hex; all Fixed values are signed raw 16.16 bits. Subfont
widths, matrices and hinting values, glyph widths and bounds are evaluated at
four uniform normalized locations: 0, -8192, 8192 and 16384 in F2Dot14 bits.
Errors preserve the upstream model error variant. Empty bounds and absent names
remain `none`.

Raw generated fields include complete arrays and payload bytes. Extra semantic
INDEX and glyph probes cover up to 65,536 items plus one out-of-range item,
matching the sfnt glyph-ID domain; `.probeCount` / `.glyphProbeCount` state that
bound explicitly. Custom charset and encoding fields retain original order.
Graph scopes restart for independently addressed structures so equal-size data
cannot share a false reference. The harness still compares every emitted byte.

## Version 7: model APIs and layout intersections

Version `7`, scope `model-apis`, retains the complete version-6 table traversal.
Each newly visited coverage or class-definition node additionally evaluates
three IntSet queries: empty; the sparse glyph IDs 0, 1, 2, 10, 255, 256, 511, 512,
65535, 65536, 70000, 16777215 and 4294967295; and the inclusive range 0–64.
Coverage observations contain `intersects` and the complete ordered intersection.
Class observations contain the ordered intersected classes, then boolean and
ordered glyph intersections for classes 0, 1, 2, 3, 65535, 65536 and 4294967295.
The observations are emitted once per visited concrete table node, including
extended formats 3 and 4; graph references do not repeat the work.

Each face then has a `model` section constructed through its model Tables source.
Charmaps report Unicode/symbol/Mac Roman/UVS selection, fixed scalar/batch probes,
Unicode and UVS cursors, and each encoding's identity and code cursor. Every
emitted cursor entry also reports the corresponding scalar lookup. Glyph names
report their source, hexadecimal UTF-8 and exact reverse lookup; the name cursor
is observed independently of indexed lookup.

`glyphProbeLimit=65536` bounds extra indexed glyph observations and the name
cursor. Indexed probes also include the last declared glyph, the first two IDs
after the font, and u32::MAX, without duplicates. `mappingProbeLimit=1114112`
bounds each extra mapping cursor. These bounds apply only to evaluated helpers;
generated table fields and arrays remain complete.

Fonts without usable fvar axes have one default location. Variable fonts use
uniform normalized coordinates 0, -8192, 8192 and 16384 on all declared usable
axes; the default instance has an empty coordinate slice. Each location reports
all global Metrics fields, the selected horizontal line, exact horizontal and
vertical advances, vertical origins, and extents. It also reports the public
ScaleF32 and Scale26Dot6 measurements at 16 ppem. Exact values use signed raw
48.16 bits, 26.6 results use signed raw bits, and f32 results use unsigned IEEE
bits, so comparison loses no fractions or signed zeros.

The M7 `extentsSourceOrder=base-outlines` selects glyf, CFF2 and CFF (Type 1 is
outside the port). Phase 2 adds observations for the complete bitmap/color/VARC
chain. Unavailable ink is `none`; a present empty glyph has four zero fields.
Allocation failure aborts the dump rather than emitting a successful observation.

## Version 8 — Phase 2 tables

Version `8`, scope `phase2-tables`, retains version 7 observations and adds the
Phase 2 table families. Generated array offsets traverse each
resolved element in order, including optional palette flag/name-ID arrays.
`hdmx` device records include pixel size, maximum width and all width bytes.
Metadata includes its variant, every language/script entry as UTF-8 byte hex or
its read error, and opaque bytes for other tags. DSIG follows the public resolver:
unknown signature formats and inconsistent lengths produce `none`.

## Version 9 — complete model source selection

The active header is `font-dump.version=9` with `dump.scope=all`.
It retains version 8's complete table observations and changes
model measurements to `extentsSourceOrder=default`. All glyphs and existing
boundary probes now use bitmap, COLR, VARC and base-outline sources in upstream
order at each normalized location. The 16 ppem floating-point and 26.6 views also
select the bitmap strike requested by their scale.

At each location, `sourceOrders[0..5].glyphs[G]` records exact extents for outlines,
base outlines, bitmaps, color, empty, and the custom CFF/glyf/COLR order. The fixed
probe sequence is 0, 1, 2, 31, the last glyph (saturating), the glyph count, and
`u32::MAX`; repeated IDs are intentionally retained. `bitmapSizes[0..1]` records
12 and 64 ppem, encoded as f32 bits, followed by scaled f32 extents at those same
IDs. These probes supplement the exhaustive default-order glyph measurements.
