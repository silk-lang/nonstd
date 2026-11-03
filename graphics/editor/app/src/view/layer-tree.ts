import { currentPage, type Node } from '../document'
import type { Model } from '../model'

export interface LayerRow {
  readonly node: Node
  readonly depth: number
}
const buildRows = (m: Model): readonly LayerRow[] => {
  const nodes = currentPage(m.document).nodes
  if (m.search.trim())
    return nodes
      .toReversed()
      .filter(
        (n) =>
          n.name.toLowerCase().includes(m.search.toLowerCase()) ||
          n.kind.includes(m.search.toLowerCase()),
      )
      .map((node) => ({ node, depth: 0 }))
  const byParent = new Map<string | null, Node[]>()
  for (const node of nodes) {
    const siblings = byParent.get(node.parentId) ?? []
    siblings.push(node)
    byParent.set(node.parentId, siblings)
  }
  const rows: LayerRow[] = []
  const visit = (parent: string | null, depth: number): void => {
    for (const node of (byParent.get(parent) ?? []).toReversed()) {
      rows.push({ node, depth })
      if (!m.collapsed.includes(node.id) && depth < 64) visit(node.id, depth + 1)
    }
  }
  visit(null, 0)
  return rows
}

let lastNodes: readonly Node[] | null = null
let lastSearch = ''
let lastCollapsed: readonly string[] | null = null
let lastRows: readonly LayerRow[] = []
export const layerRows = (m: Model): readonly LayerRow[] => {
  const nodes = currentPage(m.document).nodes
  if (nodes === lastNodes && m.search === lastSearch && m.collapsed === lastCollapsed)
    return lastRows
  lastNodes = nodes
  lastSearch = m.search
  lastCollapsed = m.collapsed
  lastRows = buildRows(m)
  return lastRows
}
