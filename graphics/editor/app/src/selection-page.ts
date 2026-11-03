import { currentPage, makeNode } from './document'
import { boundsOf, fit } from './geometry'
import type { Model } from './model'
import { markChanged } from './state'

const colors = ['#25352b', '#b8c5ac', '#e6b84e', '#e3ad90', '#799a9d'] as const

export const addSelectionPage = (m: Model): Model => {
  if (m.document.pages.length >= 100)
    return { ...m, notice: 'This document has reached its page limit.' }
  const used = new Set(
    m.document.pages.flatMap((page) => [page.id, ...page.nodes.map((node) => node.id)]),
  )
  let nextId = m.document.nextId
  const allocate = (): string => {
    while (used.has(`n${nextId}`)) nextId++
    const id = `n${nextId++}`
    used.add(id)
    return id
  }
  const id = allocate()
  const nodes = Array.from({ length: 4_000 }, (_, index) =>
    makeNode(allocate(), 'rect', {
      name: `Rectangle ${String(index + 1).padStart(4, '0')}`,
      x: (index % 80) * 80,
      y: Math.floor(index / 80) * 64,
      width: 64,
      height: 48,
      fill: colors[((index % 80) + Math.floor(index / 80)) % colors.length] ?? '#b8c5ac',
    }),
  )
  const document = {
    ...m.document,
    pages: [...m.document.pages, { id, name: '4k rectangles', nodes }],
    activePageId: id,
    nextId,
  }
  return {
    ...markChanged(m, document),
    selection: [],
    tool: 'select',
    gesture: null,
    editingId: null,
    drafts: {},
    search: '',
    layerScroll: 0,
    camera: fit(boundsOf(currentPage(document).nodes), m.width, m.height),
  }
}
