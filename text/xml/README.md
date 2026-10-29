# text-xml

An XML 1.0 (Fifth Edition) parser for Silk. It is namespace-aware and non-validating, and builds
an owned document tree. It was written for the SVG renderer but is a general-purpose parser: it
passes every applicable case of the W3C XML Conformance Test Suite. It is headed for the Silk
standard library and lives here until then.

## What it handles

- UTF-8 and UTF-16 input (with byte order marks), and the encoding declaration.
- Elements, attributes, text, CDATA, comments and processing instructions.
- Namespaces (Namespaces in XML 1.0), with every element and attribute resolved to its URI.
- Internal DTD subsets: entity declarations (general and parameter), attribute-list defaults
  and ID attributes, plus well-formedness and entity-reference checks.
- `xml-stylesheet` pseudo-attributes (`parsePseudoAttributes`).

External subsets and external entities are never fetched. Their content is skipped, and
`Document.skippedExternalContent` reports that it was. Input size, retained bytes, entity
expansion, node count and nesting depth are all bounded. The defaults suit untrusted input,
and `parseWithLimits` can lower them. A malformed document is an `XmlError` with a byte offset,
never a partial tree.

## Example

```silk
import xml.xml { Document, NodeId, NodeKind, XmlError, parse }
import silk.core.option { Option }
import silk.mem.allocator { Allocator, OutOfMemoryError }

/// Counts the elements directly under the root that carry an `id` attribute.
pub effect fn countIdentified(data: &[u8]) -> usize
  ! XmlError | OutOfMemoryError
  ? &mut Allocator {
  let document = run parse(data)
  let mut count: usize = 0
  let mut child = document.firstChild(document.root())
  while let Option<NodeId>.Some { value } = child {
    let isElement = document.nodes()[value.index].kind == NodeKind.Element
    if isElement && document.attribute(value, b"", b"id").isSome() {
      count = count + 1
    }
    child = document.nextSibling(value)
  }
  return count
}
```

Nodes live in one arena, addressed by `NodeId`. Names, namespace URIs, text and attribute values
are byte slices borrowed from the document.

## Conformance

`text/xml/scripts/check-xmlconf` downloads the W3C XML Conformance Test Suite (2013-09-23,
pinned by SHA-256), runs the parser on every applicable case and compares accept/reject with
the expected outcome. **1899 of 1899** selected cases pass. The skipped cases are:

- XML 1.1 and Namespaces 1.1;
- earlier-edition rules;
- tests for namespace-unaware processors;
- optional errors;
- not-well-formed cases that depend on fetching external entities.

`text/xml/conformance` is the small runner package it builds.

## Tests

From the repository root:

```sh
silk test --manifest-path text/xml/silk.toml --root src/tests.silk
text/xml/scripts/check-xmlconf
```

Both run in the `text-xml` CI workflow. The SVG gate (`images/svg/scripts/check`) also exercises the
parser on every SVG test input.

## License

MIT or Apache-2.0, like the SVG implementation it was written for.
