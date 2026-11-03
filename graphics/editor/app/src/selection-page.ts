import { currentPage } from './document'
import { boundsOf, fit } from './geometry'
import type { Model } from './model'
import { markChanged } from './state'
import { mosaicPixel, mosaicTitle, selectionTitle } from './selection-mosaic'

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
  const nodes = [
    ...Array.from({ length: 100_000 }, (_, index) => mosaicPixel(allocate(), index)),
    ...selectionTitle.map((_, line) => mosaicTitle(allocate(), line)),
  ]
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
