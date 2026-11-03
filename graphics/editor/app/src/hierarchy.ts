import type { Node } from './document'

const indexes = new WeakMap<readonly Node[], ReadonlyMap<string, Node>>()
const orders = new WeakMap<readonly Node[], readonly Node[]>()
export const nodeIndex = (nodes: readonly Node[]): ReadonlyMap<string, Node> => {
  const cached = indexes.get(nodes)
  if (cached) return cached
  const index = new Map(nodes.map((n) => [n.id, n]))
  indexes.set(nodes, index)
  return index
}
/** Parent-before-child paint order; sibling order follows the document array. */
export const paintOrder = (nodes: readonly Node[]): readonly Node[] => {
  const cached = orders.get(nodes)
  if (cached) return cached
  const children = new Map<string | null, Node[]>()
  for (const node of nodes) {
    const siblings = children.get(node.parentId) ?? []
    siblings.push(node)
    children.set(node.parentId, siblings)
  }
  const result: Node[] = []
  const visit = (parent: string | null, depth: number): void => {
    if (depth > 64) return
    for (const node of children.get(parent) ?? []) {
      result.push(node)
      visit(node.id, depth + 1)
    }
  }
  visit(null, 0)
  orders.set(nodes, result)
  return result
}
export const selectionRoots = (nodes: readonly Node[], ids: readonly string[]): readonly Node[] => {
  if (ids.length === 0) return []
  const selected = new Set(ids)
  const lookup = nodeIndex(nodes)
  return nodes.filter((n) => {
    if (!selected.has(n.id)) return false
    let parent = n.parentId
    while (parent !== null) {
      if (selected.has(parent)) return false
      parent = lookup.get(parent)?.parentId ?? null
    }
    return true
  })
}
export const inheritedOpacity = (node: Node, lookup: ReadonlyMap<string, Node>): number => {
  let opacity = node.opacity
  let parent = node.parentId
  while (parent !== null) {
    const ancestor = lookup.get(parent)
    if (!ancestor) break
    opacity *= ancestor.opacity
    parent = ancestor.parentId
  }
  return opacity
}
