import type { Node } from './document'
import { effectiveFlag, intersects, type Bounds } from './geometry'
import { selectionFromNodes, selectionSet } from './hierarchy'

const candidates = new WeakMap<readonly Node[], readonly Node[]>()
const selectableNodes = (nodes: readonly Node[]): readonly Node[] => {
  const cached = candidates.get(nodes)
  if (cached) return cached
  const result = nodes.filter(
    (n) =>
      n.kind !== 'frame' &&
      !effectiveFlag(n, nodes, 'hidden') &&
      !effectiveFlag(n, nodes, 'locked'),
  )
  candidates.set(nodes, result)
  return result
}

/** Query in document order; additive selection retains the gesture's original order. */
export const marqueeSelection = (
  nodes: readonly Node[],
  area: Bounds,
  original: readonly string[] = [],
): readonly string[] => {
  const eligible = selectableNodes(nodes)
  if (original.length === 0) {
    const chosen = eligible.filter((node) => intersects(node, area))
    return selectionFromNodes(nodes, chosen)
  }
  const retained = selectionSet(original)
  const found = [...retained]
  for (const node of eligible)
    if (intersects(node, area) && !retained.has(node.id)) found.push(node.id)
  return found
}
