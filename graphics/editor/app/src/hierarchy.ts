import type { Node } from './document'

const indexes = new WeakMap<readonly Node[], ReadonlyMap<string, Node>>()
const orders = new WeakMap<readonly Node[], readonly Node[]>()
// The model's arrays are immutable. Share derived selection data across views,
// and let old selections disappear with their model snapshots.
const memberships = new WeakMap<readonly string[], ReadonlySet<string>>()
const roots = new WeakMap<readonly Node[], WeakMap<readonly string[], readonly Node[]>>()
export const selectionSet = (ids: readonly string[]): ReadonlySet<string> => {
  const cached = memberships.get(ids)
  if (cached) return cached
  const selected = new Set(ids)
  memberships.set(ids, selected)
  return selected
}
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
const withoutSelectedAncestors = (
  nodes: readonly Node[],
  chosen: readonly Node[],
  ids: readonly string[],
): readonly Node[] => {
  if (chosen.every((n) => n.parentId === null)) return chosen
  const selected = selectionSet(ids)
  const lookup = nodeIndex(nodes)
  return chosen.filter((n) => {
    let parent = n.parentId
    while (parent !== null) {
      if (selected.has(parent)) return false
      parent = lookup.get(parent)?.parentId ?? null
    }
    return true
  })
}
const rememberRoots = (
  nodes: readonly Node[],
  ids: readonly string[],
  result: readonly Node[],
): void => {
  const bySelection = roots.get(nodes) ?? new WeakMap<readonly string[], readonly Node[]>()
  bySelection.set(ids, result)
  roots.set(nodes, bySelection)
}
/** Construct a selection from unique nodes already in document order, reusing the query's work. */
export const selectionFromNodes = (
  nodes: readonly Node[],
  chosen: readonly Node[],
): readonly string[] => {
  const ids = chosen.map((n) => n.id)
  rememberRoots(nodes, ids, withoutSelectedAncestors(nodes, chosen, ids))
  return ids
}
export const selectionRoots = (nodes: readonly Node[], ids: readonly string[]): readonly Node[] => {
  if (ids.length === 0) return []
  const cached = roots.get(nodes)?.get(ids)
  if (cached) return cached
  const selected = selectionSet(ids)
  const chosen = nodes.filter((n) => selected.has(n.id))
  const result = withoutSelectedAncestors(nodes, chosen, ids)
  rememberRoots(nodes, ids, result)
  return result
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
