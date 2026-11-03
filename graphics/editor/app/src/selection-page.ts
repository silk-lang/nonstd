import { currentPage, makeNode } from './document'
import { boundsOf, fit } from './geometry'
import type { Model } from './model'
import { markChanged } from './state'

const colors = ['#25352b', '#b8c5ac', '#e6b84e', '#e3ad90', '#799a9d'] as const

export const addSelectionPage = (m: Model): Model => {
  const existing = m.document.pages.find((page) =>
    ['4k rectangles', '10k rectangles', '100k rectangles'].includes(page.name),
  )
  if (!existing && m.document.pages.length >= 100)
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
  const id = existing?.id ?? allocate()
  const nodes = Array.from({ length: 100_000 }, (_, index) =>
    makeNode(allocate(), 'rect', {
      name: `Rectangle ${String(index + 1).padStart(6, '0')}`,
      x: (index % 250) * 80,
      y: Math.floor(index / 250) * 64,
      width: 64,
      height: 48,
      fill: colors[((index % 250) + Math.floor(index / 250)) % colors.length] ?? '#b8c5ac',
    }),
  )
  const document = {
    ...m.document,
    pages: [
      ...m.document.pages.filter((page) => page.id !== id),
      { id, name: '100k rectangles', nodes },
    ],
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
