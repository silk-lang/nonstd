import { Schema } from 'effect'
import { DesignDocumentSchema, NodeSchema, type DesignDocument, type Node } from './document'

// Small edits journal only changed nodes. Structural edits and large batches
// checkpoint the complete document, atomically replacing the previous journal.
export const changesSince = (
  before: DesignDocument | null,
  after: DesignDocument,
): readonly Node[] | null => {
  if (
    !before ||
    before.id !== after.id ||
    before.name !== after.name ||
    before.activePageId !== after.activePageId ||
    before.nextId !== after.nextId ||
    before.pages.length !== after.pages.length
  )
    return null
  const changed: Node[] = []
  for (let p = 0; p < after.pages.length; p++) {
    const page = after.pages[p]!
    const previous = before.pages[p]
    if (
      !previous ||
      page.id !== previous.id ||
      page.name !== previous.name ||
      page.nodes.length !== previous.nodes.length
    )
      return null
    if (page.nodes === previous.nodes) continue
    for (let i = 0; i < page.nodes.length; i++) {
      const node = page.nodes[i]!
      if (node.id !== previous.nodes[i]?.id) return null
      if (node !== previous.nodes[i]) changed.push(node)
      if (changed.length > 512) return null
    }
  }
  return changed
}
export const restoreChanges = (stored: unknown, edits: unknown): unknown => {
  const changes = Schema.decodeUnknownSync(Schema.Array(NodeSchema))(edits)
  if (changes.length === 0) return stored
  const document = Schema.decodeUnknownSync(DesignDocumentSchema)(stored)
  const byId = new Map(changes.map((node) => [node.id, node]))
  return {
    ...document,
    pages: document.pages.map((page) =>
      Object.assign({}, page, {
        nodes: page.nodes.map((node) => byId.get(node.id) ?? node),
      }),
    ),
  }
}
