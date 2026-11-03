import { currentPage, type Node } from './document'
import { transformSubtrees } from './selection-transform'
import { effectiveFlag } from './geometry'
import type { Model } from './model'
import { changeNodes, selectedNodes } from './state'

/** Container coordinates are absolute; moving a root moves its complete subtree. */
export const patchGeometry = (
  m: Model,
  field: 'x' | 'y' | 'width' | 'height',
  value: number,
): Model => {
  const nodes = currentPage(m.document).nodes
  const roots = selectedNodes(m).filter((n) => !effectiveFlag(n, nodes, 'locked'))
  const next = transformSubtrees(nodes, roots, (n, root) => {
    if (root[field] === value) return n
    if (field === 'x' || field === 'y')
      return Object.assign({}, n, { [field]: n[field] + value - root[field] })
    if (root.kind !== 'group')
      return n.id === root.id ? Object.assign({}, n, { [field]: value }) : n
    return scaleNode(n, root, field, value / root[field])
  })
  return changeNodes(m, next)
}
const scaleNode = (n: Node, root: Node, field: 'width' | 'height', scale: number): Node => {
  if (field === 'width')
    return { ...n, x: root.x + (n.x - root.x) * scale, width: Math.max(0.1, n.width * scale) }
  return { ...n, y: root.y + (n.y - root.y) * scale, height: Math.max(0.1, n.height * scale) }
}
