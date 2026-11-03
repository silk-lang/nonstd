import { naturalText } from './text-layout'
import { effectsComposition } from './effects-fixture'
import { currentPage, makeNode, type Node } from './document'
import { boundsOf, fit } from './geometry'
import type { Model } from './model'
import { idFor, markChanged } from './state'

export const addEffectsPage = (m: Model): Model => {
  if (m.document.pages.length >= 100)
    return { ...m, notice: 'This document has reached its page limit.' }
  let document = m.document
  const allocate = (): string => {
    const next = idFor(document)
    document = { ...document, nextId: next.nextId }
    return next.id
  }
  const id = allocate()
  const nodes: Node[] = []
  const add = (kind: Node['kind'], patch: Partial<Node>): void => {
    const node = makeNode(allocate(), kind, patch)
    nodes.push(kind === 'text' ? naturalText(node) : node)
  }
  for (const node of effectsComposition) add(node.kind, node)
  document = {
    ...document,
    pages: [...document.pages, { id, name: 'Effects playground', nodes }],
    activePageId: id,
  }
  return {
    ...markChanged(m, document),
    selection: [],
    camera: fit(boundsOf(currentPage(document).nodes), m.width, m.height),
  }
}
