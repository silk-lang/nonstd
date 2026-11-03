import type { Node } from './document'
import { nodeIndex } from './hierarchy'

/** Apply each selected root's transform to its subtree in one document pass. */
export const transformSubtrees = (
  nodes: readonly Node[],
  roots: readonly Node[],
  transform: (node: Node, root: Node) => Node,
): readonly Node[] => {
  const selected = new Map(roots.map((node) => [node.id, node]))
  const lookup = nodeIndex(nodes)
  return nodes.map((node) => {
    let root = selected.get(node.id)
    let parent = node.parentId
    while (!root && parent !== null) {
      root = selected.get(parent)
      parent = lookup.get(parent)?.parentId ?? null
    }
    return root ? transform(node, root) : node
  })
}
