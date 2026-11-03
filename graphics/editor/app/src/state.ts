import { selectionRoots } from './hierarchy'
import { currentPage, descendants, replaceNodes, type DesignDocument, type Node } from './document'
import { boundsOf, effectiveFlag } from './geometry'
import { type Model } from './model'
import { starterDocument } from './starter'

export const initialModel = (document: DesignDocument = starterDocument()): Model => ({
  document,
  drafts: {},
  camera: { x: -80, y: -80, zoom: 1 },
  width: 800,
  height: 600,
  selection: [],
  tool: 'select',
  gesture: null,
  past: [],
  future: [],
  revision: 0,
  savedRevision: 0,
  ready: false,
  error: null,
  notice: '',
  search: '',
  layerScroll: 0,
  menu: 'none',
  commandQuery: '',
  editingId: null,
  editingText: '',
  grid: false,
  snap: true,
  panels: true,
  guideX: null,
  guideY: null,
  clipboard: [],
  collapsed: [],
  recent: [],
})
export const selectedNodes = (model: Model): readonly Node[] =>
  selectionRoots(currentPage(model.document).nodes, model.selection)
export const frameCenter = (m: Model) => ({ x: m.width / 2, y: m.height / 2 })
export const markChanged = (m: Model, document: DesignDocument, before = m.document): Model => {
  if (document === before) return m
  return {
    ...m,
    document,
    past: [...m.past.slice(-49), before],
    future: [],
    revision: m.revision + 1,
    notice: '',
    error: null,
  }
}
export const idFor = (doc: DesignDocument): { id: string; nextId: number } => {
  let next = doc.nextId
  const used = new Set(doc.pages.flatMap((p) => [p.id, ...p.nodes.map((n) => n.id)]))
  while (used.has(`n${next}`)) next++
  return { id: `n${next}`, nextId: next + 1 }
}
export const groupBounds = (nodes: readonly Node[]): readonly Node[] =>
  nodes.map((n) => {
    if (n.kind !== 'group') return n
    const b = boundsOf(descendants(nodes, [n.id]).filter((child) => child.kind !== 'group'))
    return b ? { ...n, ...b } : n
  })
export const changeNodes = (m: Model, nodes: readonly Node[]): Model =>
  markChanged(m, replaceNodes(m.document, groupBounds(nodes)))
export const mutableSelection = (m: Model): readonly Node[] => {
  const nodes = currentPage(m.document).nodes
  const roots = selectedNodes(m).filter((n) => !effectiveFlag(n, nodes, 'locked'))
  return descendants(
    nodes,
    roots.map((n) => n.id),
  )
}
export const selectedIds = (m: Model) => new Set(mutableSelection(m).map((n) => n.id))
export const transformSelection = (m: Model, transform: (n: Node) => Node): Model => {
  const ids = selectedIds(m)
  return changeNodes(
    m,
    currentPage(m.document).nodes.map((n) => (ids.has(n.id) ? transform(n) : n)),
  )
}
export const duplicate = (m: Model, source = mutableSelection(m), offset = 24): Model => {
  if (source.length === 0) return m
  const remap = new Map<string, string>()
  let nextId = m.document.nextId
  const used = new Set(m.document.pages.flatMap((p) => [p.id, ...p.nodes.map((n) => n.id)]))
  for (const n of source) {
    while (used.has(`n${nextId}`)) nextId++
    remap.set(n.id, `n${nextId++}`)
  }
  const doc = { ...m.document, nextId }
  const copies: readonly Node[] = source.map((n) => ({
    ...n,
    id: remap.get(n.id) ?? n.id,
    parentId: remap.get(n.parentId ?? '') ?? n.parentId,
    x: n.x + offset,
    y: n.y + offset,
    name: `${n.name} copy`,
  }))
  const roots: readonly Node[] = copies.filter(
    (n) => !copies.some((parent) => parent.id === n.parentId),
  )
  const liveIds = new Set(currentPage(doc).nodes.map((n) => n.id))
  const safeCopies: readonly Node[] = copies.map((n) =>
    Object.assign({}, n, {
      parentId:
        n.parentId !== null &&
        !liveIds.has(n.parentId) &&
        !copies.some((parent) => parent.id === n.parentId)
          ? null
          : n.parentId,
    }),
  )
  return {
    ...markChanged(m, replaceNodes(doc, [...currentPage(doc).nodes, ...safeCopies])),
    selection: roots.map((n) => n.id),
  }
}
